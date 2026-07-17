import { Injectable, Controller, Post, Get, Delete, Put, Param, Body, Query, Sse, Res } from '@nestjs/common'
import { Observable } from 'rxjs'
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
  ) {}

  @Post('crawl')
  async startCrawl(@Body() payload: CrawlPayload) {
    payload.fetchTimeoutMs = this.resolveFetchTimeout(payload)
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
      conditions.push('status = ?')
      params.push(status)
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

  /** 按任务统计采集项数量（轻量，避免前端全量拉取计数） */
  @Get('items/counts')
  getItemCounts(@Query('taskIds') taskIdsStr?: string) {
    let rows: { task_id: string; cnt: number }[]
    if (taskIdsStr) {
      const taskIds = taskIdsStr.split(',').filter(Boolean)
      const placeholders = taskIds.map(() => '?').join(',')
      rows = this.db.db.prepare(
        `SELECT task_id, COUNT(*) as cnt FROM crawl_items WHERE task_id IN (${placeholders}) GROUP BY task_id`
      ).all(...taskIds) as any[]
    } else {
      rows = this.db.db.prepare(
        'SELECT task_id, COUNT(*) as cnt FROM crawl_items GROUP BY task_id'
      ).all() as any[]
    }
    const counts: Record<string, number> = {}
    for (const r of rows) {
      if (r.task_id) counts[r.task_id] = (counts[r.task_id] || 0) + r.cnt
    }
    return counts
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

  @Post('tasks/:id/clear-items')
  async clearItems(@Param('id') id: string) {
    this.db.db.prepare('DELETE FROM crawl_items WHERE task_id = ?').run(id)
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
      results.push({ id, ok: true })
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

  @Put('tasks/:id')
  updateTask(@Param('id') id: string, @Body() payload: CrawlPayload) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status === 'running') return { error: 'Cannot edit a running task' }
    payload.fetchTimeoutMs = this.resolveFetchTimeout(payload)
    this.queue.updateTaskPayload(id, payload)
    return { ok: true }
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.sse.getTaskStream()
  }

  // ════════════════════════════════════════════════════════════════
  // 导出（仅爬虫采集结果，不含识别 / AI 字段）
  // ════════════════════════════════════════════════════════════════

  @Get('export/fields')
  getExportFields(@Query('taskIds') taskIdsStr: string) {
    const taskIds = taskIdsStr ? taskIdsStr.split(',').filter(Boolean) : []
    const dbFields = [
      { key: 'id', label: 'ID' },
      { key: 'task_id', label: '所属任务ID' },
      { key: 'source_url', label: '来源URL' },
      { key: 'detail_url', label: '详情URL' },
      { key: 'title', label: '标题' },
      { key: 'media_url', label: '媒体URL' },
      { key: 'media_source', label: '来源平台' },
      { key: 'status', label: '采集状态' },
      { key: 'created_at', label: '采集时间' },
      { key: 'updated_at', label: '更新时间' },
    ]
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
    return { dbFields, extraFields }
  }

  @Post('export')
  async exportData(
    @Body() body: {
      taskIds: string[]
      format: 'json' | 'yaml' | 'csv' | 'excel'
      fields: { key: string; alias: string }[]
      multiFile?: boolean
    },
    @Res() res: Response,
  ) {
    const { taskIds, format, fields, multiFile } = body
    if (!taskIds?.length) return res.status(400).json({ error: 'taskIds is required' })
    if (!fields?.length) return res.status(400).json({ error: 'fields is required' })

    const timestamp = formatTimestamp()
    const isMulti = multiFile && taskIds.length > 1
    const sql = `SELECT * FROM crawl_items WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY created_at DESC`

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
        const rows = this.db.db.prepare(sql).all(tid) as any[]
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
    const allRows = this.db.db.prepare(sql).all(...taskIds) as any[]
    const allData = transformRows(allRows)

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook()
      if (taskIds.length > 1) {
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
      return res.download(filePath, (err) => {
        if (err) console.warn('[export] download failed:', err.message)
        fs.unlink(filePath, () => {})
      })
    }

    if (format === 'csv' && taskIds.length > 1) {
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
    },
    @Res() res: Response,
  ) {
    const { itemIds, format, fields } = body
    if (!itemIds?.length) return res.status(400).json({ error: 'itemIds is required' })
    if (!fields?.length) return res.status(400).json({ error: 'fields is required' })

    const timestamp = formatTimestamp()
    const placeholders = itemIds.map(() => '?').join(',')
    const sql = `SELECT * FROM crawl_items WHERE id IN (${placeholders}) ORDER BY created_at DESC`
    const rows = this.db.db.prepare(sql).all(...itemIds) as any[]

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
          return null
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
      return res.download(filePath, (err) => {
        if (err) console.warn('[export] download failed:', err.message)
        fs.unlink(filePath, () => {})
      })
    }

    const content = generateContent()!
    res.setHeader('Content-Type', content.type)
    res.setHeader('Content-Disposition', `attachment; filename="export_${timestamp}.${content.ext}"`)
    return res.send(content.body)
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

    const timeoutMs = this.resolveFetchTimeout(payload)

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
          html = await this.fetchWithRetry(currentUrl, errorMode === 'standard' ? 2 : 0, timeoutMs)
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

        if (urlPattern && isUnlimited && items.length === 0) {
          console.log(`[crawler] Page ${pageIndex} returned 0 items, stopping`)
          break
        }

        // Detail page extraction
        const hasDetail = (detailRules && detailRules.length > 0) && (detailLinkField?.fields?.length)

        for (let i = 0; i < items.length; i++) {
          let detailUrl = ''
          if (hasDetail) {
            if (detailLinkField?.fields?.length) {
              const raw = this.crawler.pickFirst(items[i], detailLinkField.fields)
              if (raw) {
                detailUrl = raw.startsWith('http') ? raw : new URL(raw, currentUrl).href
              }
            }

            if (detailUrl) {
              try {
                const detailHtml = await this.fetchWithRetry(detailUrl, errorMode === 'strict' ? 0 : 1, timeoutMs)
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
          INSERT OR REPLACE INTO crawl_items (id, task_id, source_url, detail_url, title, media_url, media_type, media_source, status, extra_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'crawled', ?)
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
              for (const fieldName of mediaUrlField.fields) {
                const val = item[fieldName]
                if (val === null || val === undefined || val === '') continue
                const valStr = String(val)
                const transform = urlTransforms.find(t => t.fieldName === fieldName)

                let effectiveUrl: string
                let method: string

                if (isUrl(valStr)) {
                  effectiveUrl = normalizeUrl(valStr, normalizeSource)
                  method = 'file'
                } else if (transform) {
                  effectiveUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, item)
                  method = 'file'
                } else {
                  continue
                }

                allUrlEntries.push({ url: effectiveUrl, fieldName, method })
              }
              mediaUrl = allUrlEntries[0]?.url || ''
              item._media_urls = allUrlEntries.map(e => e.url)
              item._media_url_fields = allUrlEntries.map(e => e.fieldName)
              item._media_methods = allUrlEntries.map(e => e.method)
            } else {
              let found = false
              for (const fieldName of mediaUrlField.fields) {
                const val = item[fieldName]
                if (val === null || val === undefined || val === '') continue
                const valStr = String(val)
                const transform = urlTransforms.find(t => t.fieldName === fieldName)

                if (isUrl(valStr)) {
                  mediaUrl = normalizeUrl(valStr, normalizeSource)
                  const method = 'file'
                  item._media_urls = [mediaUrl]
                  item._media_url_fields = [fieldName]
                  item._media_methods = [method]
                  found = true
                  break
                } else if (transform) {
                  mediaUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, item)
                  const method = 'file'
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
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // URL 转换 & 来源聚合
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
    if (extraData._media_urls && Array.isArray(extraData._media_urls)) {
      const fields = extraData._media_url_fields || []
      for (let i = 0; i < extraData._media_urls.length; i++) {
        const rawUrl = extraData._media_urls[i]
        if (typeof rawUrl !== 'string' || !rawUrl) continue
        const fieldName = fields[i] || ''
        const finalUrl = fieldName
          ? this.applyUrlTransform(rawUrl, fieldName, urlTransforms, extraData)
          : rawUrl
        const { source } = this.crawler.detectMediaType(finalUrl)
        if (source) sources.add(source)
      }
    }
    if (primaryMediaUrl) {
      const { source } = this.crawler.detectMediaType(primaryMediaUrl)
      if (source) sources.add(source)
    }
    if (sources.size === 0 || (sources.size === 1 && sources.has('direct'))) {
      if (sourceUrl) {
        const { source } = this.crawler.detectMediaType(sourceUrl)
        if (source && source !== 'direct' && source !== '') {
          sources.add(source)
          sources.delete('direct')
        }
      }
    }
    return [...sources].join(',')
  }

  /** 如果该字段配置了 URL 转换规则，则用模板拼接；否则返回原 URL */
  private applyUrlTransform(originalUrl: string, fieldName: string, transforms: UrlTransform[], extraData?: Record<string, any>): string {
    const rule = transforms.find(t => t.fieldName === fieldName)
    if (!rule) return originalUrl
    if (!rule.urlTemplate) return originalUrl
    return rule.urlTemplate.replace(/\{(\w+)\}/g, (_, key) => {
      if (extraData && extraData[key] != null && extraData[key] !== '') {
        return String(extraData[key])
      }
      if (key === fieldName) return originalUrl
      return `{${key}}`
    })
  }


  // ════════════════════════════════════════════════════════════════
  // 工具方法
  // ════════════════════════════════════════════════════════════════


  /** 归一化 fetch 超时：省略→15000；0→不限制；>0 整数→原值；非法(负数/小数/非数字)→回退默认 15000 */
  private resolveFetchTimeout(payload: CrawlPayload): number {
    const v = (payload as any).fetchTimeoutMs
    if (v === undefined || v === null) return 15000
    if (v === 0) return 0
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v
    console.warn(`[crawler] fetchTimeoutMs 非法(${v})，回退默认 15000ms`)
    return 15000
  }

  private async fetchWithRetry(url: string, maxRetries: number, timeoutMs = 15000): Promise<string> {
    let lastErr: any
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.crawler.fetchHtml(url, timeoutMs)
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
    const timeoutMs = this.resolveFetchTimeout(payload)

    try {
      let data: Record<string, any> | null = null

      if (item.detail_url) {
        let detailHtml: string
        try {
          detailHtml = await this.crawler.fetchHtml(item.detail_url, timeoutMs)
        } catch (err: any) {
          this.db.db.prepare(`UPDATE crawl_items SET status = 'error' WHERE id = ?`).run(itemId)
          return { error: `详情页不可访问，该项可能已下架: ${err.message}` }
        }
        const detailResults = this.crawler.parseHtml(detailHtml, payload.detailRules || payload.rules, undefined, item.detail_url)
        if (detailResults.length > 0) {
          data = detailResults[0]
          if (item.source_url && item.source_url !== item.detail_url) {
            try {
              const listHtml = await this.crawler.fetchHtml(item.source_url, timeoutMs)
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
          listHtml = await this.crawler.fetchHtml(item.source_url, timeoutMs)
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

      const normalizeSource = item.detail_url || item.source_url
      const urlTransforms = payload.urlTransforms || []

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
              method = 'file'
            } else if (transform) {
              effectiveUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, data)
              method = 'file'
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
              ;(data as any)._media_methods = ['file']
              found = true
              break
            } else if (transform) {
              mediaUrl = this.applyUrlTransform(valStr, fieldName, urlTransforms, data)
              ;(data as any)._media_urls = [mediaUrl]
              ;(data as any)._media_url_fields = [fieldName]
              ;(data as any)._media_methods = ['file']
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

      const aggregatedSource = this.aggregateMediaSources(data, mediaUrl, urlTransforms, item.source_url)
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

    const origLink = origExtra?.link || origExtra?.url || originalItem.media_url
    if (origLink) {
      for (const r of listResults) {
        if (r.link === origLink || r.url === origLink) return r
      }
    }

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
