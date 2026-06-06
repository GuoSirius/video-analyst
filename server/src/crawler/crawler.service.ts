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
  /** 下载方式：yt-dlp 或 file（文件直链） */
  downloadMethod: 'yt-dlp' | 'file'
  /** yt-dlp 下载参数（仅 downloadMethod='yt-dlp' 时有效，不同站点可配置不同参数） */
  ytDlpOptions?: YtDlpOptions
}

/** yt-dlp 画质预设 */
export type QualityPreset = 'compatible' | 'high-mp4' | 'single'

/** 画质预设 → format 映射 */
export const QUALITY_PRESET_FORMATS: Record<QualityPreset, string> = {
  'compatible': 'bestvideo*+bestaudio*/best',
  'high-mp4': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  'single': 'best[ext=mp4]/best',
}

/** yt-dlp 下载参数配置 */
export interface YtDlpOptions {
  /** 画质预设（优先级低于 format 自定义输入） */
  qualityPreset?: QualityPreset
  /** 从浏览器读取 cookies（如 chrome、firefox、edge） */
  cookiesFromBrowser?: string
  /** cookies 文件路径 */
  cookies?: string
  /** 代理地址 */
  proxy?: string
  /** 下载速率限制（如 5M、500K） */
  limitRate?: string
  /** 自定义 User-Agent */
  userAgent?: string
  /** Referer 请求头 */
  referer?: string
  /** 站点登录用户名 */
  username?: string
  /** 站点登录密码 */
  password?: string
  /** 自定义请求头 */
  addHeaders?: Record<string, string>
  /** 绕过地域限制 */
  geoBypass?: boolean
  /** 跳过 HTTPS 证书校验 */
  noCheckCertificates?: boolean
  /** 请求间隔（秒） */
  sleepInterval?: number
  /** 重试次数 */
  retries?: number
  /** 自定义格式选择器（覆盖预设，留空则使用预设值） */
  format?: string
  /** 提取器专属参数，如 { youtube: ['player_client=web'] } */
  extractorArgs?: Record<string, string[]>
  /** 额外的原始命令行参数（直接传递给 yt-dlp） */
  rawArgs?: string[]
  /** 禁止下载播放列表（null = 不设置，允许下载播放列表） */
  noPlaylist?: boolean | null
  /** 连接超时秒数（null = 不设置，使用 yt-dlp 默认） */
  socketTimeout?: number | null
  /** 提取器重试次数（null = 不设置，使用 yt-dlp 默认） */
  extractorRetries?: number | null
}

export interface CrawlPayload {
  name?: string
  url: string
  /** 'single' = single detail page → one object; 'list' = list page → array */
  mode?: 'single' | 'list'
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
  /** 爬取完成后自动将媒体资源带入下载队列 */
  autoDownload?: boolean
  /** 下载完成后自动转码 */
  autoTranscode?: boolean
  /** 识别完成后自动 AI 分析 */
  autoAI?: boolean
  /** 一键全开：等效于 autoStart + autoDownload + autoTranscode + autoAI */
  autoPipeline?: boolean

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
}

@Injectable()
export class CrawlerService {
  async fetchHtml(url: string): Promise<string> {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    })
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }
    return resp.text()
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
