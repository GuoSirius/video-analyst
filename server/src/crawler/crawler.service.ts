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

/** yt-dlp 下载参数配置 */
export interface YtDlpOptions {
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
  /** 自定义格式选择器（覆盖默认的 bv*+ba） */
  format?: string
  /** 提取器专属参数，如 { youtube: ['player_client=web'] } */
  extractorArgs?: Record<string, string[]>
  /** 额外的原始命令行参数（直接传递给 yt-dlp） */
  rawArgs?: string[]
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    })
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }
    return resp.text()
  }

  parseHtml(html: string, rules: CrawlRule[], itemSelector?: string): Record<string, any>[] {
    const $ = cheerio.load(html)

    if (itemSelector) {
      const results: Record<string, any>[] = []
      $(itemSelector).each((_, el) => {
        results.push(this.extractItem($, el, rules))
      })
      return results
    }

    return [this.extractItem($, $.root(), rules)]
  }

  private extractItem($: cheerio.CheerioAPI, root: any, rules: CrawlRule[]): Record<string, any> {
    const item: Record<string, any> = {}
    for (const rule of rules) {
      if (rule.isList && rule.subRules) {
        const listResults: Record<string, any>[] = []
        $(rule.selector, root).each((_, el) => {
          listResults.push(this.extractItem($, el, rule.subRules!))
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
        item[rule.name] = this.applyRegex(value, rule.regex)
      }
    }
    return item
  }

  /** Apply regex extraction: returns first capture group, or full value if no regex */
  private applyRegex(value: string, regex?: string): string {
    if (!regex || !value) return value
    try {
      const m = value.match(new RegExp(regex))
      return m?.[1] ?? m?.[0] ?? value
    } catch {
      return value
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
    // Video file extensions
    if (/\.(mp4|mkv|webm|mov|avi|flv|wmv|m4v)$/i.test(url)) {
      return { type: 'video', source: 'direct' }
    }
    // Audio file extensions
    if (/\.(mp3|wav|flac|aac|ogg|wma|m4a|opus)$/i.test(url)) {
      return { type: 'audio', source: 'direct' }
    }
    // Image file extensions
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)$/i.test(url)) {
      return { type: 'image', source: 'direct' }
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
