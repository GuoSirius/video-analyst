import { Injectable, Controller, Post, Get, Delete, Put, Param, Body, Query, Sse, Res } from '@nestjs/common'
import { Observable, merge } from 'rxjs'
import { Response } from 'express'
import * as cheerio from 'cheerio'
import * as yaml from 'js-yaml'
import * as ExcelJS from 'exceljs'
import * as path from 'path'
import * as fs from 'fs'
import AdmZip from 'adm-zip'
import { CrawlerService, CrawlPayload, FieldSpec, UrlTransform } from './crawler.service'
import { QueueService } from '../common/queue/queue.service'
import { SseService } from '../common/sse/sse.service'
import { DatabaseService } from '../common/database/database.service'
import { DownloadService } from '../downloader/download.service'
import { resolveFileType, extractExtFromUrl, extractVideoId, isVideoPlatform } from '../common/utils/url.util'
import { v4 as uuid } from 'uuid'
import { formatTimestamp } from '../common/utils/date.util'

const isUrl = (val: string) => val.startsWith('http://') || val.startsWith('https://') || val.startsWith('//')
const normalizeUrl = (val: string, sourceUrl?: string) => {
  if (!val.startsWith('//')) return val
  try {
    const proto = sourceUrl ? new URL(sourceUrl).protocol : 'https:'
    return proto + val
  } catch {
    return 'https:' + val
  }
}

@Injectable()
@Controller('api/crawler')
export class CrawlerController {
  constructor(
    private readonly crawler: CrawlerService,
    private readonly queue: QueueService,
    private readonly sse: SseService,
    private readonly db: DatabaseService,
    private readonly download: DownloadService,
  ) {}

  @Post('crawl')
  async startCrawl(@Body() payload: CrawlPayload) {
    const task = this.queue.createTask('crawl', payload)
    if (payload.autoStart) {
      this.processCrawlTask(task.id, payload)
    }
    return { taskId: task.id }
  }

  @Get('tasks/paginated')
  getTasksPaginated(@Query() query: {
    status?: string
    keyword?: string
    page?: string
    pageSize?: string
  }) {
    const { status, keyword, page, pageSize } = query
    const pageNum = page ? parseInt(page, 10) : 1
    const size = pageSize ? parseInt(pageSize, 10) : 20
    const offset = (pageNum - 1) * size

    let tasks = this.queue.getTasksByType('crawl') as any[]

    if (keyword) {
      const kw = keyword.toLowerCase()
      tasks = tasks.filter((t: any) => {
        const name = (t.payload?.name || '').toLowerCase()
        const url = (t.payload?.url || '').toLowerCase()
        return name.includes(kw) || url.includes(kw)
      })
    }

    if (status && status !== 'all') {
      tasks = tasks.filter((t: any) => t.status === status)
    }

    const total = tasks.length
    const paginated = tasks.slice(offset, offset + size)

    return { tasks: paginated, total, page: pageNum, pageSize: size }
  }

  @Get('tasks')
  getTasks(@Query() query: { status?: string; keyword?: string }) {
    const { status, keyword } = query
    let tasks = this.queue.getTasksByType('crawl') as any[]

    if (keyword) {
      const kw = keyword.toLowerCase()
      tasks = tasks.filter((t: any) => {
        const name = (t.payload?.name || '').toLowerCase()
        const url = (t.payload?.url || '').toLowerCase()
        return name.includes(kw) || url.includes(kw)
      })
    }

    if (status && status !== 'all') {
      tasks = tasks.filter((t: any) => t.status === status)
    }

    return tasks
  }

  /** 返回所有已出现过的来源值（用于前端动态筛选项），将逗号拼接的值拆分为独立值再去重 */
  @Get('sources')
  getSources() {
    const rows = this.db.db.prepare(
      "SELECT DISTINCT media_source FROM crawl_items WHERE media_source IS NOT NULL AND media_source != ''"
    ).all() as { media_source: string }[]

    const uniqueSources = new Set<string>()
    for (const row of rows) {
      // 兼容逗号拼接的聚合来源 (e.g. "bilibili,direct") — 拆分为独立值
      row.media_source.split(',').map(s => s.trim()).filter(Boolean).forEach(s => uniqueSources.add(s))
    }
    return Array.from(uniqueSources).sort()
  }

  @Get('items')
  getItems(@Query() query: {
    taskId?: string
    status?: string
    mediaSource?: string
    keyword?: string
    page?: string
    pageSize?: string
  }) {
    const { taskId, status, mediaSource, keyword, page, pageSize } = query
    const pageNum = page ? parseInt(page, 10) : 1
    const size = pageSize ? parseInt(pageSize, 10) : 20
    const offset = (pageNum - 1) * size

    const conditions: string[] = []
    const params: any[] = []

    if (taskId) {
      conditions.push('task_id = ?')
      params.push(taskId)
    }
    if (mediaSource) {
      // Aggregated source is comma-separated (e.g. "bilibili,direct") — use LIKE for matching
      conditions.push("(media_source = ? OR media_source LIKE ?)")
      params.push(mediaSource, `%${mediaSource}%`)
    }

    if (status && status !== 'all') {
      if (status === 'not_imported') {
        conditions.push("(status = 'crawled' AND (download_status IS NULL OR download_status != 'imported'))")
      } else if (status === 'imported') {
        conditions.push("(status = 'crawled' AND download_status = 'imported')")
      } else {
        conditions.push('status = ?')
        params.push(status)
      }
    }

    if (keyword) {
      const like = `%${keyword}%`
      conditions.push('(title LIKE ? OR media_url LIKE ? OR source_url LIKE ? OR extra_data LIKE ?)')
      params.push(like, like, like, like)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRow = this.db.db.prepare(`SELECT COUNT(*) as count FROM crawl_items ${whereClause}`).get(...params) as any
    const total = countRow?.count || 0

    const rows = this.db.db.prepare(`
      SELECT * FROM crawl_items ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, size, offset) as any[]

    return {
      data: rows,
      total,
      page: pageNum,
      pageSize: size,
    }
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

  @Post('items/:id/import-download')
  async importToDownloadQueue(
    @Param('id') id: string,
    @Body() body?: { retry?: boolean; autoDownload?: boolean },
  ) {
    const item = this.db.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(id) as any
    if (!item) return { error: '采集项不存在' }

    const task = this.queue.getTask(item.task_id)
    if (!task) return { error: '所属任务不存在' }

    const payload: CrawlPayload = task.payload
    const extraData = safeJsonParse(item.extra_data)
    const mediaSpec = payload.mediaUrlField || { fields: [], mode: 'all' }

    // 收集所有待下载的 URL（含转换后的）
    const urlsToDownload = this.resolveDownloadUrls(extraData, mediaSpec, payload.urlTransforms || [], item.title, item.id)

    if (urlsToDownload.length === 0) {
      // 兜底：检查 media_url 字段
      if (item.media_url && isUrl(item.media_url)) {
        const url = normalizeUrl(item.media_url)
        urlsToDownload.push({
          url: this.applyUrlTransform(url, 'media_url', payload.urlTransforms || [], extraData),
          fieldName: 'media_url',
          filename: this.getFilename(url, 'media_url', item.title, item.id),
          fileType: this.getFileType(url, extractExtFromUrl(url)),
        })
      }
    }

    if (urlsToDownload.length === 0) {
      return { error: '未找到需要下载的媒体资源' }
    }

    // Build reimport opts (for scheme C)
    const reimportOpts = {
      autoDownload: body?.autoDownload ?? false,
      itemId: id,
      urls: urlsToDownload.map(u => {
        const { dlMethod, ytDlpOptsJson } = this.resolveDownloadConfig(u.fieldName, payload.urlTransforms || [])
        return {
          url: u.url,
          fieldName: u.fieldName,
          filename: u.filename,
          fileType: u.fileType,
          downloadMethod: dlMethod,
          ytDlpOptions: ytDlpOptsJson ? JSON.parse(ytDlpOptsJson) : null,
        }
      }),
    }

    // Scheme C: if downloading tasks exist, mark reimport_pending instead of replacing
    if (body?.retry) {
      const hasDownloading = this.db.db.prepare(
        "SELECT COUNT(*) as count FROM download_queue WHERE item_id = ? AND status = 'downloading'"
      ).get(id) as any

      if (hasDownloading?.count > 0) {
        // Set reimport_pending on all downloading tasks for this item
        const updatedCount = this.db.db.prepare(
          `UPDATE download_queue SET reimport_pending = 1, reimport_opts = ? WHERE item_id = ? AND status = 'downloading'`
        ).run(JSON.stringify(reimportOpts), id).changes
        return {
          ok: true,
          pendingReimport: true,
          message: `有 ${updatedCount} 个下载任务正在进行中，将在完成后自动重新带入`,
        }
      }
    }

    // Safe to delete old and create new
    this.db.db.prepare('DELETE FROM download_queue WHERE item_id = ?').run(id)

    const autoDownload = body?.autoDownload ?? false
    const status = autoDownload ? 'pending' : 'paused'

    const insertStmt = this.db.db.prepare(`
      INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, download_method, yt_dlp_options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const createdTasks: string[] = []
    for (const u of reimportOpts.urls) {
      const dTaskId = uuid()
      const ytOptsJson = u.ytDlpOptions ? JSON.stringify(u.ytDlpOptions) : null
      insertStmt.run(dTaskId, id, u.url, u.filename, u.fileType, u.fieldName, status, u.downloadMethod, ytOptsJson)
      createdTasks.push(dTaskId)
    }

    this.db.db.prepare(`UPDATE crawl_items SET download_status = 'imported' WHERE id = ?`).run(id)

    // When autoDownload is true, trigger immediate download processing
    if (autoDownload) {
      setImmediate(() => this.download.processDownloads())
    }

    return { ok: true, count: createdTasks.length, taskIds: createdTasks, autoDownload }
  }

  @Post('items/:id/cancel')
  cancelItem(@Param('id') id: string) {
    const item = this.db.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(id) as any
    if (!item) return { error: '采集项不存在' }
    if (item.status !== 'processing') return { error: '只能取消采集中状态的项' }
    this.db.db.prepare(`UPDATE crawl_items SET status = 'pending' WHERE id = ?`).run(id)
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
    if (task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed') {
      return { error: 'Only completed, cancelled or failed tasks can be re-run' }
    }
    this.queue.reRunTask(id)
    this.processCrawlTask(id, task.payload)
    return { ok: true }
  }

  @Post('tasks/:id/clear-items')
  async clearItems(@Param('id') id: string) {
    this.db.db.prepare('DELETE FROM crawl_items WHERE task_id = ?').run(id)
    this.db.db.prepare('DELETE FROM download_queue WHERE item_id IN (SELECT id FROM crawl_items WHERE task_id = ?)').run(id)
    return { ok: true }
  }

  @Delete('tasks/:id')
  deleteTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
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

  @Post('tasks/batch-start')
  batchStart(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of body.ids) {
      const task = this.queue.getTask(id)
      if (!task) { results.push({ id, ok: false, error: '任务不存在' }); continue }
      if (task.status === 'pending') {
        this.processCrawlTask(id, task.payload)
        results.push({ id, ok: true })
      } else if (task.status === 'paused') {
        const resumeState = task.result || {}
        this.processCrawlTask(id, task.payload, resumeState)
        results.push({ id, ok: true })
      } else {
        results.push({ id, ok: false, error: `不能执行 ${task.status} 状态的任务` })
      }
    }
    return results
  }

  @Post('tasks/batch-retry')
  batchRetry(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of body.ids) {
      const task = this.queue.getTask(id)
      if (!task) { results.push({ id, ok: false, error: '任务不存在' }); continue }
      if (task.status !== 'failed') {
        results.push({ id, ok: false, error: '只能重试失败状态的任务' }); continue
      }
      this.queue.retryTask(id)
      this.processCrawlTask(id, task.payload)
      results.push({ id, ok: true })
    }
    return results
  }

