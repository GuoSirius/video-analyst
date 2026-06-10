import { Controller, Get, Post, Delete, Param, Body, Query, UploadedFiles, UseInterceptors } from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import * as path from 'path'
import * as fs from 'fs'
import { v4 as uuid } from 'uuid'
import { DownloadService } from './download.service'
import { DatabaseService } from '../common/database/database.service'
import { QueueService } from '../common/queue/queue.service'
import { TranscoderService } from '../transcoder/transcoder.service'

const projectRoot = path.resolve(process.cwd(), '..')
const mediaDir = path.resolve(projectRoot, 'data', 'media')

/** 修复 multer 上传中文文件名的编码问题 */
function fixUploadFilename(name: string): string {
  try {
    return decodeURIComponent(escape(name))
  } catch {
    return name
  }
}

/** 将绝对路径转为相对于项目根的路径（用于持久化存储） */
function toRelative(absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, '/')
}

/** 解析存储的路径：兼容旧绝对路径 + 新相对路径 */
function resolvePath(stored: string): string {
  if (!stored) return stored
  if (path.isAbsolute(stored)) return stored  // 旧格式（绝对路径）
  return path.resolve(projectRoot, stored)     // 新格式（相对路径）
}

@Controller('api/download')
export class DownloadController {
  constructor(
    private readonly download: DownloadService,
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
    private readonly transcoder: TranscoderService,
  ) {}

  @Get('queue')
  getQueue(@Query() query: {
    status?: string
    file_type?: string
    field_name?: string
    item_id?: string
    keyword?: string
    page?: string
    pageSize?: string
  }) {
    const { status, file_type, field_name, item_id, keyword, page, pageSize } = query
    const pageNum = page ? parseInt(page, 10) : 1
    const size = pageSize ? parseInt(pageSize, 10) : 20
    const offset = (pageNum - 1) * size

    let whereClause = ''
    const params: any[] = []

    if (status && status !== 'all') {
      whereClause += 'WHERE status = ?'
      params.push(status)
    }

    if (file_type && file_type !== 'all') {
      whereClause += whereClause ? ' AND file_type = ?' : 'WHERE file_type = ?'
      params.push(file_type)
    }

    if (field_name && field_name !== 'all') {
      whereClause += whereClause ? ' AND field_name = ?' : 'WHERE field_name = ?'
      params.push(field_name)
    }

    if (item_id && item_id !== 'all') {
      whereClause += whereClause ? ' AND item_id = ?' : 'WHERE item_id = ?'
      params.push(item_id)
    }

    if (keyword) {
      whereClause += whereClause ? ' AND (filename LIKE ? OR url LIKE ? OR error LIKE ?)' : 'WHERE (filename LIKE ? OR url LIKE ? OR error LIKE ?)'
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }

    // Get total count
    const countRow = this.db.db.prepare(`SELECT COUNT(*) as count FROM download_queue ${whereClause}`).get(...params) as any
    const total = countRow?.count || 0

    // Get paginated data
    const rows = this.db.db.prepare(`
      SELECT * FROM download_queue ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, size, offset) as any[]

    // Get stats (always from full dataset, not filtered)
    const statsRow = this.db.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'downloading' THEN 1 ELSE 0 END) as downloading,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM download_queue
    `).get() as any

    return {
      data: rows,
      total,
      page: pageNum,
      pageSize: size,
      stats: {
        total: statsRow?.total || 0,
        completed: statsRow?.completed || 0,
        downloading: statsRow?.downloading || 0,
        pending: statsRow?.pending || 0,
        paused: statsRow?.paused || 0,
        failed: statsRow?.failed || 0,
      }
    }
  }

  @Get('files')
  getUploadedFiles() {
    const files = this.db.db.prepare(
      "SELECT * FROM download_queue WHERE status = 'completed' AND file_path IS NOT NULL ORDER BY created_at DESC"
    ).all() as any[]
    return files
  }

  @Get('stats')
  getStats() {
    return this.download.getStats()
  }

  @Get('max-concurrent')
  getMaxConcurrent() {
    return { value: this.download.getMaxConcurrent() }
  }

