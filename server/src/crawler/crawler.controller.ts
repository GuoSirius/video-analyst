import { Controller, Post, Get, Delete, Param, Body, Query, Sse } from '@nestjs/common'
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
    this.processCrawlTask(task.id, payload)
    return { taskId: task.id }
  }

  @Get('tasks')
  getTasks() {
    return this.queue.getTasksByType('crawl')
  }

  @Get('items')
  getItems(@Query('taskId') taskId?: string) {
    const sql = taskId
      ? 'SELECT * FROM crawl_items WHERE task_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM crawl_items ORDER BY created_at DESC'
    return taskId
      ? this.db.db.prepare(sql).all(taskId)
      : this.db.db.prepare(sql).all()
  }

  @Delete('tasks/:id')
  cancelTask(@Param('id') id: string) {
    this.queue.cancelTask(id)
    return { ok: true }
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.sse.getTaskStream()
  }

  private async processCrawlTask(taskId: string, payload: CrawlPayload) {
    const { url, rules, itemSelector, nextPageSelector, maxPages = 1, batchSize = 10 } = payload

    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 0)

      let currentUrl = url
      let totalItems = 0
      let page = 0
      const isUnlimited = maxPages === 0

      while (true) {
        if (!isUnlimited && page >= maxPages) break
        const html = await this.crawler.fetchHtml(currentUrl)
        const items = this.crawler.parseHtml(html, rules, itemSelector)

        const insertStmt = this.db.db.prepare(`
          INSERT OR REPLACE INTO crawl_items (id, task_id, source_url, title, media_url, media_type, media_source, extra_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)

        for (const item of items) {
          const itemId = uuid()
          const mediaUrl = item.media_url || item.video_url || item.audio_url || item.url || ''
          const { type, source } = this.crawler.detectMediaType(mediaUrl)

          insertStmt.run(
            itemId,
            taskId,
            currentUrl,
            item.title || item.name || '',
            mediaUrl,
            type,
            source,
            JSON.stringify(item),
          )
          totalItems++
        }

        const progress = isUnlimited ? 50 : Math.round(((page + 1) / maxPages) * 100)
        this.queue.updateTaskProgress(taskId, Math.min(progress, 99))

        if (nextPageSelector) {
          const $ = cheerio.load(html)
          const nextHref = $(nextPageSelector).attr('href')
          if (nextHref) {
            currentUrl = new URL(nextHref, currentUrl).href
            page++
            continue
          }
        }
        break
      }

      this.queue.updateTaskResult(taskId, { itemsFound: totalItems })
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }
}