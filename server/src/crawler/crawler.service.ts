import { Injectable } from '@nestjs/common'
import * as cheerio from 'cheerio'

export interface CrawlRule {
  name: string
  selector: string
  attr?: string
  isList?: boolean
  subRules?: CrawlRule[]
}

export interface CrawlPayload {
  url: string
  rules: CrawlRule[]
  itemSelector?: string
  nextPageSelector?: string
  maxPages?: number
  batchSize?: number
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
        if (rule.attr) {
          item[rule.name] = el.attr(rule.attr) || ''
        } else {
          item[rule.name] = el.text().trim()
        }
      }
    }
    return item
  }

  detectMediaType(url: string): { type: string; source: string } {
    if (!url) return { type: 'unknown', source: 'direct' }

    if (url.includes('bilibili.com') || url.includes('b23.tv')) {
      return { type: 'video', source: 'bilibili' }
    }
    if (url.includes('v.qq.com') || url.includes('txvideo')) {
      return { type: 'video', source: 'tencent' }
    }
    if (url.includes('youku.com')) {
      return { type: 'video', source: 'youku' }
    }
    if (/\.(mp4|mkv|webm|mov|avi|flv|wmv|m4v)$/i.test(url)) {
      return { type: 'video', source: 'direct' }
    }
    if (/\.(mp3|wav|flac|aac|ogg|wma|m4a|opus)$/i.test(url)) {
      return { type: 'audio', source: 'direct' }
    }
    return { type: 'unknown', source: 'direct' }
  }
}
