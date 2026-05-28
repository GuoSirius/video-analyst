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
    this.processCrawlTask(task.id, payload)
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
  retryItem(@Param('id') id: string) {
    const item = this.db.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(id) as any
    if (!item) return { error: 'Item not found' }
    const task = this.queue.getTask(item.task_id)
    if (!task) return { error: 'Parent task not found' }
    // Re-crawl this single item by re-running the parent task
    this.queue.reRunTask(item.task_id)
    this.processCrawlTask(item.task_id, task.payload)
    return { ok: true }
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
    this.queue.reRunTask(id)
    this.processCrawlTask(id, task.payload)
    return { ok: true }
  }

  @Delete('tasks/:id')
  deleteTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status === 'running') return { error: 'Cannot delete a running task' }
    this.queue.deleteTask(id)
    return { ok: true }
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
      maxPages = 1, batchSize = 10,
      detailLinkSelector, detailRules,
    } = payload

    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 0)

      let currentUrl = resumeState?.currentUrl || url
      let totalItems = resumeState?.totalItems || 0
      let page = resumeState?.page || 0
      const isUnlimited = maxPages === 0

      while (true) {
        // Check for pause/cancel before each page
        const currentTask = this.queue.getTask(taskId)
        if (!currentTask || currentTask.status === 'cancelled') return
        if (currentTask.status === 'paused') {
          this.queue.updateTaskResult(taskId, { currentUrl, page, totalItems, paused: true })
          return
        }

        if (!isUnlimited && page >= maxPages) break

        const html = await this.crawler.fetchHtml(currentUrl)
        const items = this.crawler.parseHtml(html, rules, itemSelector)

        // Detail page extraction
        if (detailRules && detailRules.length > 0 && detailLinkSelector && itemSelector) {
          const $ = cheerio.load(html)
          const itemElements = $(itemSelector).toArray()
          for (let i = 0; i < items.length && i < itemElements.length; i++) {
            const detailHref = $(detailLinkSelector, itemElements[i]).attr('href')
            if (detailHref) {
              try {
                const detailUrl = new URL(detailHref, currentUrl).href
                const detailHtml = await this.crawler.fetchHtml(detailUrl)
                const detailData = this.crawler.parseHtml(detailHtml, detailRules)
                if (detailData.length > 0) {
                  Object.assign(items[i], detailData[0])
                }
              } catch {
                // Skip detail page fetch errors
              }
            }
          }
        }

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
