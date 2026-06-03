import { Controller, Post, Get, Delete, Put, Param, Body, Query, Sse } from '@nestjs/common'
import { Observable } from 'rxjs'
import * as cheerio from 'cheerio'
import { CrawlerService, CrawlPayload } from './crawler.service'
import { QueueService } from '../common/queue/queue.service'
import { SseService } from '../common/sse/sse.service'
import { DatabaseService } from '../common/database/database.service'
import { PipelineService } from '../common/pipeline/pipeline.service'
import { v4 as uuid } from 'uuid'

@Controller('api/crawler')
export class CrawlerController {
  constructor(
    private readonly crawler: CrawlerService,
    private readonly queue: QueueService,
    private readonly sse: SseService,
    private readonly db: DatabaseService,
    private readonly pipeline: PipelineService,
  ) {}

  @Post('crawl')
  async startCrawl(@Body() payload: CrawlPayload) {
    const task = this.queue.createTask('crawl', payload)
    if (payload.autoStart) {
      this.processCrawlTask(task.id, payload)
    }
    return { taskId: task.id }
  }

  @Get('tasks')
  getTasks() {
    return this.queue.getTasksByType('crawl')
  }

  @Get('items')
  getItems(@Query('taskId') taskId?: string, @Query('status') status?: string) {
    let rows: any[]
    if (taskId && status) {
      rows = this.db.db.prepare('SELECT * FROM crawl_items WHERE task_id = ? AND status = ? ORDER BY created_at DESC').all(taskId, status) as any[]
    } else if (taskId) {
      rows = this.db.db.prepare('SELECT * FROM crawl_items WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as any[]
    } else if (status) {
      rows = this.db.db.prepare('SELECT * FROM crawl_items WHERE status = ? ORDER BY created_at DESC').all(status) as any[]
    } else {
      rows = this.db.db.prepare('SELECT * FROM crawl_items ORDER BY created_at DESC').all() as any[]
    }
    return rows
  }

  @Delete('items/:id')
  deleteItem(@Param('id') id: string) {
    this.db.db.prepare('DELETE FROM crawl_items WHERE id = ?').run(id)
    return { ok: true }
  }

  @Post('items/:id/retry')
  async retryItem(@Param('id') id: string) {
    return this.recrawlSingleItem(id)
  }

  @Post('items/:id/recrawl')
  async recrawlItem(@Param('id') id: string) {
    return this.recrawlSingleItem(id)
  }

  @Post('tasks/:id/start')
  startTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status === 'paused') {
      const resumeState = task.result || {}
      this.processCrawlTask(id, task.payload, resumeState)
    } else if (task.status === 'pending') {
      this.processCrawlTask(id, task.payload)
    } else {
      return { error: `Cannot start task in ${task.status} status` }
    }
    return { ok: true }
  }

  @Post('tasks/:id/pause')
  pauseTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'running') return { error: 'Task is not running' }
    this.queue.pauseTask(id)
    return { ok: true }
  }

  @Post('tasks/:id/stop')
  stopTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'running' && task.status !== 'paused') {
      return { error: 'Task is not running or paused' }
    }
    this.queue.cancelTask(id)
    return { ok: true }
  }

  @Post('tasks/:id/retry')
  retryTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'failed') return { error: 'Only failed tasks can be retried' }
    this.queue.retryTask(id)
    this.processCrawlTask(id, task.payload)
    return { ok: true }
  }

  @Post('tasks/:id/rerun')
  reRunTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed') {
      return { error: 'Only completed, cancelled or failed tasks can be re-run' }
    }
    this.queue.reRunTask(id)
    this.processCrawlTask(id, task.payload)
    return { ok: true }
  }

  @Delete('tasks/:id')
  deleteTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    // Only allow deleting tasks in terminal or not-started states
    if (task.status === 'running' || task.status === 'paused') {
      return { error: `Cannot delete task in "${task.status}" status. Only completed, failed, cancelled, or pending tasks can be deleted.` }
    }
    this.queue.deleteTask(id)
    return { ok: true }
  }

  @Post('tasks/batch-delete')
  batchDelete(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    return this.queue.batchDeleteTasks(body.ids)
  }

  @Put('tasks/:id')
  updateTask(@Param('id') id: string, @Body() payload: CrawlPayload) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status === 'running') return { error: 'Cannot edit a running task' }
    this.queue.updateTaskPayload(id, payload)
    return { ok: true }
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.sse.getTaskStream()
  }

  private async processCrawlTask(taskId: string, payload: CrawlPayload, resumeState?: any) {
    const {
      url, rules, itemSelector, nextPageSelector,
      maxPages, maxItems, paginationMode, loadMoreSelector,
      detailLinkSelector, detailRules,
      urlPattern, pageStart = 1,
      titleField,
      detailLinkField, mediaUrlField,
      errorMode = 'standard',
      mode = itemSelector ? 'list' : 'single',
    } = payload

    // Resolve pagination mode (backward-compatible)
    const hasUrlPattern = !!urlPattern
    const resolvedPaginationMode = paginationMode
      || (mode === 'single' ? 'none' : (nextPageSelector || hasUrlPattern ? 'page' : 'none'))

    // maxPages: undefined or 0 = crawl all pages without limit
    const resolvedMaxPages = maxPages || 0
    const isUnlimited = resolvedPaginationMode === 'page' ? (resolvedMaxPages === 0) : true

    let errorCount = 0
    let skippedItems = 0

    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 0)

      const startPage = resumeState?.page != null ? resumeState.page : (hasUrlPattern ? pageStart : 0)
      let currentUrl = resumeState?.currentUrl || url
      let totalItems = resumeState?.totalItems || 0
      let pageIndex = startPage

      while (true) {
        // Check for pause/cancel before each page
        const currentTask = this.queue.getTask(taskId)
        if (!currentTask || currentTask.status === 'cancelled') return
        if (currentTask.status === 'paused') {
          this.queue.updateTaskResult(taskId, { currentUrl, page: pageIndex, totalItems, errorCount, skippedItems, paused: true })
          return
        }

        // Page limit check (skip if unlimited)
        if (resolvedPaginationMode === 'page' && !isUnlimited) {
          if (hasUrlPattern) {
            if (pageIndex - pageStart + 1 > resolvedMaxPages) break
          } else {
            if (pageIndex >= resolvedMaxPages) break
          }
        }

        // Safety cap
        if (resolvedPaginationMode === 'page' && pageIndex >= 10000) {
          console.warn(`[crawler] Reached safety cap of 10000 pages for task ${taskId}`)
          break
        }

        // --- Fetch list page with retry ---
        let html: string
        try {
          html = await this.fetchWithRetry(currentUrl, errorMode === 'standard' ? 2 : 0)
        } catch (fetchErr: any) {
          // Determine if this is end-of-pages or a real error
          if (this.isEndOfPages(fetchErr, pageIndex, pageStart, hasUrlPattern, isUnlimited)) {
            console.log(`[crawler] Page ${pageIndex} ended (end of data): ${fetchErr.message}`)
            break
          }
          if (errorMode === 'strict') throw fetchErr
          // lenient: log and skip to next page
          console.warn(`[crawler] Page ${pageIndex} fetch failed, skipping: ${fetchErr.message}`)
          errorCount++
          const nextUrl = hasUrlPattern
            ? this.buildPatternUrl(urlPattern, ++pageIndex)
            : this.findNextPageUrl('', currentUrl, nextPageSelector, loadMoreSelector)
          if (nextUrl) { currentUrl = nextUrl; continue } else break
        }

        // Extract items
        const items = this.crawler.parseHtml(
          html, rules, mode === 'list' ? (itemSelector || undefined) : undefined,
        )

        // Empty page detection
        if (hasUrlPattern && isUnlimited && items.length === 0 && pageIndex > pageStart) {
          console.log(`[crawler] Page ${pageIndex} returned 0 items, stopping`)
          break
        }

        // --- Detail page extraction ---
        const $ = cheerio.load(html)
        const itemElements = $(itemSelector || 'body').toArray()
        const hasDetail = (detailRules && detailRules.length > 0) && (detailLinkField || detailLinkSelector)

        for (let i = 0; i < items.length; i++) {
          let detailUrl = ''
          if (hasDetail) {
            // 1. Try detailLinkField (explicit field name from extracted data)
            if (detailLinkField && items[i][detailLinkField]) {
              const raw = items[i][detailLinkField]
              detailUrl = raw.startsWith('http') ? raw : new URL(raw, currentUrl).href
            }
            // 2. Fall back to CSS selector on DOM
            else if (detailLinkSelector && i < itemElements.length) {
              const detailHref = $(detailLinkSelector, itemElements[i]).attr('href')
              if (detailHref) detailUrl = new URL(detailHref, currentUrl).href
            }

            if (detailUrl) {
              try {
                const detailHtml = await this.fetchWithRetry(detailUrl, errorMode === 'strict' ? 0 : 1)
                const detailData = this.crawler.parseHtml(detailHtml, detailRules)
                if (detailData.length > 0) {
                  Object.assign(items[i], detailData[0])
                }
              } catch {
                if (errorMode === 'strict') throw new Error(`Detail page failed: ${detailUrl}`)
                skippedItems++
                console.warn(`[crawler] Detail page fetch failed, skipping: ${detailUrl}`)
              }
            }
          }
          if (detailUrl) {
            items[i]._detail_url = detailUrl
          }
        }

        // Insert items to DB
        const insertStmt = this.db.db.prepare(`
          INSERT OR REPLACE INTO crawl_items (id, task_id, source_url, detail_url, title, media_url, media_type, media_source, status, extra_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'crawled', ?)
        `)

        for (const item of items) {
          const itemId = uuid()
          // Media URL: user-specified fields first, then auto-detection fallback (camelCase)
          const mediaFields = mediaUrlField
            ? [...mediaUrlField.split(',').map(s => s.trim()).filter(Boolean),
               'videoUrl', 'audioUrl', 'mediaUrl', 'imageUrl', 'picUrl', 'thumbnail', 'image', 'url', 'link']
            : ['videoUrl', 'audioUrl', 'mediaUrl', 'imageUrl', 'picUrl', 'thumbnail', 'image', 'url', 'link']
          const mediaUrl = mediaFields.reduce((found, field) => found || (item[field] || ''), '') as string
          const { type, source } = this.crawler.detectMediaType(mediaUrl)
          const itemTitle = this.pickFirst(item, titleField
            ? [...titleField.split(',').map(s => s.trim()).filter(Boolean), 'title', 'name', 'articleTitle', 'productName', 'heading']
            : ['title', 'name', 'articleTitle', 'productName', 'heading'])
            || (item.text?.[0])
            || (typeof mediaUrl === 'string' && mediaUrl ? mediaUrl.split('/').pop()?.split('?')[0] : '')
            || ''
          const detailUrl = item._detail_url || null
          // Remove internal fields before storing
          delete item._detail_url

          insertStmt.run(itemId, taskId, currentUrl, detailUrl, itemTitle, mediaUrl, type, source, JSON.stringify(item))
          totalItems++

          if (resolvedPaginationMode === 'count' && maxItems && totalItems >= maxItems) break
        }

        // Progress
        if (resolvedPaginationMode === 'count' && maxItems) {
          this.queue.updateTaskProgress(taskId, Math.min(Math.round((totalItems / maxItems) * 100), 99))
        } else if (resolvedPaginationMode === 'page' && !isUnlimited) {
          const pagesDone = hasUrlPattern ? (pageIndex - pageStart + 1) : (pageIndex + 1)
          this.queue.updateTaskProgress(taskId, Math.min(Math.round((pagesDone / resolvedMaxPages) * 100), 99))
        } else {
          this.queue.updateTaskProgress(taskId, Math.min(pageIndex + 1, 99))
        }

        if (resolvedPaginationMode === 'count' && maxItems && totalItems >= maxItems) break

        // Navigate to next page
        if (hasUrlPattern) {
          pageIndex++
          currentUrl = this.buildPatternUrl(urlPattern, pageIndex)
          continue
        }
        const nextUrl = this.findNextPageUrl(html, currentUrl, nextPageSelector, loadMoreSelector)
        if (nextUrl) { currentUrl = nextUrl; pageIndex++; continue }
        break
      }

      const result: any = { itemsFound: totalItems }
      if (errorCount > 0) result.skippedPages = errorCount
      if (skippedItems > 0) result.skippedItems = skippedItems
      this.queue.updateTaskResult(taskId, result)
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }

  /** Fetch with optional retry on failure */
  private async fetchWithRetry(url: string, maxRetries: number): Promise<string> {
    let lastErr: any
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.crawler.fetchHtml(url)
      } catch (err) {
        lastErr = err
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
    }
    throw lastErr
  }

  /** Judge whether a fetch error means "end of pages" vs a mid-crawl error */
  private isEndOfPages(err: any, pageIndex: number, pageStart: number, hasUrlPattern: boolean, isUnlimited: boolean): boolean {
    const msg: string = err?.message || ''
    // HTTP 404 almost always means end of data for URL pattern mode after first page
    if (/HTTP 404/.test(msg) && hasUrlPattern && isUnlimited && pageIndex > pageStart) return true
    // HTTP 404 on first page is NOT end-of-pages — it's a bad URL
    return false
  }

  /** Find the next page URL from pagination or load-more link */
  private findNextPageUrl(html: string, currentUrl: string, nextPageSelector?: string, loadMoreSelector?: string): string | null {
    const $ = cheerio.load(html)

    // Empty html means we're being called after a page fetch error — return null
    if (!html) return null

    // Try next-page selector first
    if (nextPageSelector) {
      const nextHref = $(nextPageSelector).attr('href')
      if (nextHref) {
        return new URL(nextHref, currentUrl).href
      }
    }

    // Try load-more selector (some sites use link-based "load more")
    if (loadMoreSelector) {
      const moreHref = $(loadMoreSelector).attr('href')
      if (moreHref) {
        return new URL(moreHref, currentUrl).href
      }
    }

    return null
  }

  /** Build URL from pattern by replacing {page} placeholder */
  private buildPatternUrl(urlPattern: string, page: number): string {
    return urlPattern.replace(/\{page\}/g, String(page))
  }

  /** Re-crawl a single item using its stored source/detail URL */
  private async recrawlSingleItem(itemId: string) {
    const item = this.db.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(itemId) as any
    if (!item) return { error: 'Item not found' }
    const task = this.queue.getTask(item.task_id)
    if (!task) return { error: 'Parent task not found' }
    const payload: CrawlPayload = task.payload

    try {
      let data: Record<string, any> | null = null

      if (item.detail_url) {
        // Fetch detail page directly — most reliable
        let detailHtml: string
        try {
          detailHtml = await this.crawler.fetchHtml(item.detail_url)
        } catch (err: any) {
          this.db.db.prepare(`UPDATE crawl_items SET status = 'error' WHERE id = ?`).run(itemId)
          return { error: `详情页不可访问，该项可能已下架: ${err.message}` }
        }
        const detailResults = this.crawler.parseHtml(detailHtml, payload.detailRules || payload.rules)
        if (detailResults.length > 0) {
          data = detailResults[0]
          // Try to re-extract list-level fields from source_url
          if (item.source_url && item.source_url !== item.detail_url) {
            try {
              const listHtml = await this.crawler.fetchHtml(item.source_url)
              const listResults = this.crawler.parseHtml(listHtml, payload.rules, payload.itemSelector)
              const matched = this.findMatchingItem(listResults, item, payload.idField)
              if (matched) {
                delete (matched as any)._detail_url
                data = { ...matched, ...data }
              }
            } catch { /* list page re-fetch is best-effort */ }
          }
        }
      } else {
        // No detail URL — re-extract from source list page
        let listHtml: string
        try {
          listHtml = await this.crawler.fetchHtml(item.source_url)
        } catch (err: any) {
          this.db.db.prepare(`UPDATE crawl_items SET status = 'error' WHERE id = ?`).run(itemId)
          return { error: `列表页不可访问: ${err.message}` }
        }
        const listResults = this.crawler.parseHtml(listHtml, payload.rules, payload.itemSelector)
        data = this.findMatchingItem(listResults, item, payload.idField)
        if (!data) {
          this.db.db.prepare(`UPDATE crawl_items SET status = 'error' WHERE id = ?`).run(itemId)
          const hint = payload.idField
            ? `在列表页中未找到 idField="${payload.idField}" 匹配的项，该项可能已下架或移到其他页面`
            : '在列表页中未找到匹配的项，该项可能已下架或移到其他页面。建议设置 idField 以提高匹配准确度'
          return { error: hint }
        }
      }

      if (!data) return { error: '未能重新提取到数据' }

      const mediaFields = payload.mediaUrlField
        ? [...payload.mediaUrlField.split(',').map(s => s.trim()).filter(Boolean),
           'videoUrl', 'audioUrl', 'mediaUrl', 'imageUrl', 'picUrl', 'thumbnail', 'image', 'url', 'link']
        : ['videoUrl', 'audioUrl', 'mediaUrl', 'imageUrl', 'picUrl', 'thumbnail', 'image', 'url', 'link']
      const mediaUrl = mediaFields.reduce((found, field) => found || (data[field] || ''), '') as string
      const { type, source } = this.crawler.detectMediaType(mediaUrl)
      const title = this.pickFirst(data, payload.titleField
        ? [...payload.titleField.split(',').map(s => s.trim()).filter(Boolean), 'title', 'name', 'articleTitle', 'productName', 'heading']
        : ['title', 'name', 'articleTitle', 'productName', 'heading']) || item.title || ''
      delete (data as any)._detail_url

      this.db.db.prepare(`
        UPDATE crawl_items SET title = ?, media_url = ?, media_type = ?, media_source = ?, status = 'crawled', extra_data = ?, source_url = ?
        WHERE id = ?
      `).run(title, mediaUrl, type, source, JSON.stringify(data), item.source_url, itemId)

      return { ok: true, title }
    } catch (err: any) {
      this.db.db.prepare(`UPDATE crawl_items SET status = 'error' WHERE id = ?`).run(itemId)
      return { error: err.message }
    }
  }

  /** Pick first non-empty value from item by trying each field name in order (comma-separated supported) */
  private pickFirst(item: Record<string, any>, fields: string[]): string {
    for (const f of fields) {
      const val = item[f]
      if (val != null && val !== '') return String(val)
    }
    return ''
  }

  /** Find a matching item from list results.
   *  Priority: idField → link → title → position fallback (only if allowFallback) */
  private findMatchingItem(listResults: Record<string, any>[], originalItem: any, idField?: string, allowFallback = false): Record<string, any> | null {
    const origExtra: any = safeJsonParse(originalItem.extra_data)

    // 1. Match by unique ID field (most reliable)
    if (idField) {
      const origId = origExtra[idField] ?? originalItem[idField]
      if (origId != null) {
        for (const r of listResults) {
          if (r[idField] != null && String(r[idField]) === String(origId)) return r
        }
      }
    }

    // 2. Match by link field
    const origLink = origExtra?.link || origExtra?.url || originalItem.media_url
    if (origLink) {
      for (const r of listResults) {
        if (r.link === origLink || r.url === origLink) return r
      }
    }

    // 3. Match by title
    if (originalItem.title) {
      for (const r of listResults) {
        if (r.title === originalItem.title || r.name === originalItem.title) return r
      }
    }

    // 4. Position fallback — only when safe (item hasn't moved)
    return allowFallback && listResults.length > 0 ? listResults[0] : null
  }
}

function safeJsonParse(v: any): any {
  if (!v) return {}
  try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return {} }
}
