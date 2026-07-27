import { Injectable } from '@nestjs/common'
import * as cheerio from 'cheerio'

export interface CrawlRule {
  name: string
  selector: string
  attr?: string
  /** Regex with capture group to extract part of the value, e.g. "/product/(\d+)" */
  regex?: string
  isList?: boolean
  subRules?: CrawlRule[]
}

/** 字段指定：多个字段按顺序选一个(first) 还是全部收集(all) */
export interface FieldSpec {
  fields: string[]
  mode: 'first' | 'all'
}

/** URL 转换规则：将提取到的字段值拼接为标准视频页面链接 */
export interface UrlTransform {
  /** 要转换的字段名 */
  fieldName: string
  /** 链接模板，{fieldName} 占位符会被实际值替换 */
  urlTemplate: string
}

export interface CrawlPayload {
  name?: string
  url: string
  /** 'single' = single detail page → one object; 'list' = list page → array; 'site' = 整站递归爬取 */
  mode?: 'single' | 'list' | 'site'

  // ── 整站爬取（mode = 'site'）专用配置 ──
  /** 仅爬同主域（含子域），防爬到外站。默认 true */
  sameDomain?: boolean
  /** 仅允许的路径前缀白名单，如 ['/docs'] */
  allowPaths?: string[]
  /** 排除的路径前缀黑名单，如 ['/login', '/cart'] */
  denyPaths?: string[]
  /** URL 正则白名单 */
  includeRegex?: string[]
  /** URL 正则黑名单（优先级高于白名单） */
  excludeRegex?: string[]
  /** 最大递归深度：0 = 无限 */
  maxDepth?: number
  /** 请求间隔(ms)，礼貌爬取/防封。默认 200 */
  delayMs?: number
  /** 链接发现选择器，默认 a[href] */
  linkSelector?: string
  rules: CrawlRule[]
  itemSelector?: string
  /** 'none' = no pagination; 'page' = stop after maxPages; 'count' = stop after maxItems */
  paginationMode?: 'none' | 'page' | 'count'
  /** CSS selector for "next page" link (ignored if urlPattern is set) */
  nextPageSelector?: string
  maxPages?: number
  maxItems?: number
  /** URL template with {page} placeholder, e.g. "https://example.com/list?page={page}" */
  urlPattern?: string
  /** Starting page number for urlPattern (default 1) */
  pageStart?: number
  /** CSS selector for a "load more" button/link (experimental, for simple link-based load-more) */
  loadMoreSelector?: string
  detailRules?: CrawlRule[]

  // ── 执行开关 ──
  /** 创建后自动执行爬取任务 */
  autoStart?: boolean

  // ── 容错 ──
  errorMode?: 'lenient' | 'standard' | 'strict'

  // ── 字段指定 ──
  /** 标题字段：mode 默认 'first' */
  titleField?: FieldSpec
  /** 详情链接字段：mode 默认 'first' */
  detailLinkField?: FieldSpec
  /** 媒体资源字段：mode 默认 'all'（收集所有指定字段的值） */
  mediaUrlField?: FieldSpec
  /** 唯一标识字段：mode 默认 'first' */
  idField?: FieldSpec

  // ── URL 转换 ──
  /** 需要拼接转换的字段规则 */
  urlTransforms?: UrlTransform[]

  // ── 超时控制 ──
  /** 单请求超时(ms)：0 = 不限制；省略 = 默认 15000 */
  fetchTimeoutMs?: number
}

