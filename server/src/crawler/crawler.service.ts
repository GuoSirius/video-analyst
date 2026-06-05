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
  detailLinkSelector?: string
  detailRules?: CrawlRule[]
  /** If true, start crawling immediately after creation. Default false. */
  autoStart?: boolean
  /** Field name from extracted rules to use as the item title. Falls back to auto-detection if not set. */
  titleField?: string
  /** Field name from extracted rules that contains the detail page URL. Takes priority over detailLinkSelector. */
  detailLinkField?: string
  /** Field name(s) from extracted rules that contain media URLs (comma-separated, first match wins). Falls back to auto-detection. */
  mediaUrlField?: string
  /** Field name that uniquely identifies each item (e.g. 'id', 'product_id'). Used for matching during retry/recrawl. */
  idField?: string
  /** Error handling mode: 'lenient' = skip all errors, 'standard' = retry then skip, 'strict' = fail on error */
  errorMode?: 'lenient' | 'standard' | 'strict'
  /** Whether to automatically import media resources to download queue after crawl */
  autoDownload?: boolean
  /** Field names to download (comma-separated). Only these fields will be downloaded. If not set, all media fields are downloaded. */
  downloadFields?: string
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
        const el = $(rule.selector, root).first()
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
}