  @Post('max-concurrent')
  setMaxConcurrent(@Body() body: { value: number }) {
    if (!body.value || body.value < 1) return { error: '并发数必须 >= 1' }
    this.download.setMaxConcurrent(body.value)
    return { ok: true, value: this.download.getMaxConcurrent() }
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 50, {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })
        cb(null, mediaDir)
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname)
        cb(null, `${uuid()}${ext}`)
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB
  }))
  async uploadFiles(@UploadedFiles() files: Express.Multer.File[]) {
    const results: Array<{ filename: string; ok: boolean; taskId?: string; error?: string }> = []

    for (const file of files) {
      try {
        const decodedName = fixUploadFilename(file.originalname)
        const fileType = this.getFileType(decodedName)
        const taskId = uuid()
        this.db.db.prepare(`
          INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, file_path)
          VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
        `).run(taskId, null, `upload://${decodedName}`, decodedName, fileType, 'upload', toRelative(file.path))
        results.push({ filename: decodedName, ok: true, taskId })
      } catch (err: any) {
        results.push({ filename: fixUploadFilename(file.originalname), ok: false, error: err.message })
      }
    }

    const okCount = results.filter(r => r.ok).length
    const failCount = results.filter(r => !r.ok).length

    return {
      ok: failCount === 0,
      count: okCount,
      failCount,
      results,
      message: failCount > 0
        ? `${okCount} 个文件上传成功，${failCount} 个失败`
        : `${okCount} 个文件上传成功`,
    }
  }

  private getFileType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']
    const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4v', 'ts', 'm3u8']
    const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma', 'opus']
    const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'yaml', 'yml', 'txt', 'md']
    if (imageExts.includes(ext)) return 'image'
    if (videoExts.includes(ext)) return 'video'
    if (audioExts.includes(ext)) return 'audio'
    if (docExts.includes(ext)) return 'document'
    return 'unknown'
  }

  // ════════════════════════════════════════════════════════════════
  // 单个任务操作
  // ════════════════════════════════════════════════════════════════

  /** 获取等效命令行（与后台实际执行 100% 一致） */
  @Get('queue/:id/command')
  getEquivalentCommand(@Param('id') id: string) {
    const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as any
    if (!task) return { error: '任务不存在' }
    const command = this.download.buildEquivalentCommand(task)
    return { command }
  }

  @Post('queue/:id/start')
  async startDownload(@Param('id') id: string) {
    const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as any
    if (!task) return { error: '任务不存在' }
    if (task.status !== 'pending' && task.status !== 'paused') return { error: '只能启动等待中或暂停的任务' }
    // Change paused → pending and trigger processing
    if (task.status === 'paused') {
      this.db.db.prepare(`UPDATE download_queue SET status = 'pending', error = NULL, progress = 0 WHERE id = ?`).run(id)
    }
    setImmediate(() => this.download.processDownloads())
    return { ok: true }
  }

  @Post('queue/:id/stop')
  async stopDownload(@Param('id') id: string) {
    return this.download.stopDownload(id)
  }

  /** Process all pending/paused tasks */
  @Post('queue/process')
  async processAll() {
    // Count pending/paused tasks before processing
    const countRow = this.db.db.prepare(
      "SELECT COUNT(*) as count FROM download_queue WHERE status IN ('pending', 'paused')"
    ).get() as any
    const count = countRow?.count || 0
    // Change all paused tasks to pending first
    this.db.db.prepare(`UPDATE download_queue SET status = 'pending' WHERE status = 'paused'`).run()
    if (count > 0) {
      setImmediate(() => this.download.processDownloads())
    }
    return { ok: true, count }
  }

  @Delete('queue/:id')
  deleteTask(@Param('id') id: string) {
    return this.download.deleteTask(id)
  }

  @Post('queue/:id/transcode')
  async startTranscode(@Param('id') id: string) {
    const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as any
    if (!task) return { error: 'Task not found' }
    const filePath = resolvePath(task.file_path)
    if (!filePath || !fs.existsSync(filePath)) return { error: '文件不存在' }

    const outputDir = path.resolve(projectRoot, 'data', 'transcoded')
    const fileName = task.filename || path.basename(filePath)
    const basename = path.basename(fileName, path.extname(fileName))
    const expectedOutput = path.join(outputDir, `${basename}.wav`)

    // 如果转码结果文件已存在，检查是否有对应的完成转码任务 → 去重
    if (fs.existsSync(expectedOutput)) {
      const existing = this.db.db.prepare(
        "SELECT * FROM tasks WHERE type = 'transcode' AND json_extract(payload, '$.file') = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1"
      ).get(toRelative(filePath)) as any
      if (existing) {
        return { ok: true, taskId: existing.id, alreadyTranscoded: true, outputPath: toRelative(expectedOutput) }
      }
    }

    // 检查是否有运行中/等待中的转码任务 → 去重
    const runningTask = this.db.db.prepare(
      "SELECT * FROM tasks WHERE type = 'transcode' AND json_extract(payload, '$.file') = ? AND status IN ('pending', 'running') ORDER BY created_at DESC LIMIT 1"
    ).get(toRelative(filePath)) as any
    if (runningTask) {
      return { error: `该文件已有转码任务正在执行或等待中（任务ID: ${runningTask.id.slice(0, 8)}...）`, taskId: runningTask.id }
    }

    // 追溯到爬虫任务 ID，用于流水线自动触发判断
    let crawlerTaskId: string | undefined
    if (task.item_id) {
      const item = this.db.db.prepare('SELECT task_id FROM crawl_items WHERE id = ?').get(task.item_id) as any
      crawlerTaskId = item?.task_id || undefined
    }

    const queueTask = this.queue.createTask('transcode', {
      file: toRelative(filePath),
      outputDir: toRelative(outputDir),
      source: 'download',
      fileName,
      crawlerTaskId,
    })

    // Process the transcode task
    this.processTranscodeTask(queueTask.id, filePath, outputDir, crawlerTaskId)

    return { ok: true, taskId: queueTask.id }
  }

  private async processTranscodeTask(taskId: string, inputPath: string, outputDir: string, _crawlerTaskId?: string) {
    try {
      const resolvedInput = resolvePath(inputPath)
      const resolvedOutput = resolvePath(outputDir)
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 0)
      const outputPath = await this.transcoder.transcode(resolvedInput, resolvedOutput, (pct) => {
        this.queue.updateTaskProgress(taskId, pct)
      })
      this.queue.updateTaskResult(taskId, { outputPath: toRelative(outputPath) })
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }

  @Post('queue/:id/retry')
  async retryDownload(@Param('id') id: string) {
    return this.download.retryDownload(id)
  }

  // ════════════════════════════════════════════════════════════════
  // 批量操作
  // ════════════════════════════════════════════════════════════════

  @Post('queue/batch-delete')
  batchDelete(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    return this.download.batchDelete(body.ids)
  }

  @Post('queue/batch-start')
  batchStart(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    return this.download.batchStart(body.ids)
  }

  @Post('queue/batch-stop')
  batchStop(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    return this.download.batchStop(body.ids)
  }

  @Post('queue/batch-retry')
  batchRetry(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    return this.download.batchRetry(body.ids)
  }

  @Post('queue/batch-auto-pipeline')
  async batchAutoPipeline(@Body() body: { ids: string[]; steps?: { start_download?: boolean; transcode?: boolean; whisper?: boolean; ai?: boolean } }) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return { error: 'ids array is required' }
    }
    const results = await this.download.batchAutoPipeline(body.ids, body.steps)
    return { ok: true, results }
  }

  // ════════════════════════════════════════════════════════════════
  // Filters
  // ════════════════════════════════════════════════════════════════

  @Get('filters')
  getFilters() {
    const types = this.db.db.prepare(
      "SELECT DISTINCT file_type FROM download_queue WHERE file_type IS NOT NULL ORDER BY file_type"
    ).all() as { file_type: string }[]

    const sources = this.db.db.prepare(
      "SELECT DISTINCT field_name FROM download_queue WHERE field_name IS NOT NULL ORDER BY field_name"
    ).all() as { field_name: string }[]

    const tasks = this.db.db.prepare(
      `SELECT DISTINCT dq.item_id, ci.title
       FROM download_queue dq
       LEFT JOIN crawl_items ci ON dq.item_id = ci.id
       WHERE dq.item_id IS NOT NULL
       ORDER BY dq.item_id`
    ).all() as { item_id: string; title: string }[]

    return {
      types: types.map(t => t.file_type),
      sources: sources.map(s => s.field_name),
      tasks: tasks.map(t => ({
        item_id: t.item_id,
        label: t.title || t.item_id.slice(0, 8),
      })),
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 创建下载任务、测试链接
  // ════════════════════════════════════════════════════════════════

  /**
   * 测试视频链接能否获取信息
   * POST /api/download/test
   * body: { url: string, downloadMethod?: string }
   */
  @Post('test')
  async testLink(@Body() body: { url: string; downloadMethod?: string }) {
    if (!body.url) {
      return { error: 'URL 不能为空' }
    }

    const urlToTest = body.downloadMethod === 'file' ? body.url : body.url
    const info = await this.download.getVideoInfo(urlToTest)
    return {
      ok: true,
      info: {
        title: info.title,
        ext: info.ext,
        filesize: info.filesize,
        filesizeHuman: info.filesize ? this.formatFileSize(info.filesize) : undefined,
        width: info.width,
        height: info.height,
        duration: info.duration,
        durationHuman: info.duration ? this.formatDuration(info.duration) : undefined,
        site: this.download.detectSite(body.url),
      },
    }
  }

  /**
   * 从 URL 创建下载任务
   * POST /api/download/create
   * body: { urls: [{url, fieldName?, downloadMethod?}], item_id?: string, filenamePrefix?: string }
   */
  @Post('create')
  async createDownload(
    @Body() body: {
      urls: Array<{ url: string; fieldName?: string; downloadMethod?: string; ytDlpOptions?: any }>
      item_id?: string; filenamePrefix?: string
    },
  ) {
    if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
      return { error: 'urls 数组不能为空' }
    }

    for (const item of body.urls) {
      if (!item.url) {
        return { error: 'URL 不能为空' }
      }
    }

    const taskIds = await this.download.createDownloadTask(body.urls, {
      item_id: body.item_id,
      filenamePrefix: body.filenamePrefix,
    })

    return { ok: true, taskIds }
  }

  // ════════════════════════════════════════════════════════════════
  // 工具方法
  // ════════════════════════════════════════════════════════════════

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  }

  private formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }
}