@Injectable()
export class CrawlerService {
  async fetchHtml(url: string, timeoutMs = 15000): Promise<string> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`Invalid URL: ${url}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol (SSRF guard): ${parsed.protocol}`)
    }
    if (this.isBlockedHost(parsed.hostname)) {
      throw new Error(`Blocked target host (SSRF guard): ${parsed.hostname}`)
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // timeoutMs <= 0 视为不限制：不挂定时器、不设 signal，避免被立即 abort
    if (timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs)
    }
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      })
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
      }
      return resp.text()
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** SSRF 防护：拦截私有网段、回环、链路本地与云元数据地址（169.254.169.254） */
  private isBlockedHost(hostname: string): boolean {
    const host = hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
    if (m) {
      const a = Number(m[1])
      const b = Number(m[2])
      if (a === 10) return true
      if (a === 127) return true
      if (a === 0) return true
      if (a >= 224) return true // 组播 / 保留
      if (a === 169 && b === 254) return true // 链路本地 / 云元数据
      if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
      if (a === 192 && b === 168) return true
    }
    return false
  }

  parseHtml(html: string, rules: CrawlRule[], itemSelector?: string, sourceUrl?: string): Record<string, any>[] {
    const $ = cheerio.load(html)

    if (itemSelector) {
      const results: Record<string, any>[] = []
      $(itemSelector).each((_, el) => {
        results.push(this.extractItem($, el, rules, sourceUrl))
      })
      return results
    }

    return [this.extractItem($, $.root(), rules, sourceUrl)]
  }

  private extractItem($: cheerio.CheerioAPI, root: any, rules: CrawlRule[], sourceUrl?: string): Record<string, any> {
    const item: Record<string, any> = {}
    for (const rule of rules) {
      if (rule.isList && rule.subRules) {
        const listResults: Record<string, any>[] = []
        $(rule.selector, root).each((_, el) => {
          listResults.push(this.extractItem($, el, rule.subRules!, sourceUrl))
        })
        item[rule.name] = listResults
      } else {
        // 空 selector = 使用 root 元素本身，用于提取 itemSelector 选中元素上的属性（如 <a> 的 href）
        const el = rule.selector ? $(rule.selector, root).first() : $(root)
        let value: string
        if (rule.attr) {
          value = el.attr(rule.attr) || ''
        } else {
          value = el.text().trim()
        }
        item[rule.name] = this.applyRegex(value.trim(), rule.regex, sourceUrl)
      }
    }
    return item
  }

  /** Apply regex extraction: returns first capture group, or full match if no capture group.
   *  Returns empty string when regex does not match — the original value is NOT used as fallback.
   *  Protocol-relative URLs (//) are normalized with the source page's protocol before regex. */
  private applyRegex(value: string, regex?: string, sourceUrl?: string): string {
    if (!regex || !value) return value
    try {
      // 协议补全：对于 // 开头的资源 URL，使用源页面协议补全后再应用正则
      const normalized = this.normalizeProtocol(value, sourceUrl)
      const m = normalized.match(new RegExp(regex))
      if (!m) return ''
      // 有捕获组 → 提取模式；无捕获组 → 过滤模式（返回 $0）
      const result = m[1] ?? m[0]
      // 如果匹配结果本身仍然是协议相对URL，也补全（保证最终结果是绝对URL）
      if (result.startsWith('//')) {
        return this.normalizeProtocol(result, sourceUrl)
      }
      return result
    } catch {
      return ''
    }
  }

  /** 补全协议相对 URL：从源页面 URL 提取协议，补到 // 开头的 URL 前 */
  private normalizeProtocol(url: string, sourceUrl?: string): string {
    if (!url.startsWith('//')) return url
    if (!sourceUrl) return 'https:' + url
    try {
      const proto = new URL(sourceUrl).protocol // "http:" or "https:"
      return proto + url
    } catch {
      return 'https:' + url
    }
  }

  detectMediaType(url: string): { type: string; source: string } {
    if (!url) return { type: 'text', source: '' }

    // Platform-specific
    if (url.includes('bilibili.com') || url.includes('b23.tv')) {
      return { type: 'video', source: 'bilibili' }
    }
    if (url.includes('v.qq.com') || url.includes('txvideo')) {
      return { type: 'video', source: 'tencent' }
    }
    if (url.includes('youku.com')) {
      return { type: 'video', source: 'youku' }
    }
    if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('yt.be')) {
      return { type: 'video', source: 'youtube' }
    }
    // Video file extensions
    if (/\.(mp4|mkv|webm|mov|avi|flv|wmv|m4v|3gp|ogv|ts|m3u8)$/i.test(url)) {
      return { type: 'video', source: 'direct' }
    }
    // Audio file extensions
    if (/\.(mp3|wav|flac|aac|ogg|wma|m4a|opus|mid|midi|weba)$/i.test(url)) {
      return { type: 'audio', source: 'direct' }
    }
    // Image file extensions
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|tiff|tif|avif|heic|heif)$/i.test(url)) {
      return { type: 'image', source: 'direct' }
    }
    // Document file extensions
    if (/\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv|tsv)$/i.test(url)) {
      return { type: 'document', source: 'direct' }
    }
    // Data / text file extensions
    if (/\.(md|json|ya?ml|txt|xml|html?|log|sql)$/i.test(url)) {
      return { type: 'data', source: 'direct' }
    }
    // Looks like a web page or API link (not a media file)
    if (/^https?:\/\//i.test(url)) {
      return { type: 'link', source: new URL(url).hostname }
    }
    return { type: 'link', source: '' }
  }

  // ── 字段解析工具 ──

  /** 按顺序选第一个有效值 */
  pickFirst(item: Record<string, any>, fields: string[]): string {
    for (const f of fields) {
      const val = item[f]
      if (val != null && val !== '') return String(val)
    }
    return ''
  }

  /** 收集所有指定字段的有效值 */
  collectAll(item: Record<string, any>, fields: string[]): string[] {
    const results: string[] = []
    for (const f of fields) {
      const val = item[f]
      if (val != null && val !== '') results.push(String(val))
    }
    return results
  }
}