  @Post('tasks/batch-rerun')
  batchReRun(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of body.ids) {
      const task = this.queue.getTask(id)
      if (!task) { results.push({ id, ok: false, error: '任务不存在' }); continue }
      if (task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed') {
        results.push({ id, ok: false, error: '只能重新执行已完成/已取消/失败状态的任务' }); continue
      }
      this.queue.reRunTask(id)
      this.processCrawlTask(id, task.payload)
      results.push({ id, ok: true })
    }
    return results
  }

  @Post('tasks/batch-clear-items')
  batchClearItems(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of body.ids) {
      const task = this.queue.getTask(id)
      if (!task) { results.push({ id, ok: false, error: '任务不存在' }); continue }
      this.db.db.prepare('DELETE FROM crawl_items WHERE task_id = ?').run(id)
      this.db.db.prepare('DELETE FROM download_queue WHERE item_id IN (SELECT id FROM crawl_items WHERE task_id = ?)').run(id)
      results.push({ id, ok: true })
    }
    return results
  }

  @Post('tasks/batch-auto-pipeline')
  batchAutoPipeline(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of body.ids) {
      const task = this.queue.getTask(id)
      if (!task) { results.push({ id, ok: false, error: '任务不存在' }); continue }
      // Enable full pipeline on the task payload
      const payload = { ...task.payload, autoPipeline: true, autoDownload: true, autoTranscode: true, autoAI: true }
      this.queue.updateTaskPayload(id, payload)
      if (task.status === 'pending') {
        this.processCrawlTask(id, payload)
        results.push({ id, ok: true })
      } else if (task.status === 'paused') {
        const resumeState = task.result || {}
        this.processCrawlTask(id, payload, resumeState)
        results.push({ id, ok: true })
      } else if (task.status === 'failed') {
        this.queue.retryTask(id)
        this.processCrawlTask(id, payload)
        results.push({ id, ok: true })
      } else if (task.status === 'completed' || task.status === 'cancelled') {
        // 已完成的任务：直接触发下载 → 转码 → 识别 → AI
        this.autoDownloadItems(id, payload).catch(err => {
          console.error(`[batchAutoPipeline] autoDownload failed for task ${id}:`, err.message)
        })
        results.push({ id, ok: true })
      } else {
        results.push({ id, ok: false, error: `不支持 ${task.status} 状态的任务` })
      }
    }
    return results
  }

  // ════════════════════════════════════════════════════════════════
  // 采集项批量操作
  // ════════════════════════════════════════════════════════════════

  @Post('items/batch-delete')
  batchDeleteItems(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: { id: string; ok: boolean }[] = []
    const deleteStmt = this.db.db.prepare('DELETE FROM crawl_items WHERE id = ?')
    for (const id of body.ids) {
      deleteStmt.run(id)
      results.push({ id, ok: true })
    }
    return results
  }

  @Post('items/batch-crawl')
  async batchCrawlItems(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of body.ids) {
      const item = this.db.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(id) as any
      if (!item) { results.push({ id, ok: false, error: '采集项不存在' }); continue }
      if (item.status !== 'pending') { results.push({ id, ok: false, error: '只能采集待采集状态的项' }); continue }
      try {
        const res = await this.recrawlSingleItem(id)
        results.push({ id, ok: !res.error, error: res.error })
      } catch (err: any) {
        results.push({ id, ok: false, error: err.message })
      }
    }
    return results
  }

  @Post('items/batch-recrawl')
  async batchRecrawlItems(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of body.ids) {
      const item = this.db.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(id) as any
      if (!item) { results.push({ id, ok: false, error: '采集项不存在' }); continue }
      if (item.status !== 'crawled' && item.status !== 'error') {
        results.push({ id, ok: false, error: '只能重采已采集或采集失败状态的项' }); continue
      }
      try {
        const res = await this.recrawlSingleItem(id)
        results.push({ id, ok: !res.error, error: res.error })
      } catch (err: any) {
        results.push({ id, ok: false, error: err.message })
      }
    }
    return results
  }

  @Post('items/batch-import-download')
  async batchImportDownload(@Body() body: { ids: string[]; retry?: boolean; autoDownload?: boolean }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: Array<{ id: string; ok: boolean; pendingReimport?: boolean; error?: string }> = []
    for (const id of body.ids) {
      const item = this.db.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(id) as any
      if (!item) { results.push({ id, ok: false, error: '采集项不存在' }); continue }
      if (item.status !== 'crawled') { results.push({ id, ok: false, error: '只能带入已采集状态的项' }); continue }
      if (!body.retry && item.download_status === 'imported') {
        results.push({ id, ok: false, error: '该项已带入下载，请使用重新带入' }); continue
      }
      try {
        const task = this.queue.getTask(item.task_id)
        if (!task) { results.push({ id, ok: false, error: '所属任务不存在' }); continue }
        const payload: CrawlPayload = task.payload
        const extraData = safeJsonParse(item.extra_data)
        const mediaSpec = payload.mediaUrlField || { fields: [], mode: 'all' }
        const urlsToDownload = this.resolveDownloadUrls(extraData, mediaSpec, payload.urlTransforms || [], item.title, item.id)
        if (urlsToDownload.length === 0 && item.media_url && isUrl(item.media_url)) {
          const url = normalizeUrl(item.media_url)
          urlsToDownload.push({
            url: this.applyUrlTransform(url, 'media_url', payload.urlTransforms || [], extraData),
            fieldName: 'media_url',
            filename: this.getFilename(url, 'media_url', item.title, item.id),
            fileType: this.getFileType(url, extractExtFromUrl(url)),
          })
        }
        if (urlsToDownload.length === 0) { results.push({ id, ok: false, error: '未找到需要下载的媒体资源' }); continue }

        const reimportOpts = {
          autoDownload: body.autoDownload ?? false,
          itemId: id,
          urls: urlsToDownload.map(u => {
            const { dlMethod, ytDlpOptsJson } = this.resolveDownloadConfig(u.fieldName, payload.urlTransforms || [])
            return {
              url: u.url, fieldName: u.fieldName, filename: u.filename, fileType: u.fileType,
              downloadMethod: dlMethod,
              ytDlpOptions: ytDlpOptsJson ? JSON.parse(ytDlpOptsJson) : null,
            }
          }),
        }

        // Scheme C: if downloading tasks exist, mark reimport_pending
        if (body.retry) {
          const hasDownloading = this.db.db.prepare(
            "SELECT COUNT(*) as count FROM download_queue WHERE item_id = ? AND status = 'downloading'"
          ).get(id) as any
          if (hasDownloading?.count > 0) {
            this.db.db.prepare(
              `UPDATE download_queue SET reimport_pending = 1, reimport_opts = ? WHERE item_id = ? AND status = 'downloading'`
            ).run(JSON.stringify(reimportOpts), id)
            results.push({ id, ok: true, pendingReimport: true })
            continue
          }
        }

        this.db.db.prepare('DELETE FROM download_queue WHERE item_id = ?').run(id)

        const autoDownload = body.autoDownload ?? false
        const status = autoDownload ? 'pending' : 'paused'

        const insertStmt = this.db.db.prepare(`
          INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, download_method, yt_dlp_options)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const u of reimportOpts.urls) {
          const dTaskId = uuid()
          const ytOptsJson = u.ytDlpOptions ? JSON.stringify(u.ytDlpOptions) : null
          insertStmt.run(dTaskId, id, u.url, u.filename, u.fileType, u.fieldName, status, u.downloadMethod, ytOptsJson)
        }
        this.db.db.prepare(`UPDATE crawl_items SET download_status = 'imported' WHERE id = ?`).run(id)
        results.push({ id, ok: true })
      } catch (err: any) {
        results.push({ id, ok: false, error: err.message })
      }
    }

    // When autoDownload is true, trigger immediate download processing
    if (body.autoDownload) {
      setImmediate(() => this.download.processDownloads())
    }

    return results
  }

  @Post('items/batch-auto-pipeline')
  async batchItemsAutoPipeline(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of body.ids) {
      const item = this.db.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(id) as any
      if (!item) { results.push({ id, ok: false, error: '采集项不存在' }); continue }
      if (item.status !== 'crawled') { results.push({ id, ok: false, error: '只能对已采集项执行流水线' }); continue }
      try {
        const task = this.queue.getTask(item.task_id)
        if (!task) { results.push({ id, ok: false, error: '所属任务不存在' }); continue }
        // Enable full pipeline on parent task
        const payload = { ...task.payload, autoPipeline: true, autoDownload: true, autoTranscode: true, autoAI: true }
        this.queue.updateTaskPayload(item.task_id, payload)
        // Trigger download import
        const extraData = safeJsonParse(item.extra_data)
        const mediaSpec = payload.mediaUrlField || { fields: [], mode: 'all' }
        const urlsToDownload = this.resolveDownloadUrls(extraData, mediaSpec, payload.urlTransforms || [], item.title, item.id)
        if (urlsToDownload.length === 0 && item.media_url && isUrl(item.media_url)) {
          const url = normalizeUrl(item.media_url)
          urlsToDownload.push({
            url: this.applyUrlTransform(url, 'media_url', payload.urlTransforms || [], extraData),
            fieldName: 'media_url',
            filename: this.getFilename(url, 'media_url', item.title, item.id),
            fileType: this.getFileType(url, extractExtFromUrl(url)),
          })
        }
        if (urlsToDownload.length > 0) {
          this.db.db.prepare('DELETE FROM download_queue WHERE item_id = ?').run(id)
          const insertStmt = this.db.db.prepare(`
            INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, download_method, yt_dlp_options)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          `)
          for (const { url, fieldName, filename, fileType } of urlsToDownload) {
            const dTaskId = uuid()
            const { dlMethod, ytDlpOptsJson } = this.resolveDownloadConfig(fieldName, payload.urlTransforms || [])
            insertStmt.run(dTaskId, id, url, filename, fileType, fieldName, dlMethod, ytDlpOptsJson)
          }
          this.db.db.prepare(`UPDATE crawl_items SET download_status = 'imported' WHERE id = ?`).run(id)
        }
        results.push({ id, ok: true })
      } catch (err: any) {
        results.push({ id, ok: false, error: err.message })
      }
    }
    return results
  }

  // ════════════════════════════════════════════════════════════════
  // 导出
  // ════════════════════════════════════════════════════════════════

  @Get('export/fields')
  getExportFields(@Query('taskIds') taskIdsStr: string) {
    const taskIds = taskIdsStr ? taskIdsStr.split(',').filter(Boolean) : []
    // DB columns from crawl_items
    const dbFields = [
      { key: 'id', label: 'ID' },
      { key: 'task_id', label: '所属任务ID' },
      { key: 'source_url', label: '来源URL' },
      { key: 'detail_url', label: '详情URL' },
      { key: 'title', label: '标题' },
      { key: 'media_url', label: '媒体URL' },
      { key: 'media_source', label: '来源平台' },
      { key: 'status', label: '采集状态' },
      { key: 'download_status', label: '带入状态' },
      { key: 'created_at', label: '采集时间' },
      { key: 'updated_at', label: '更新时间' },
    ]
    // Transcription fields
    const transcriptionFields = [
      { key: 'transcription_content', label: '识别文本' },
      { key: 'transcription_language', label: '识别语言' },
      { key: 'transcription_duration', label: '音频时长' },
      { key: 'transcription_status', label: '识别状态' },
      { key: 'transcription_created_at', label: '识别时间' },
    ]
    // AI result fields
    const aiFields = [
      { key: 'ai_result', label: 'AI分析结果' },
      { key: 'ai_model', label: 'AI模型' },
      { key: 'ai_prompt', label: 'AI提示词' },
      { key: 'ai_status', label: 'AI状态' },
      { key: 'ai_created_at', label: 'AI分析时间' },
    ]
    // Extra data fields from extraction rules
    const extraFields: { key: string; label: string }[] = []
    if (taskIds.length > 0) {
      const placeholders = taskIds.map(() => '?').join(',')
      const rows = this.db.db.prepare(
        `SELECT extra_data FROM crawl_items WHERE task_id IN (${placeholders})`
      ).all(...taskIds) as any[]
      const seen = new Set<string>()
      for (const row of rows) {
        const extra = safeJsonParse(row.extra_data)
        for (const k of Object.keys(extra)) {
          if (!seen.has(k) && !['title', 'media_url', 'video_url', 'audio_url', 'url', '_media_urls'].includes(k)) {
            seen.add(k)
            extraFields.push({ key: `extra.${k}`, label: `提取字段: ${k}` })
          }
        }
      }
    }
    return { dbFields, transcriptionFields, aiFields, extraFields }
  }

  @Post('export')
  async exportData(
    @Body() body: {
      taskIds: string[]
      format: 'json' | 'yaml' | 'csv' | 'excel'
      fields: { key: string; alias: string }[]
      includeTranscriptions?: boolean
      includeAIResults?: boolean
      multiFile?: boolean
    },
    @Res() res: Response,
  ) {
    const { taskIds, format, fields, includeTranscriptions, includeAIResults, multiFile } = body
    if (!taskIds?.length) return res.status(400).json({ error: 'taskIds is required' })
    if (!fields?.length) return res.status(400).json({ error: 'fields is required' })

    const timestamp = formatTimestamp()
    const isMulti = multiFile && taskIds.length > 1

    // Build SQL template
    const buildSql = (tidCount: number) => {
      const placeholders = Array(tidCount).fill('?').join(',')
      if (includeTranscriptions || includeAIResults) {
        return `
          SELECT ci.*,
            t.content as transcription_content, t.language as transcription_language,
            t.duration as transcription_duration, t.status as transcription_status,
            t.created_at as transcription_created_at,
            ar.result as ai_result, ar.model as ai_model, ar.prompt as ai_prompt,
            ar.status as ai_status, ar.created_at as ai_created_at
          FROM crawl_items ci
          LEFT JOIN transcriptions t ON t.item_id = ci.id
          LEFT JOIN ai_results ar ON ar.transcription_id = t.id
          WHERE ci.task_id IN (${placeholders})
          ORDER BY ci.created_at DESC
        `
      }
      return `SELECT * FROM crawl_items WHERE task_id IN (${placeholders}) ORDER BY created_at DESC`
    }

    // Transform rows
    const transformRows = (rows: any[]) => rows.map(row => {
      const obj: Record<string, any> = {}
      for (const field of fields) {
        let value: any
        if (field.key.startsWith('extra.')) {
          const extraKey = field.key.slice(6)
          const extra = safeJsonParse(row.extra_data)
          value = extra?.[extraKey] ?? ''
        } else {
          value = row[field.key] ?? ''
        }
        obj[field.alias || field.key] = value
      }
      return obj
    })

    // Generate single-format string/file for one set of rows + a label
    const headers = fields.map(f => f.alias || f.key)

    async function genExcel(rows: any[]): Promise<Buffer> {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('采集数据')
      sheet.columns = headers.map(h => ({ header: h, key: h, width: 22 }))
      for (const row of rows) sheet.addRow(row)
      const headerRow = sheet.getRow(1)
      headerRow.font = { bold: true }
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }
      const buf = await workbook.xlsx.writeBuffer()
      return Buffer.from(buf as ArrayBuffer)
    }

    function genJson(rows: any[]): string {
      return JSON.stringify(rows, null, 2)
    }

    function genYaml(rows: any[]): string {
      return yaml.dump(rows, { lineWidth: -1, noRefs: true })
    }

    function genCsv(rows: any[]): string {
      const csvLines = [headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',')]
      for (const row of rows) {
        const values = headers.map(h => {
          const val = row[h] != null ? String(row[h]) : ''
          return `"${val.replace(/"/g, '""')}"`
        })
        csvLines.push(values.join(','))
      }
      return '﻿' + csvLines.join('\n')  // BOM for Excel UTF-8
    }

    // ── Multi-file (ZIP) ──
    if (isMulti) {
      const zip = new AdmZip()
      for (const tid of taskIds) {
        const rows = this.db.db.prepare(buildSql(1)).all(tid) as any[]
        const data = transformRows(rows)
        const task = this.queue.getTask(tid)
        const taskLabel = (task?.payload?.name || task?.payload?.url || tid.slice(0, 8)).replace(/[<>:"/\\|?*]/g, '_')

        if (format === 'excel') {
          zip.addFile(`${taskLabel}.xlsx`, await genExcel(data))
        } else if (format === 'json') {
          zip.addFile(`${taskLabel}.json`, Buffer.from(genJson(data), 'utf-8'))
        } else if (format === 'yaml') {
          zip.addFile(`${taskLabel}.yaml`, Buffer.from(genYaml(data), 'utf-8'))
        } else if (format === 'csv') {
          zip.addFile(`${taskLabel}.csv`, Buffer.from(genCsv(data), 'utf-8'))
        }
      }
      const zipBuffer = zip.toBuffer()
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="export_${timestamp}.zip"`)
      return res.send(zipBuffer)
    }

    // ── Single file ──
    const allRows = this.db.db.prepare(buildSql(taskIds.length)).all(...taskIds) as any[]
    const allData = transformRows(allRows)

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook()
      if (taskIds.length > 1) {
        // One sheet per task
        for (const tid of taskIds) {
          const task = this.queue.getTask(tid)
          const taskLabel = (task?.payload?.name || task?.payload?.url || tid.slice(0, 8)).slice(0, 31)
          const rows = allRows.filter((r: any) => r.task_id === tid)
          const data = transformRows(rows)
          const sheet = workbook.addWorksheet(taskLabel)
          sheet.columns = headers.map(h => ({ header: h, key: h, width: 22 }))
          for (const row of data) sheet.addRow(row)
          const headerRow = sheet.getRow(1)
          headerRow.font = { bold: true }
          headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }
        }
      } else {
        const sheet = workbook.addWorksheet('采集数据')
        sheet.columns = headers.map(h => ({ header: h, key: h, width: 22 }))
        for (const row of allData) sheet.addRow(row)
        const headerRow = sheet.getRow(1)
        headerRow.font = { bold: true }
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }
      }
      const exportDir = path.resolve(process.cwd(), '..', 'data', 'exports')
      if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true })
      const filePath = path.join(exportDir, `export_${timestamp}.xlsx`)
      await workbook.xlsx.writeFile(filePath)
      return res.download(filePath)
    }

    if (format === 'csv' && taskIds.length > 1) {
      // CSV can't have multiple sheets → ZIP even in single-file mode
      const zip = new AdmZip()
      for (const tid of taskIds) {
        const rows = allRows.filter((r: any) => r.task_id === tid)
        const data = transformRows(rows)
        const task = this.queue.getTask(tid)
        const taskLabel = (task?.payload?.name || task?.payload?.url || tid.slice(0, 8)).replace(/[<>:"/\\|?*]/g, '_')
        zip.addFile(`${taskLabel}.csv`, Buffer.from(genCsv(data), 'utf-8'))
      }
      const zipBuffer = zip.toBuffer()
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="export_${timestamp}.zip"`)
      return res.send(zipBuffer)
    }

    if (format === 'json') {
      let jsonStr: string
      if (taskIds.length > 1) {
        const grouped: Record<string, any[]> = {}
        for (const tid of taskIds) {
          const task = this.queue.getTask(tid)
          const taskLabel = (task?.payload?.name || task?.payload?.url || tid.slice(0, 8))
          grouped[taskLabel] = allData.filter((_, i) => allRows[i]?.task_id === tid)
        }
        jsonStr = JSON.stringify(grouped, null, 2)
      } else {
        jsonStr = JSON.stringify(allData, null, 2)
      }
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="export_${timestamp}.json"`)
      return res.send(jsonStr)
    }

    if (format === 'yaml') {
      let yamlStr: string
      if (taskIds.length > 1) {
        const grouped: Record<string, any[]> = {}
        for (const tid of taskIds) {
          const task = this.queue.getTask(tid)
          const taskLabel = (task?.payload?.name || task?.payload?.url || tid.slice(0, 8))
          grouped[taskLabel] = allData.filter((_, i) => allRows[i]?.task_id === tid)
        }
        yamlStr = yaml.dump(grouped, { lineWidth: -1, noRefs: true })
      } else {
        yamlStr = yaml.dump(allData, { lineWidth: -1, noRefs: true })
      }
      res.setHeader('Content-Type', 'text/yaml')
      res.setHeader('Content-Disposition', `attachment; filename="export_${timestamp}.yaml"`)
      return res.send(yamlStr)
    }

    // CSV single task
    const csvStr = genCsv(allData)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="export_${timestamp}.csv"`)
    return res.send(csvStr)
  }

  @Post('export-items')
  async exportItems(
    @Body() body: {
      itemIds: string[]
      format: 'json' | 'yaml' | 'csv' | 'excel'
      fields: { key: string; alias: string }[]
      includeTranscriptions?: boolean
      includeAIResults?: boolean
    },
    @Res() res: Response,
  ) {
    const { itemIds, format, fields, includeTranscriptions, includeAIResults } = body
    if (!itemIds?.length) return res.status(400).json({ error: 'itemIds is required' })
    if (!fields?.length) return res.status(400).json({ error: 'fields is required' })

    const timestamp = formatTimestamp()
    const placeholders = itemIds.map(() => '?').join(',')

    let sql: string
    if (includeTranscriptions || includeAIResults) {
      sql = `
        SELECT ci.*,
          t.content as transcription_content, t.language as transcription_language,
          t.duration as transcription_duration, t.status as transcription_status,
          t.created_at as transcription_created_at,
          ar.result as ai_result, ar.model as ai_model, ar.prompt as ai_prompt,
          ar.status as ai_status, ar.created_at as ai_created_at
        FROM crawl_items ci
        LEFT JOIN transcriptions t ON t.item_id = ci.id
        LEFT JOIN ai_results ar ON ar.transcription_id = t.id
        WHERE ci.id IN (${placeholders})
        ORDER BY ci.created_at DESC
      `
    } else {
      sql = `SELECT * FROM crawl_items WHERE id IN (${placeholders}) ORDER BY created_at DESC`
    }

    const rows = this.db.db.prepare(sql).all(...itemIds) as any[]

    // Transform rows
    const data = rows.map(row => {
      const obj: Record<string, any> = {}
      for (const field of fields) {
        let value: any
        if (field.key.startsWith('extra.')) {
          const extraKey = field.key.slice(6)
          const extra = safeJsonParse(row.extra_data)
          value = extra?.[extraKey] ?? ''
        } else {
          value = row[field.key] ?? ''
        }
        obj[field.alias || field.key] = value
      }
      return obj
    })

    const headers = fields.map(f => f.alias || f.key)

    const generateContent = () => {
      switch (format) {
        case 'json':
          return { type: 'application/json', ext: 'json', body: JSON.stringify(data, null, 2) }
        case 'yaml':
          return { type: 'text/yaml', ext: 'yaml', body: yaml.dump(data, { lineWidth: -1, noRefs: true }) }
        case 'csv': {
          const csvLines = [headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',')]
          for (const row of data) {
            const values = headers.map(h => {
              const val = row[h] != null ? String(row[h]) : ''
              return `"${val.replace(/"/g, '""')}"`
            })
            csvLines.push(values.join(','))
          }
          return { type: 'text/csv; charset=utf-8', ext: 'csv', body: '﻿' + csvLines.join('\n') }
        }
        case 'excel':
        default:
          return null // handled separately
      }
    }

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('采集数据')
      sheet.columns = headers.map(h => ({ header: h, key: h, width: 22 }))
      for (const row of data) sheet.addRow(row)
      const headerRow = sheet.getRow(1)
      headerRow.font = { bold: true }
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }
      const exportDir = path.resolve(process.cwd(), '..', 'data', 'exports')
      if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true })
      const filePath = path.join(exportDir, `export_${timestamp}.xlsx`)
      await workbook.xlsx.writeFile(filePath)
      return res.download(filePath)
    }

    const content = generateContent()!
    res.setHeader('Content-Type', content.type)
    res.setHeader('Content-Disposition', `attachment; filename="export_${timestamp}.${content.ext}"`)
    return res.send(content.body)
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
    return merge(this.sse.getTaskStream(), this.sse.getGenericStream())
  }

  // ════════════════════════════════════════════════════════════════
  // 核心爬虫执行逻辑
  // ════════════════════════════════════════════════════════════════

  private async processCrawlTask(taskId: string, payload: CrawlPayload, resumeState?: any) {
    const {
      url, rules, itemSelector, nextPageSelector,
      maxPages, maxItems, paginationMode, loadMoreSelector,
      detailRules,
      urlPattern, pageStart = 1,
      titleField,
      detailLinkField, mediaUrlField,
      errorMode = 'standard',
      mode = itemSelector ? 'list' : 'single',
      urlTransforms = [],
    } = payload

    const resolvedPaginationMode = paginationMode
      || (mode === 'single' ? 'none' : (nextPageSelector || urlPattern ? 'page' : 'none'))

    const resolvedMaxPages = maxPages || 0
    const isUnlimited = resolvedPaginationMode === 'page' ? (resolvedMaxPages === 0) : true

    let errorCount = 0
    let skippedItems = 0

    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 0)

      const startPage = resumeState?.page != null ? resumeState.page : (urlPattern ? pageStart : 0)
      let currentUrl = resumeState?.currentUrl || url
      let totalItems = resumeState?.totalItems || 0
      let pageIndex = startPage

      while (true) {
        const currentTask = this.queue.getTask(taskId)
        if (!currentTask || currentTask.status === 'cancelled') return
        if (currentTask.status === 'paused') {
          this.queue.updateTaskResult(taskId, { currentUrl, page: pageIndex, totalItems, errorCount, skippedItems, paused: true })
          return
        }

        if (resolvedPaginationMode === 'page' && !isUnlimited) {
          if (urlPattern) {
            if (pageIndex - pageStart + 1 > resolvedMaxPages) break
          } else {
            if (pageIndex >= resolvedMaxPages) break
          }
        }

        if (resolvedPaginationMode === 'page' && pageIndex >= 10000) {
          console.warn(`[crawler] Reached safety cap of 10000 pages for task ${taskId}`)
          break
        }

        // Fetch list page with retry
        let html: string
        try {
          html = await this.fetchWithRetry(currentUrl, errorMode === 'standard' ? 2 : 0)
        } catch (fetchErr: any) {
          if (this.isEndOfPages(fetchErr, pageIndex, pageStart, !!urlPattern, isUnlimited)) {
            console.log(`[crawler] Page ${pageIndex} ended (end of data): ${fetchErr.message}`)
            break
          }
          if (errorMode === 'strict') throw fetchErr
          console.warn(`[crawler] Page ${pageIndex} fetch failed, skipping: ${fetchErr.message}`)
          errorCount++
          const nextUrl = urlPattern
            ? this.buildPatternUrl(urlPattern, ++pageIndex)
            : this.findNextPageUrl('', currentUrl, nextPageSelector, loadMoreSelector)
          if (nextUrl) { currentUrl = nextUrl; continue } else break
        }

        const items = this.crawler.parseHtml(
          html, rules, mode === 'list' ? (itemSelector || undefined) : undefined, currentUrl,
        )

        if (urlPattern && isUnlimited && items.length === 0 && pageIndex > pageStart) {
          console.log(`[crawler] Page ${pageIndex} returned 0 items, stopping`)
          break
        }

        // Detail page extraction
        const hasDetail = (detailRules && detailRules.length > 0) && (detailLinkField?.fields?.length)

        for (let i = 0; i < items.length; i++) {
          let detailUrl = ''
          if (hasDetail) {
            // 从已提取的字段中获取详情页 URL
            if (detailLinkField?.fields?.length) {
              const raw = this.crawler.pickFirst(items[i], detailLinkField.fields)
              if (raw) {
                detailUrl = raw.startsWith('http') ? raw : new URL(raw, currentUrl).href
              }
            }

            if (detailUrl) {
              try {
                const detailHtml = await this.fetchWithRetry(detailUrl, errorMode === 'strict' ? 0 : 1)
                const detailData = this.crawler.parseHtml(detailHtml, detailRules, undefined, detailUrl)
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
          INSERT OR REPLACE INTO crawl_items (id, task_id, source_url, detail_url, title, media_url, media_type, media_source, status, download_status, extra_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'crawled', NULL, ?)
        `)

        for (const item of items) {
          const itemId = uuid()

          // ── 协议补全基准：有详情页优先用详情页协议，否则用当前列表页 ──
          const normalizeSource = item._detail_url || currentUrl

          // ── 媒体 URL 解析 ──
          let mediaUrl = ''
          const allUrlEntries: Array<{ url: string; fieldName: string; method: string }> = []

          if (mediaUrlField?.fields?.length) {
            if (mediaUrlField.mode === 'all') {
              // 逐个字段收集：空值跳过；非URL有转写规则也纳入（通过转写得到URL）
              for (const fieldName of mediaUrlField.fields) {
                const val = item[fieldName]
                if (val === null || val === undefined || val === '') continue
                const valStr = String(val)
                const transform = urlTransforms.find(t => t.fieldName === fieldName)

                let effectiveUrl: string
                let method: string

                if (isUrl(valStr)) {
                  // 值是完整URL：直接使用
                  effectiveUrl = normalizeUrl(valStr, normalizeSource)
                  method = transform?.downloadMethod || this.inferDownloadMethod(effectiveUrl)
                } else if (transform) {
                  // 值不是URL但有转写规则：应用转写得到完整URL
                  effectiveUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, item)
                  method = transform.downloadMethod || this.inferDownloadMethod(effectiveUrl)
                } else {
                  // 不是URL也没有转写规则：跳过
                  continue
                }

                allUrlEntries.push({ url: effectiveUrl, fieldName, method })
              }
              mediaUrl = allUrlEntries[0]?.url || ''
              item._media_urls = allUrlEntries.map(e => e.url)
              item._media_url_fields = allUrlEntries.map(e => e.fieldName)
              item._media_methods = allUrlEntries.map(e => e.method)
            } else {
              // first 模式：按顺序选第一个有效值
              let found = false
              for (const fieldName of mediaUrlField.fields) {
                const val = item[fieldName]
                if (val === null || val === undefined || val === '') continue
                const valStr = String(val)
                const transform = urlTransforms.find(t => t.fieldName === fieldName)

                if (isUrl(valStr)) {
                  mediaUrl = normalizeUrl(valStr, normalizeSource)
                  const method = transform?.downloadMethod || this.inferDownloadMethod(mediaUrl)
                  item._media_urls = [mediaUrl]
                  item._media_url_fields = [fieldName]
                  item._media_methods = [method]
                  found = true
                  break
                } else if (transform) {
                  mediaUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, item)
                  const method = transform.downloadMethod || this.inferDownloadMethod(mediaUrl)
                  item._media_urls = [mediaUrl]
                  item._media_url_fields = [fieldName]
                  item._media_methods = [method]
                  found = true
                  break
                }
              }
              if (!found) {
                item._media_urls = []
                item._media_url_fields = []
                item._media_methods = []
              }
            }
          }
          // 兜底自动检测
          if (!mediaUrl) {
            const autoFields = ['videoUrl', 'audioUrl', 'mediaUrl', 'imageUrl', 'picUrl', 'thumbnail', 'image', 'url', 'link']
            mediaUrl = normalizeUrl(this.crawler.pickFirst(item, autoFields), normalizeSource)
            if (mediaUrl) {
              item._media_urls = [mediaUrl]
              item._media_url_fields = ['_auto']
              item._media_methods = ['file']
            }
          }

          // ── 聚合来源：URL转写优先 → 原始URL兜底 → 源页面兜底 ──
          const aggregatedSource = this.aggregateMediaSources(item, mediaUrl, urlTransforms, currentUrl)
          // type 保留向后兼容，UI 不再使用
          const { type } = this.crawler.detectMediaType(mediaUrl)

          // ── 标题解析 ──
          const titleFields = titleField?.fields?.length
            ? titleField.fields
            : ['title', 'name', 'articleTitle', 'productName', 'heading']
          const itemTitle = this.crawler.pickFirst(item, titleFields)
            || (item.text?.[0])
            || (mediaUrl ? mediaUrl.split('/').pop()?.split('?')[0] : '')
            || ''

          const detailUrl = item._detail_url || null
          delete item._detail_url

          insertStmt.run(itemId, taskId, currentUrl, detailUrl, itemTitle, mediaUrl, type, aggregatedSource, JSON.stringify(item))
          totalItems++

          if (resolvedPaginationMode === 'count' && maxItems && totalItems >= maxItems) break
        }

        // Progress
        if (resolvedPaginationMode === 'count' && maxItems) {
          this.queue.updateTaskProgress(taskId, Math.min(Math.round((totalItems / maxItems) * 100), 99))
        } else if (resolvedPaginationMode === 'page' && !isUnlimited) {
          const pagesDone = urlPattern ? (pageIndex - pageStart + 1) : (pageIndex + 1)
          this.queue.updateTaskProgress(taskId, Math.min(Math.round((pagesDone / resolvedMaxPages) * 100), 99))
        } else {
          this.queue.updateTaskProgress(taskId, Math.min(pageIndex + 1, 99))
        }

        if (resolvedPaginationMode === 'count' && maxItems && totalItems >= maxItems) break

        // Navigate to next page
        if (urlPattern) {
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

      // ── 自动下载：采集完成后触发 ──
      if (payload.autoDownload) {
        this.autoDownloadItems(taskId, payload).catch((err) => {
          console.error(`[autoDownload] Task ${taskId} failed:`, err.message)
        })
      }
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // URL 转换 & 下载解析
  // ════════════════════════════════════════════════════════════════

  /** 对采集项的所有媒体 URL 计算来源，去重拼接（如 "bilibili,direct"）。
   *  优先使用 URL 转写规则变换后的 URL 判断来源，否则用原始值。
   *  如果所有 URL 都无法识别平台来源，会用源页面 URL 做兜底检测。 */
  private aggregateMediaSources(
    extraData: Record<string, any>,
    primaryMediaUrl: string,
    urlTransforms: UrlTransform[] = [],
    sourceUrl?: string,
  ): string {
    const sources = new Set<string>()
    // 从 _media_urls 数组收集
    if (extraData._media_urls && Array.isArray(extraData._media_urls)) {
      const fields = extraData._media_url_fields || []
      for (let i = 0; i < extraData._media_urls.length; i++) {
        const rawUrl = extraData._media_urls[i]
        if (typeof rawUrl !== 'string' || !rawUrl) continue
        const fieldName = fields[i] || ''
        // 有转写规则：对转写后的 URL 判断来源；否则直接用原始 URL
        const finalUrl = fieldName
          ? this.applyUrlTransform(rawUrl, fieldName, urlTransforms, extraData)
          : rawUrl
        const { source } = this.crawler.detectMediaType(finalUrl)
        if (source) sources.add(source)
      }
    }
    // 兜底：从主 media_url 收集
    if (primaryMediaUrl) {
      const { source } = this.crawler.detectMediaType(primaryMediaUrl)
      if (source) sources.add(source)
    }
    // 二次兜底：所有URL都无法识别平台时（只有direct/域名），用源页面URL检测
    if (sources.size === 0 || (sources.size === 1 && sources.has('direct'))) {
      if (sourceUrl) {
        const { source } = this.crawler.detectMediaType(sourceUrl)
        if (source && source !== 'direct' && source !== '') {
          sources.add(source)
          // 从源页面检测到平台时，也移除 'direct' 避免误导
          sources.delete('direct')
        }
      }
    }
    return [...sources].join(',')
  }

  /** 根据 URL 内容推断推荐的下载方式（无转写规则时使用） */
  private inferDownloadMethod(url: string): string {
    const { source } = this.crawler.detectMediaType(url)
    // 已知视频平台 → 需要 yt-dlp 解析
    if (source === 'bilibili' || source === 'tencent' || source === 'youku' || source === 'youtube') {
      return 'yt-dlp'
    }
    // 文件直链 / 文档 / 数据 / 图片 / 未知链接 → 直链下载
    return 'file'
  }

  /** 根据 mediaUrlField 配置从 extraData 中解析出待下载的 URL 列表 */
  private resolveDownloadUrls(
    extraData: Record<string, any>,
    mediaSpec: FieldSpec,
    urlTransforms: UrlTransform[],
    title?: string,
    itemId?: string,
  ): Array<{ url: string; fieldName: string; filename: string; fileType: string }> {
    const results: Array<{ url: string; fieldName: string; filename: string; fileType: string }> = []

    if (mediaSpec.fields.length > 0) {
      if (mediaSpec.mode === 'all') {
        // 收集所有指定字段的有效 URL（含 URL 转换）
        for (const fieldName of mediaSpec.fields) {
          const fieldValue = extraData[fieldName]
          if (fieldValue === null || fieldValue === undefined || fieldValue === '') continue
          const valStr = String(fieldValue)
          const transform = urlTransforms.find(t => t.fieldName === fieldName)

          let effectiveUrl: string
          if (isUrl(valStr)) {
            effectiveUrl = normalizeUrl(valStr)
            effectiveUrl = this.applyUrlTransform(effectiveUrl, fieldName, urlTransforms, extraData)
          } else if (transform) {
            // 字段值不是 URL 但有转换规则：应用转换得到完整 URL
            effectiveUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, extraData)
          } else {
            continue
          }

          const ext = extractExtFromUrl(effectiveUrl)
          results.push({
            url: effectiveUrl,
            fieldName,
            filename: this.getFilename(effectiveUrl, fieldName, title, itemId),
            fileType: this.getFileType(effectiveUrl, ext),
          })
        }
      } else {
        // first 模式：按顺序选第一个有效 URL（含 URL 转换）
        for (const fieldName of mediaSpec.fields) {
          const fieldValue = extraData[fieldName]
          if (fieldValue === null || fieldValue === undefined || fieldValue === '') continue
          const valStr = String(fieldValue)
          const transform = urlTransforms.find(t => t.fieldName === fieldName)

          let effectiveUrl: string
          if (isUrl(valStr)) {
            effectiveUrl = normalizeUrl(valStr)
            effectiveUrl = this.applyUrlTransform(effectiveUrl, fieldName, urlTransforms, extraData)
          } else if (transform) {
            effectiveUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, extraData)
          } else {
            continue
          }

          const ext = extractExtFromUrl(effectiveUrl)
          results.push({
            url: effectiveUrl,
            fieldName,
            filename: this.getFilename(effectiveUrl, fieldName, title, itemId),
            fileType: this.getFileType(effectiveUrl, ext),
          })
          break // first mode: 找到第一个就停止
        }
      }
    } else {
      // 未指定字段：扫描所有 URL 字段（含 URL 转换）
      for (const [fieldName, fieldValue] of Object.entries(extraData)) {
        if (fieldValue === null || fieldValue === undefined || fieldValue === '') continue
        const valStr = String(fieldValue)
        const transform = urlTransforms.find(t => t.fieldName === fieldName)

        let effectiveUrl: string
        if (isUrl(valStr)) {
          effectiveUrl = normalizeUrl(valStr)
          effectiveUrl = this.applyUrlTransform(effectiveUrl, fieldName, urlTransforms, extraData)
        } else if (transform) {
          effectiveUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, extraData)
        } else {
          continue
        }

        const ext = extractExtFromUrl(effectiveUrl)
        results.push({
          url: effectiveUrl,
          fieldName,
          filename: this.getFilename(effectiveUrl, fieldName, title, itemId),
          fileType: this.getFileType(effectiveUrl, ext),
        })
      }
    }

    return results
  }

  /** 如果该字段配置了 URL 转换规则，则用模板拼接；否则返回原 URL
   *  模板支持 {任意字段名} 占位符，会从 extraData 中查找对应值替换。
   *  例如模板 "https://v.qq.com/x/page/{videoId}?title={title}" 中，
   *  {videoId} 替换为 videoId 字段值，{title} 替换为 title 字段值。
   *  当 urlTemplate 为空时，直接返回原始值（字段值本身就是可下载的URL）。 */
  private applyUrlTransform(originalUrl: string, fieldName: string, transforms: UrlTransform[], extraData?: Record<string, any>): string {
    const rule = transforms.find(t => t.fieldName === fieldName)
    if (!rule) return originalUrl
    // urlTemplate 为空 → 字段原始值即为可下载链接（如带 yt-dlp 参数下载）
    if (!rule.urlTemplate) return originalUrl
    return rule.urlTemplate.replace(/\{(\w+)\}/g, (_, key) => {
      // 优先从 extraData 中查找任意字段的值
      if (extraData && extraData[key] != null && extraData[key] !== '') {
        return String(extraData[key])
      }
      // 兼容：如果是当前字段名本身，用原始 URL
      if (key === fieldName) return originalUrl
      // 未找到对应字段值，保留原占位符
      return `{${key}}`
    })
  }

  /** 查找字段对应的 download_method 和 yt-dlp 配置 */
  private resolveDownloadConfig(fieldName: string, transforms: UrlTransform[]): { dlMethod: string | null; ytDlpOptsJson: string | null } {
    const rule = transforms.find(t => t.fieldName === fieldName)
    if (!rule) return { dlMethod: null, ytDlpOptsJson: null }
    const dlMethod = rule.downloadMethod || null
    const ytDlpOptsJson = (dlMethod === 'yt-dlp' && rule.ytDlpOptions)
      ? JSON.stringify(rule.ytDlpOptions)
      : null
    return { dlMethod, ytDlpOptsJson }
  }

  // ════════════════════════════════════════════════════════════════
  // 自动下载
  // ════════════════════════════════════════════════════════════════

  private async autoDownloadItems(taskId: string, payload: CrawlPayload) {
    try {
      const mediaSpec = payload.mediaUrlField || { fields: [], mode: 'all' }
      const urlTransforms = payload.urlTransforms || []

      const items = this.db.db.prepare(
        "SELECT * FROM crawl_items WHERE task_id = ? AND status = 'crawled'"
      ).all(taskId) as any[]

      let createdCount = 0
      for (const item of items) {
        const extraData = safeJsonParse(item.extra_data)

        // 先删除该采集项旧的下载记录
        this.db.db.prepare('DELETE FROM download_queue WHERE item_id = ?').run(item.id)

        const urlsToDownload = this.resolveDownloadUrls(extraData, mediaSpec, urlTransforms, item.title, item.id)

        // 兜底：也检查 media_url 字段
        if (urlsToDownload.length === 0 && item.media_url && isUrl(item.media_url)) {
          const url = normalizeUrl(item.media_url)
          urlsToDownload.push({
            url: this.applyUrlTransform(url, 'media_url', urlTransforms, extraData),
            fieldName: 'media_url',
            filename: this.getFilename(url, 'media_url', item.title, item.id),
            fileType: this.getFileType(url, extractExtFromUrl(url)),
          })
        }

        if (urlsToDownload.length === 0) continue

        const insertStmt = this.db.db.prepare(`
          INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, download_method, yt_dlp_options)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `)

        for (const { url, fieldName, filename, fileType } of urlsToDownload) {
          const dTaskId = uuid()
          const { dlMethod, ytDlpOptsJson } = this.resolveDownloadConfig(fieldName, urlTransforms)
          insertStmt.run(dTaskId, item.id, url, filename, fileType, fieldName, dlMethod, ytDlpOptsJson)
          createdCount++
        }

        // 标记为已带入
        this.db.db.prepare(`UPDATE crawl_items SET download_status = 'imported' WHERE id = ?`).run(item.id)
      }

      console.log(`[autoDownload] Task ${taskId}: created ${createdCount} download tasks from ${items.length} items`)
    } catch (err: any) {
      console.error(`[autoDownload] Task ${taskId} error:`, err.message)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 工具方法
  // ════════════════════════════════════════════════════════════════

  private getFileType(url: string, ext: string): string {
    return resolveFileType(url, ext)
  }

  private getFilename(url: string, fieldName: string, title?: string, itemId?: string): string {
    const name = title?.replace(/[^\w一-龥]+/g, '_') || fieldName
    const ext = extractExtFromUrl(url)           // '' for pseudo-static or no extension
    const vid = extractVideoId(url)              // platform-native ID, or '' for non-platform
    const fallbackId = itemId?.slice(0, 8) || ''
    const idSuffix = (vid || fallbackId) ? `_${vid || fallbackId}` : ''

    if (isVideoPlatform(url)) {
      return `${name}${idSuffix}.${ext || 'mp4'}`
    }

    return ext ? `${name}${idSuffix}.${ext}` : `${name}${idSuffix || ''}`
  }

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

  private isEndOfPages(err: any, pageIndex: number, pageStart: number, hasUrlPattern: boolean, isUnlimited: boolean): boolean {
    const msg: string = err?.message || ''
    if (/HTTP 404/.test(msg) && hasUrlPattern && isUnlimited && pageIndex > pageStart) return true
    return false
  }

  private findNextPageUrl(html: string, currentUrl: string, nextPageSelector?: string, loadMoreSelector?: string): string | null {
    const $ = cheerio.load(html)
    if (!html) return null

    if (nextPageSelector) {
      const nextHref = $(nextPageSelector).attr('href')
      if (nextHref) {
        return new URL(nextHref, currentUrl).href
      }
    }

    if (loadMoreSelector) {
      const moreHref = $(loadMoreSelector).attr('href')
      if (moreHref) {
        return new URL(moreHref, currentUrl).href
      }
    }

    return null
  }

  private buildPatternUrl(urlPattern: string, page: number): string {
    return urlPattern.replace(/\{page\}/g, String(page))
  }

  // ════════════════════════════════════════════════════════════════
  // 单项重采
  // ════════════════════════════════════════════════════════════════

  private async recrawlSingleItem(itemId: string) {
    const item = this.db.db.prepare('SELECT * FROM crawl_items WHERE id = ?').get(itemId) as any
    if (!item) return { error: 'Item not found' }
    const task = this.queue.getTask(item.task_id)
    if (!task) return { error: 'Parent task not found' }
    const payload: CrawlPayload = task.payload

    try {
      let data: Record<string, any> | null = null

      if (item.detail_url) {
        let detailHtml: string
        try {
          detailHtml = await this.crawler.fetchHtml(item.detail_url)
        } catch (err: any) {
          this.db.db.prepare(`UPDATE crawl_items SET status = 'error' WHERE id = ?`).run(itemId)
          return { error: `详情页不可访问，该项可能已下架: ${err.message}` }
        }
        const detailResults = this.crawler.parseHtml(detailHtml, payload.detailRules || payload.rules, undefined, item.detail_url)
        if (detailResults.length > 0) {
          data = detailResults[0]
          if (item.source_url && item.source_url !== item.detail_url) {
            try {
              const listHtml = await this.crawler.fetchHtml(item.source_url)
              const listResults = this.crawler.parseHtml(listHtml, payload.rules, payload.itemSelector, item.source_url)
              const matched = this.findMatchingItem(listResults, item, payload.idField)
              if (matched) {
                delete (matched as any)._detail_url
                data = { ...matched, ...data }
              }
            } catch { /* best-effort */ }
          }
        }
      } else {
        let listHtml: string
        try {
          listHtml = await this.crawler.fetchHtml(item.source_url)
        } catch (err: any) {
          this.db.db.prepare(`UPDATE crawl_items SET status = 'error' WHERE id = ?`).run(itemId)
          return { error: `列表页不可访问: ${err.message}` }
        }
        const listResults = this.crawler.parseHtml(listHtml, payload.rules, payload.itemSelector, item.source_url)
        data = this.findMatchingItem(listResults, item, payload.idField)
        if (!data) {
          this.db.db.prepare(`UPDATE crawl_items SET status = 'error' WHERE id = ?`).run(itemId)
          const hint = payload.idField?.fields?.length
            ? `在列表页中未找到 idField="${payload.idField.fields.join(',')}" 匹配的项，该项可能已下架或移到其他页面`
            : '在列表页中未找到匹配的项，该项可能已下架或移到其他页面。建议设置 idField 以提高匹配准确度'
          return { error: hint }
        }
      }

      if (!data) return { error: '未能重新提取到数据' }

      // ── 协议补全基准：有详情页优先用详情页协议，否则用源页面 ──
      const normalizeSource = item.detail_url || item.source_url
      const urlTransforms = payload.urlTransforms || []

      // 媒体 URL
      const mediaUrlField = payload.mediaUrlField
      let mediaUrl = ''
      if (mediaUrlField?.fields?.length) {
        if (mediaUrlField.mode === 'all') {
          const urlEntries: Array<{ url: string; fieldName: string; method: string }> = []
          for (const fieldName of mediaUrlField.fields) {
            const val = data[fieldName]
            if (val === null || val === undefined || val === '') continue
            const valStr = String(val)
            const transform = urlTransforms.find(t => t.fieldName === fieldName)

            let effectiveUrl: string
            let method: string

            if (isUrl(valStr)) {
              effectiveUrl = normalizeUrl(valStr, normalizeSource)
              method = transform?.downloadMethod || this.inferDownloadMethod(effectiveUrl)
            } else if (transform) {
              effectiveUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, data)
              method = transform.downloadMethod || this.inferDownloadMethod(effectiveUrl)
            } else {
              continue
            }
            urlEntries.push({ url: effectiveUrl, fieldName, method })
          }
          mediaUrl = urlEntries[0]?.url || ''
          ;(data as any)._media_urls = urlEntries.map(e => e.url)
          ;(data as any)._media_url_fields = urlEntries.map(e => e.fieldName)
          ;(data as any)._media_methods = urlEntries.map(e => e.method)
        } else {
          let found = false
          for (const fieldName of mediaUrlField.fields) {
            const val = data[fieldName]
            if (val === null || val === undefined || val === '') continue
            const valStr = String(val)
            const transform = urlTransforms.find(t => t.fieldName === fieldName)

            if (isUrl(valStr)) {
              mediaUrl = normalizeUrl(valStr, normalizeSource)
              ;(data as any)._media_urls = [mediaUrl]
              ;(data as any)._media_url_fields = [fieldName]
              ;(data as any)._media_methods = [transform?.downloadMethod || this.inferDownloadMethod(mediaUrl)]
              found = true
              break
            } else if (transform) {
              mediaUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, data)
              ;(data as any)._media_urls = [mediaUrl]
              ;(data as any)._media_url_fields = [fieldName]
              ;(data as any)._media_methods = [transform.downloadMethod || this.inferDownloadMethod(mediaUrl)]
              found = true
              break
            }
          }
          if (!found) {
            ;(data as any)._media_urls = []
            ;(data as any)._media_url_fields = []
            ;(data as any)._media_methods = []
          }
        }
      }
      if (!mediaUrl) {
        mediaUrl = normalizeUrl(this.crawler.pickFirst(data, ['videoUrl', 'audioUrl', 'mediaUrl', 'imageUrl', 'picUrl', 'thumbnail', 'image', 'url', 'link']), normalizeSource)
        if (mediaUrl) {
          ;(data as any)._media_urls = [mediaUrl]
          ;(data as any)._media_url_fields = ['_auto']
          ;(data as any)._media_methods = ['file']
        }
      }

      // ── 聚合来源：URL转写优先 → 原始URL兜底 → 源页面兜底 ──
      const aggregatedSource = this.aggregateMediaSources(data, mediaUrl, urlTransforms, item.source_url)
      // type 保留向后兼容，UI 不再使用
      const { type } = this.crawler.detectMediaType(mediaUrl)
      const titleFields = payload.titleField?.fields?.length
        ? payload.titleField.fields
        : ['title', 'name', 'articleTitle', 'productName', 'heading']
      const title = this.crawler.pickFirst(data, titleFields) || item.title || ''
      delete (data as any)._detail_url

      this.db.db.prepare(`
        UPDATE crawl_items SET title = ?, media_url = ?, media_type = ?, media_source = ?, status = 'crawled', extra_data = ?, source_url = ?
        WHERE id = ?
      `).run(title, mediaUrl, type, aggregatedSource, JSON.stringify(data), item.source_url, itemId)

      return { ok: true, title }
    } catch (err: any) {
      this.db.db.prepare(`UPDATE crawl_items SET status = 'error' WHERE id = ?`).run(itemId)
      return { error: err.message }
    }
  }

  private findMatchingItem(listResults: Record<string, any>[], originalItem: any, idField?: FieldSpec): Record<string, any> | null {
    const origExtra: any = safeJsonParse(originalItem.extra_data)

    // 1. Match by unique ID field
    if (idField?.fields?.length) {
      for (const f of idField.fields) {
        const origId = origExtra[f] ?? originalItem[f]
        if (origId != null) {
          for (const r of listResults) {
            if (r[f] != null && String(r[f]) === String(origId)) return r
          }
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

    return null
  }
}

function safeJsonParse(v: any): any {
  if (!v) return {}
  try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return {} }
}
