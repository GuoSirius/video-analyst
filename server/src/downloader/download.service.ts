import { Injectable } from '@nestjs/common'
import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { YtDlp } from 'ytdlp-nodejs'
import { DatabaseService } from '../common/database/database.service'
import { SseService } from '../common/sse/sse.service'
import { QueueService } from '../common/queue/queue.service'
import { PipelineService } from '../common/pipeline/pipeline.service'
import { v4 as uuid } from 'uuid'
import { formatDate } from '../common/utils/date.util'
import { isVideoPlatform, classifyExt, extractExtFromUrl, extractVideoId, PSEUDO_STATIC_EXTS } from '../common/utils/url.util'
import { cookiesTextToFilePath, writeCookiesTextToFile } from '../common/utils/cookies.util'
import type { YtDlpOptions } from '../crawler/crawler.service'
import { QUALITY_PRESET_FORMATS } from '../crawler/crawler.service'

const projectRoot = path.resolve(process.cwd(), '..')

/** 将绝对路径转为相对于项目根的路径（用于持久化存储） */
function toRelative(absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, '/')
}

/** 解析存储的路径：兼容旧绝对路径 + 新相对路径 */
export function resolvePath(stored: string): string {
  if (!stored) return stored
  if (path.isAbsolute(stored)) return stored  // 旧格式（绝对路径）
  return path.resolve(projectRoot, stored)     // 新格式（相对路径）
}

/** 内部使用的视频信息结构 */
export interface VideoInfo {
  title: string
  url: string
  ext: string
  format?: string
  filesize?: number
  width?: number
  height?: number
  duration?: number
}

/** reimport_opts JSON 结构 */
export interface ReimportOpts {
  autoDownload: boolean
  itemId: string
  urls: Array<{
    url: string
    fieldName: string
    filename: string
    fileType: string
    downloadMethod: string | null
    ytDlpOptions: YtDlpOptions | null
  }>
}

@Injectable()
export class DownloadService {
  private downloadDir: string
  private dataDir: string
  private ytDlp: YtDlp
  /** 被终止的任务 ID 集合（yt-dlp 无法真正中断，完成后检查此集合忽略结果） */
  private cancelSet = new Set<string>()
  /** HTTP 下载的 AbortController 映射（支持真正中断 HTTP 直链下载） */
  private abortMap = new Map<string, AbortController>()

  constructor(
    private readonly db: DatabaseService,
    private readonly sse: SseService,
    private readonly queue: QueueService,
    private readonly pipeline: PipelineService,
  ) {
    this.dataDir = path.resolve(projectRoot, 'data')
    this.downloadDir = path.resolve(projectRoot, 'data', 'downloads')
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true })
    }
    this.ytDlp = new YtDlp()
  }

  getDownloadDir() {
    return this.downloadDir
  }

  /** 默认最大并发下载数 */
  private static readonly DEFAULT_MAX_CONCURRENT = 3

  /** Process pending download tasks — called by scheduler. Only picks up 'pending' status, not 'paused'. */
  async processDownloads() {
    // 查询当前正在下载的任务数，控制并发上限
    const downloadingRow = this.db.db.prepare(
      "SELECT COUNT(*) as count FROM download_queue WHERE status = 'downloading'"
    ).get() as any
    const downloadingCount = downloadingRow?.count || 0
    const maxConcurrent = this.getMaxConcurrent()
    const slots = Math.max(0, maxConcurrent - downloadingCount)

    if (slots <= 0) return

    const pendingTasks = this.db.db.prepare(
      "SELECT * FROM download_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?"
    ).all(slots) as any[]

    // 并发启动所有待处理任务（充分利用可用槽位）
    await Promise.allSettled(pendingTasks.map(async (task) => {
      if (this.cancelSet.has(task.id)) return
      try {
        await this.executeDownload(task)
      } catch (err: any) {
        console.error(`[DownloadScheduler] Task ${task.id} failed:`, err.message)
      }
    }))
  }

  /** 获取最大并发下载数 */
  getMaxConcurrent(): number {
    try {
      const row = this.db.db.prepare("SELECT value FROM settings WHERE key = 'download_max_concurrent'").get() as any
      if (row?.value) {
        const n = parseInt(row.value, 10)
        if (!isNaN(n) && n >= 1 && n <= 20) return n
      }
    } catch { /* ignore */ }
    return DownloadService.DEFAULT_MAX_CONCURRENT
  }

  /** 设置最大并发下载数 */
  setMaxConcurrent(n: number): void {
    const clamped = Math.max(1, Math.min(20, Math.round(n)))
    this.db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('download_max_concurrent', ?)").run(String(clamped))
  }

  /** Sanitize a string for use as a directory name */
  private sanitizeDirname(name: string): string {
    return name
      .replace(/[<>:"|?*\/\\]/g, '_')
      .replace(/[\x00-\x1f]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'unknown'
  }

  /** Resolve the download directory path for a task */
  private resolveDownloadPath(task: any): string {
    const itemId: string | null = task.item_id
    const fieldName: string = task.field_name || ''

    if (itemId) {
      // 采集带入：{taskName}_{taskId8}/{itemId8}/
      const item = this.db.db.prepare('SELECT task_id FROM crawl_items WHERE id = ?').get(itemId) as any
      if (item?.task_id) {
        const taskRow = this.db.db.prepare("SELECT payload FROM tasks WHERE id = ?").get(item.task_id) as any
        let taskName = ''
        try { taskName = JSON.parse(taskRow?.payload || '{}').name || '' } catch { /* ignore */ }
        const taskDir = this.sanitizeDirname(taskName ? `${taskName}_${item.task_id.slice(0, 8)}` : item.task_id.slice(0, 8))
        return path.join(this.downloadDir, taskDir, itemId.slice(0, 8))
      }
    }

    if (fieldName === 'upload') {
      // 本地上传：uploads/{YYYY-MM-DD}/
      const dateStr = formatDate()
      return path.join(this.downloadDir, 'uploads', dateStr)
    }

    // 手动添加链接 / 其他：manual/{taskId8}/（每个任务独立子目录，避免同名冲突）
    return path.join(this.downloadDir, 'manual', task.id.slice(0, 8))
  }

  /** Determine file type by download method first, then by URL/extension */
  private resolveFileType(task: any): string {
    const method = task.download_method  // NULL | 'yt-dlp' | 'file'
    const url = task.url || ''

    // yt-dlp / video platform → always video
    if (method === 'yt-dlp' || isVideoPlatform(url)) return 'video'

    // Extension from filename (using shared util that strips pseudo-static ext)
    const ext = extractExtFromUrl(task.filename || url)
    if (ext) {
      const ft = classifyExt(ext)
      if (ft !== 'unknown') return ft
    }

    // URL path last segment fallback
    const urlExt = extractExtFromUrl(url)
    if (urlExt) {
      return classifyExt(urlExt)
    }

    return 'unknown'
  }

  // (isVideoPlatform and classifyExt now imported from ../common/utils/url.util)

  /** Execute a single download task */
  private async executeDownload(task: any) {
    const taskId = task.id
    const url = task.url
    const itemId = task.item_id
    const method = task.download_method  // NULL | 'yt-dlp' | 'file'
    let filename = this.sanitizeFilename(task.filename || this.extractFilename(url, task.item_id))

    // 修正视频平台 URL 的伪静态扩展名（如 .html → .mp4），yt-dlp 输出始终为 mp4
    if (method !== 'file' && isVideoPlatform(url)) {
      const dotIdx = filename.lastIndexOf('.')
      if (dotIdx > 0) {
        const ext = filename.slice(dotIdx + 1).toLowerCase()
        if (PSEUDO_STATIC_EXTS.has(ext)) {
          filename = filename.slice(0, dotIdx) + '.mp4'
          this.db.db.prepare('UPDATE download_queue SET filename = ?, file_type = ? WHERE id = ?')
            .run(filename, 'video', taskId)
        }
      }
    }

    // 目录结构: {taskName}_{taskId8}/{itemId8}/ | uploads/{YYYY-MM}/ | manual/{taskId8}/
    const itemDir = this.resolveDownloadPath(task)
    const normalizedFilename = this.normalizeFilePath(filename)
    const dirPath = path.join(itemDir, path.dirname(normalizedFilename))
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    let filePath = path.join(itemDir, normalizedFilename)

    // 方案A：先下载到临时文件，成功后 rename 覆盖正式文件（避免失败时损坏旧文件）
    let tmpPath = filePath + '.tmp'

    // Check if cancelled before starting
    if (this.cancelSet.has(taskId)) {
      this.handleCancelled(taskId, filePath)
      return
    }

    try {
      this.db.db.prepare(`UPDATE download_queue SET status = 'downloading', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(taskId)
      this.sse.emitEvent('download', { taskId, itemId, status: 'downloading', progress: 0 })

      // 根据 download_method 字段选择下载方式，yt-dlp 返回实际输出路径
      let actualOutputPath = tmpPath

      if (method === 'file') {
        await this.downloadFile(url, tmpPath, taskId, (progress) => {
          if (this.cancelSet.has(taskId)) return
          this.db.db.prepare(`UPDATE download_queue SET progress = ? WHERE id = ?`).run(progress, taskId)
          this.sse.emitEvent('download', { taskId, itemId, status: 'downloading', progress })
        })
      } else if (method === 'yt-dlp') {
        actualOutputPath = await this.downloadWithYtDlpLib(url, tmpPath, taskId, itemId)
      } else {
        // NULL：自动检测（兼容旧数据 + 手动添加的链接）
        const site = this.detectSite(url)
        if (site === 'direct') {
          await this.downloadFile(url, tmpPath, taskId, (progress) => {
            if (this.cancelSet.has(taskId)) return
            this.db.db.prepare(`UPDATE download_queue SET progress = ? WHERE id = ?`).run(progress, taskId)
            this.sse.emitEvent('download', { taskId, itemId, status: 'downloading', progress })
          })
        } else {
          actualOutputPath = await this.downloadWithYtDlpLib(url, tmpPath, taskId, itemId)
        }
      }

      // Check if cancelled after download completed
      const cancelCheckPath = actualOutputPath || tmpPath
      if (this.cancelSet.has(taskId)) {
        this.handleCancelled(taskId, cancelCheckPath)
        return
      }

      // 重新读取 filename（downloadWithYtDlpLib 可能已同步扩展名）
      const updatedRow = this.db.db.prepare('SELECT filename FROM download_queue WHERE id = ?').get(taskId) as any
      if (updatedRow?.filename) {
        filename = updatedRow.filename
        const newItemDir = this.resolveDownloadPath(task)
        const newNorm = this.normalizeFilePath(filename)
        filePath = path.join(newItemDir, newNorm)
      }

      // 下载成功：实际输出文件 → 正式文件
      if (actualOutputPath && fs.existsSync(actualOutputPath)) {
        if (actualOutputPath !== filePath) {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
          fs.renameSync(actualOutputPath, filePath)
        }
      } else if (fs.existsSync(tmpPath)) {
        // 兜底：如果 actualOutputPath 不存在但 tmpPath 存在（HTTP 直链下载场景）
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        fs.renameSync(tmpPath, filePath)
      }

      // Download succeeded — handle reimport_pending first
      const didReimport = await this.handleReimportIfPending(taskId)
      if (!didReimport) {
        this.db.db.prepare(`UPDATE download_queue SET status = 'completed', file_path = ?, progress = 100, updated_at = datetime('now') WHERE id = ?`).run(toRelative(filePath), taskId)
        this.sse.emitEvent('download', { taskId, itemId, status: 'completed', filePath, progress: 100 })

        // 自动流水线：检查是否需要自动进入转码→识别→AI
        await this.autoContinuePipeline(taskId, itemId, filePath)
      }
      return

    } catch (err: any) {
      // Clean up temp file on failure
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
      }
      // If cancelled, don't treat as failure
      if (this.cancelSet.has(taskId)) {
        this.handleCancelled(taskId, filePath)
        return
      }

      // Download failed — still handle reimport_pending
      this.db.db.prepare(`UPDATE download_queue SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`).run(err.message, taskId)
      this.sse.emitEvent('download', { taskId, itemId, status: 'failed', error: err.message })

      await this.handleReimportIfPending(taskId)
    }
  }

  /** Handle cancelled task: cleanup + reset to pending */
  private handleCancelled(taskId: string, filePath: string) {
    this.cancelSet.delete(taskId)
    this.abortMap.delete(taskId)
    // Clean up partial file
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }
    // Reset to pending
    this.db.db.prepare(`UPDATE download_queue SET status = 'pending', error = NULL, progress = 0, file_path = NULL, updated_at = datetime('now') WHERE id = ?`).run(taskId)
    this.sse.emitEvent('download', { taskId, status: 'pending' })
  }

  /** Handle reimport_pending flag after download completes/fails. Returns true if reimport was performed. */
  private async handleReimportIfPending(taskId: string): Promise<boolean> {
    const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(taskId) as any
    if (!task || !task.reimport_pending) return false

    // Parse reimport opts
    let opts: ReimportOpts
    try {
      opts = JSON.parse(task.reimport_opts || '{}')
    } catch {
      // Invalid opts, just clear flag
      this.db.db.prepare(`UPDATE download_queue SET reimport_pending = 0, reimport_opts = NULL WHERE id = ?`).run(taskId)
      return false
    }

    if (!opts.urls || !opts.urls.length) {
      this.db.db.prepare(`UPDATE download_queue SET reimport_pending = 0, reimport_opts = NULL WHERE id = ?`).run(taskId)
      return false
    }

    // Delete the current task
    this.db.db.prepare('DELETE FROM download_queue WHERE id = ?').run(taskId)

    // Respect autoDownload flag: paused if false, pending if true
    const newStatus = opts.autoDownload ? 'pending' : 'paused'

    // Create new download tasks
    const insertStmt = this.db.db.prepare(`
      INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, download_method, yt_dlp_options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const u of opts.urls) {
      const newId = uuid()
      const ytOptsJson = u.ytDlpOptions ? JSON.stringify(u.ytDlpOptions) : null
      insertStmt.run(newId, opts.itemId, u.url, u.filename, u.fileType, u.fieldName, newStatus, u.downloadMethod, ytOptsJson)
    }

    // Update crawl_items download_status
    this.db.db.prepare(`UPDATE crawl_items SET download_status = 'imported' WHERE id = ?`).run(opts.itemId)

    this.sse.emitEvent('download', { taskId, itemId: opts.itemId, status: 'reimported', message: '下载任务已重新创建' })

    // If autoDownload, trigger processing
    if (opts.autoDownload) {
      setImmediate(() => this.processDownloads())
    }
    return true
  }

  /** 下载完成后检查是否需要自动进入转码→识别→AI 流水线 */
  private async autoContinuePipeline(taskId: string, itemId: string, filePath: string) {
    try {
      if (!itemId || !filePath || !fs.existsSync(filePath)) return

      // 追溯到爬虫任务
      const item = this.db.db.prepare('SELECT task_id FROM crawl_items WHERE id = ?').get(itemId) as any
      if (!item?.task_id) return

      const crawlerTaskId = item.task_id
      if (!this.pipeline.shouldAutoTranscode(crawlerTaskId)) return

      const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(taskId) as any
      const outputDir = path.resolve(projectRoot, 'data', 'transcoded')
      const fileName = task?.filename || path.basename(filePath)

      this.queue.createTask('transcode', {
        file: toRelative(filePath),
        outputDir: toRelative(outputDir),
        source: 'download',
        fileName,
        crawlerTaskId,
      })
    } catch (err: any) {
      console.error(`[autoContinuePipeline] Failed for download ${taskId}:`, err.message)
    }
  }

  /** Stop (terminate) a download task — reset to pending */
  stopDownload(taskId: string): { ok?: boolean; error?: string } {
    const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(taskId) as any
    if (!task) return { error: '任务不存在' }
    if (task.status !== 'downloading') return { error: '只能终止下载中的任务' }

    // Mark as cancelled
    this.cancelSet.add(taskId)

    // Abort HTTP download if in progress
    const controller = this.abortMap.get(taskId)
    if (controller) {
      controller.abort()
      this.abortMap.delete(taskId)
    }

    // Note: for yt-dlp, we can't truly abort it. The cancel flag in cancelSet
    // will cause the completion handler to ignore the result and reset to pending.

    return { ok: true }
  }

  /** Retry a failed or completed download task */
  async retryDownload(taskId: string) {
    const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(taskId) as any
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'failed' && task.status !== 'completed') {
      return { error: '只有失败或已完成的任务可以重试' }
    }
    // Clean up old file if exists
    const oldPath = task.file_path ? resolvePath(task.file_path) : null
    if (oldPath && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath) } catch { /* ignore */ }
    }
    this.db.db.prepare(`UPDATE download_queue SET status = 'pending', error = NULL, progress = 0, file_path = NULL, updated_at = datetime('now') WHERE id = ?`).run(taskId)
    // Trigger processing immediately
    setImmediate(() => this.processDownloads())
    return { ok: true }
  }

  /** Delete a download task */
  deleteTask(taskId: string) {
    const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(taskId) as any
    if (!task) return { error: 'Task not found' }
    // If downloading, stop first
    this.cancelSet.delete(taskId)
    this.abortMap.delete(taskId)
    const delPath = task.file_path ? resolvePath(task.file_path) : null
    if (delPath && fs.existsSync(delPath)) {
      try { fs.unlinkSync(delPath) } catch { /* ignore */ }
    }
    this.db.db.prepare('DELETE FROM download_queue WHERE id = ?').run(taskId)
    return { ok: true }
  }

  /** Batch delete */
  batchDelete(ids: string[]) {
    for (const id of ids) {
      this.cancelSet.delete(id)
      this.abortMap.delete(id)
      const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as any
      const batchPath = task?.file_path ? resolvePath(task.file_path) : null
      if (batchPath && fs.existsSync(batchPath)) {
        try { fs.unlinkSync(batchPath) } catch { /* ignore */ }
      }
    }
    const stmt = this.db.db.prepare('DELETE FROM download_queue WHERE id = ?')
    for (const id of ids) {
      stmt.run(id)
    }
    return { ok: true, count: ids.length }
  }

  /** Batch start pending/paused tasks */
  batchStart(ids: string[]) {
    const stmt = this.db.db.prepare(`UPDATE download_queue SET status = 'pending', error = NULL, progress = 0 WHERE id = ?`)
    let count = 0
    for (const id of ids) {
      const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as any
      if (task && (task.status === 'pending' || task.status === 'paused')) {
        // Reset to pending — will be picked up by scheduler; just ensure it's clean
        stmt.run(id)
        count++
      }
    }
    setImmediate(() => this.processDownloads())
    return { ok: true, count }
  }

  /** Batch retry */
  batchRetry(ids: string[]) {
    let count = 0
    for (const id of ids) {
      const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as any
      if (!task) continue
      if (task.status !== 'failed' && task.status !== 'completed') continue
      const retryPath = task.file_path ? resolvePath(task.file_path) : null
      if (retryPath && fs.existsSync(retryPath)) {
        try { fs.unlinkSync(retryPath) } catch { /* ignore */ }
      }
      this.db.db.prepare(`UPDATE download_queue SET status = 'pending', error = NULL, progress = 0, file_path = NULL, updated_at = datetime('now') WHERE id = ?`).run(id)
      count++
    }
    setImmediate(() => this.processDownloads())
    return { ok: true, count }
  }

  /** Batch stop */
  batchStop(ids: string[]) {
    let count = 0
    for (const id of ids) {
      const result = this.stopDownload(id)
      if (result.ok) count++
    }
    return { ok: true, count }
  }

  /** Batch auto pipeline: smart handling for all download statuses */
  async batchAutoPipeline(ids: string[], steps?: { start_download?: boolean; transcode?: boolean; whisper?: boolean; ai?: boolean }) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = []
    // Default: all steps enabled (backward compatible)
    const s = { start_download: true, transcode: true, whisper: true, ai: true, ...steps }
    const allOn = s.start_download && s.transcode && s.whisper && s.ai

    for (const id of ids) {
      try {
        const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as any
        if (!task) { results.push({ id, ok: false, error: '任务不存在' }); continue }

        // 追溯爬虫任务 ID 并根据勾选的步骤设置流水线标志
        let crawlerTaskId: string | undefined
        if (task.item_id) {
          const item = this.db.db.prepare('SELECT task_id FROM crawl_items WHERE id = ?').get(task.item_id) as any
          crawlerTaskId = item?.task_id || undefined
          if (crawlerTaskId) {
            const crawlerTask = this.queue.getTask(crawlerTaskId)
            if (crawlerTask) {
              const payload = {
                ...crawlerTask.payload,
                autoPipeline: allOn,
                autoStartDownload: s.start_download,
                autoTranscode: s.transcode,
                autoWhisper: s.whisper,
                autoAI: s.ai,
                autoDownload: s.start_download,
              }
              this.queue.updateTaskPayload(crawlerTaskId, payload)
            }
          }
        }

        if (task.status === 'completed') {
          if (s.transcode) {
            // 已完成 + 需要转码：直接创建转码任务进入后续流水线
            const filePath = resolvePath(task.file_path)
            if (!filePath || !fs.existsSync(filePath)) {
              results.push({ id, ok: false, error: '下载文件不存在' })
              continue
            }
            const outputDir = path.resolve(projectRoot, 'data', 'transcoded')
            const fileName = task.filename || path.basename(filePath)
            this.queue.createTask('transcode', {
              file: toRelative(filePath),
              outputDir: toRelative(outputDir),
              source: 'download',
              fileName,
              crawlerTaskId,
            })
            results.push({ id, ok: true })
          } else {
            // 已完成但不需要后续步骤
            results.push({ id, ok: true })
          }
        } else if (task.status === 'pending' || task.status === 'paused') {
          // 未开始/暂停：启动下载（如果 start_download 被选中）
          if (s.start_download) {
            this.db.db.prepare(`UPDATE download_queue SET status = 'pending', error = NULL, progress = 0 WHERE id = ?`).run(id)
          }
          results.push({ id, ok: true })
        } else if (task.status === 'failed') {
          // 失败：重试下载（如果 start_download 被选中）
          if (s.start_download) {
            const oldPath = task.file_path ? resolvePath(task.file_path) : null
            if (oldPath && fs.existsSync(oldPath)) {
              try { fs.unlinkSync(oldPath) } catch { /* ignore */ }
            }
            this.db.db.prepare(`UPDATE download_queue SET status = 'pending', error = NULL, progress = 0, file_path = NULL, updated_at = datetime('now') WHERE id = ?`).run(id)
          }
          results.push({ id, ok: true })
        } else if (task.status === 'downloading') {
          results.push({ id, ok: false, error: '下载中，请等待完成后再操作' })
        } else {
          results.push({ id, ok: false, error: `不支持 ${task.status} 状态的下载任务` })
        }
      } catch (err: any) {
        results.push({ id, ok: false, error: err.message })
      }
    }

    // 触发下载处理
    setImmediate(() => this.processDownloads())
    return results
  }

  /** Get downloaded files for an item */
  getDownloadedFiles(itemId: string) {
    return this.db.db.prepare(
      'SELECT * FROM download_queue WHERE item_id = ? AND status = ? ORDER BY created_at DESC'
    ).all(itemId, 'completed') as any[]
  }

  /** Get download statistics */
  getStats() {
    const total = this.db.db.prepare('SELECT COUNT(*) as count FROM download_queue').get() as any
    const pending = this.db.db.prepare("SELECT COUNT(*) as count FROM download_queue WHERE status = 'pending'").get() as any
    const downloading = this.db.db.prepare("SELECT COUNT(*) as count FROM download_queue WHERE status = 'downloading'").get() as any
    const completed = this.db.db.prepare("SELECT COUNT(*) as count FROM download_queue WHERE status = 'completed'").get() as any
    const failed = this.db.db.prepare("SELECT COUNT(*) as count FROM download_queue WHERE status = 'failed'").get() as any

    return {
      total: total.count,
      pending: pending.count,
      downloading: downloading.count,
      completed: completed.count,
      failed: failed.count,
    }
  }

  /** Check if an item has any downloading tasks */
  hasDownloadingTasks(itemId: string): boolean {
    const row = this.db.db.prepare(
      "SELECT COUNT(*) as count FROM download_queue WHERE item_id = ? AND status = 'downloading'"
    ).get(itemId) as any
    return row?.count > 0
  }

  /** Get downloading task IDs for an item */
  getDownloadingTaskIds(itemId: string): string[] {
    const rows = this.db.db.prepare(
      "SELECT id FROM download_queue WHERE item_id = ? AND status = 'downloading'"
    ).all(itemId) as any[]
    return rows.map((r: any) => r.id)
  }

  /** Set reimport_pending on downloading tasks (for scheme C) */
  setReimportPending(itemId: string, opts: ReimportOpts): number {
    const taskIds = this.getDownloadingTaskIds(itemId)
    if (taskIds.length === 0) return 0
    const optsJson = JSON.stringify(opts)
    const stmt = this.db.db.prepare(`UPDATE download_queue SET reimport_pending = 1, reimport_opts = ? WHERE id = ?`)
    for (const id of taskIds) {
      stmt.run(optsJson, id)
    }
    return taskIds.length
  }

  // ════════════════════════════════════════════════════════════════
  // 站点识别与分发
  // ════════════════════════════════════════════════════════════════

  /** 判断 URL 是否属于受支持的站点 */
  detectSite(url: string): 'bilibili' | 'tencent' | 'youtube' | 'douyin' | 'youku' | 'iqiyi' | 'vimeo' | 'twitch' | 'twitter' | 'instagram' | 'tiktok' | 'direct' | 'unknown' {
    const u = url.toLowerCase()
    if (u.includes('bilibili.com') || u.includes('b23.tv') || u.includes('bilivideo.com')) return 'bilibili'
    if (u.includes('v.qq.com') || u.includes('腾讯视频')) return 'tencent'
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
    if (u.includes('douyin.com') || u.includes('iesdouyin.com')) return 'douyin'
    if (u.includes('youku.com')) return 'youku'
    if (u.includes('iqiyi.com')) return 'iqiyi'
    if (u.includes('vimeo.com')) return 'vimeo'
    if (u.includes('twitch.tv')) return 'twitch'
    if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter'
    if (u.includes('instagram.com')) return 'instagram'
    if (u.includes('tiktok.com')) return 'tiktok'
    // Check for direct file extensions
    const ext = u.split('?')[0].split('.').pop()?.trim().toLowerCase() || ''
    if (['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv', 'wmv', 'm4v', 'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'yaml', 'yml', 'txt', 'md', 'zip', 'rar', '7z', 'm3u8'].includes(ext)) return 'direct'
    return 'unknown'
  }

  /** 站点特有的默认 HTTP 请求头（避免 Referer 校验/反爬拦截） */
  private getSiteDefaultHeaders(url: string): string[] {
    const u = url.toLowerCase()
    const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    const headers: string[] = [`User-Agent:${DEFAULT_UA}`]

    if (u.includes('bilibili.com') || u.includes('b23.tv') || u.includes('bilivideo.com')) {
      headers.push('Referer:https://www.bilibili.com/')
    } else if (u.includes('v.qq.com')) {
      headers.push('Referer:https://v.qq.com/')
    } else if (u.includes('youku.com')) {
      headers.push('Referer:https://www.youku.com/')
    } else if (u.includes('iqiyi.com')) {
      headers.push('Referer:https://www.iqiyi.com/')
    } else if (u.includes('douyin.com') || u.includes('iesdouyin.com')) {
      headers.push('Referer:https://www.douyin.com/')
    }

    return headers
  }

  /**
   * 获取视频信息（用于前端预览）
   */
  async getVideoInfo(url: string): Promise<VideoInfo> {
    const site = this.detectSite(url)

    if (site === 'direct') {
      return this.getDirectFileInfo(url)
    }

    // 站点视频 + 未知：用 ytdlp-nodejs getInfoAsync
    try {
      const info = await this.ytDlp.getInfoAsync(url)
      if (!('formats' in info)) {
        return this.getDirectFileInfo(url)
      }
      const bestFormat: any = (info.formats || []).find((f: any) => f.ext) || {}
      return {
        title: info.title || this.extractFilename(url),
        url: url,
        ext: bestFormat.ext || 'mp4',
        duration: (info as any).duration || undefined,
        filesize: bestFormat.filesize || undefined,
        width: bestFormat.width || undefined,
        height: bestFormat.height || undefined,
      }
    } catch (err: any) {
      return this.getDirectFileInfo(url)
    }
  }

  /**
   * 创建下载任务（支持站点链接）
   */
  async createDownloadTask(
    urls: Array<{ url: string; fieldName?: string; downloadMethod?: string; ytDlpOptions?: any }>,
    extra: { item_id?: string; filenamePrefix?: string },
  ): Promise<string[]> {
    const taskIds: string[] = []

    for (const { url, fieldName, downloadMethod, ytDlpOptions } of urls) {
      const id = uuid()
      const forcedMethod = downloadMethod || null
      const ytOptsJson = ytDlpOptions ? JSON.stringify(ytDlpOptions) : null
      const site = forcedMethod === 'file' ? 'direct' : forcedMethod === 'yt-dlp' ? 'unknown' : this.detectSite(url)

      if (site === 'direct') {
        const filename = this.sanitizeFilename(extra.filenamePrefix || this.extractFilename(url, extra.item_id))
        const fileType = this.resolveFileType({ download_method: forcedMethod, url, filename })
        this.db.db.prepare(`
          INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, progress, download_method, yt_dlp_options)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
        `).run(id, extra.item_id || null, url, filename, fileType, fieldName || 'link', forcedMethod, ytOptsJson)
        taskIds.push(id)
        continue
      }

      // 站点链接：获取视频信息
      try {
        const info = await this.ytDlp.getInfoAsync(url)
        if (!('formats' in info)) {
          throw new Error('播放列表不支持下载，请指定单个视频链接')
        }
        const ext = (info.formats?.[0]?.ext) || 'mp4'
        const vid = (info as any).id || extractVideoId(url) || extra.item_id?.slice(0, 8) || ''
        const titlePart = info.title ? info.title.replace(/[^\w一-龥]+/g, '_') : this.extractFilename(url)
        const idSuffix = vid ? `_${vid}` : ''
        const filename = this.sanitizeFilename(
          extra.filenamePrefix || `${titlePart}${idSuffix}.${ext}`
        )
        const method = forcedMethod || 'yt-dlp'
        this.db.db.prepare(`
          INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, progress, download_method, yt_dlp_options)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
        `).run(id, extra.item_id || null, url, filename, 'video', fieldName || 'link', method, ytOptsJson)
        taskIds.push(id)
      } catch (err: any) {
        console.error(`[DownloadService] Failed to get info for ${url}:`, err.message)
        const filename = this.sanitizeFilename(extra.filenamePrefix || 'video') + '.*'
        this.db.db.prepare(`
          INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, error, progress, download_method, yt_dlp_options)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?)
        `).run(id, extra.item_id || null, url, filename, 'video', fieldName || 'link', err.message, forcedMethod || 'yt-dlp', ytOptsJson)
        taskIds.push(id)
      }
    }

    return taskIds
  }

  // ════════════════════════════════════════════════════════════════
  // 内部下载方法
  // ════════════════════════════════════════════════════════════════

  /** 使用 ytdlp-nodejs 库下载站点视频，返回实际输出文件路径 */
  private async downloadWithYtDlpLib(
    url: string,
    filePath: string,
    taskId: string,
    itemId: string,
  ): Promise<string> {
    // 方案A：支持临时文件模式（filePath 以 .tmp 结尾时，输出到临时名，由调用方 rename 到正式文件）
    const isTmp = filePath.endsWith('.tmp')
    const realPath = isTmp ? filePath.slice(0, -4) : filePath
    const outputDir = path.dirname(realPath)
    const baseName = path.basename(realPath, path.extname(realPath))
    const outBase = isTmp ? baseName + '.tmp' : baseName

    // 读取 yt-dlp 配置选项
    const task = this.db.db.prepare('SELECT yt_dlp_options FROM download_queue WHERE id = ?').get(taskId) as any
    const opts: YtDlpOptions = task?.yt_dlp_options ? JSON.parse(task.yt_dlp_options) : {}

    let dl = this.ytDlp
      .download(url)
      .on('progress', (progress) => {
        if (this.cancelSet.has(taskId)) return
        if (progress.percentage !== undefined) {
          const pct = Math.round(progress.percentage)
          this.db.db.prepare(`UPDATE download_queue SET progress = ? WHERE id = ?`).run(pct, taskId)
          this.sse.emitEvent('download', {
            taskId,
            itemId,
            status: 'downloading',
            progress: pct,
          })
        }
      })

    // ════════════════════════════════════════════════════════
    // yt-dlp 参数（三层合并：硬编码安全默认 < 全局设置 < 任务配置）
    // null 值 = 显式不设置该参数；undefined = 使用默认值
    // ════════════════════════════════════════════════════════

    // 1. 硬编码安全默认（可被覆盖）
    const mergedOpts: any = {
      qualityPreset: 'compatible' as const,  // 默认画质预设（可被覆盖或留空）
      mergeOutputFormat: 'mp4',
      noPlaylist: true,         // 防止意外下载整个播放列表
      socketTimeout: 30,        // 避免连接挂起
      extractorRetries: 3,      // 提取器错误重试
    }

    // 1a. 站点特有的默认请求头（避免 Referer 校验失败）
    const siteDefaultHeaders = this.getSiteDefaultHeaders(url)
    if (siteDefaultHeaders.length > 0) {
      mergedOpts.addHeaders = siteDefaultHeaders
    }

    // 2. 全局覆盖（settings 表 download_ytdlp_defaults，JSON 格式）
    try {
      const globalRow = this.db.db.prepare("SELECT value FROM settings WHERE key = 'download_ytdlp_defaults'").get() as any
      if (globalRow?.value) {
        const globalOpts = JSON.parse(globalRow.value)
        Object.assign(mergedOpts, globalOpts)
      }
    } catch { /* ignore invalid JSON */ }

    // 3. 任务级覆盖（download_queue.yt_dlp_options）
    if (opts && Object.keys(opts).length > 0) {
      Object.assign(mergedOpts, opts)
    }

    // 应用合并后的参数

    // 画质预设 → format 解析（用户自定义 format 优先于预设）
    const preset = mergedOpts.qualityPreset as keyof typeof QUALITY_PRESET_FORMATS | undefined
    if (!mergedOpts.format && preset && QUALITY_PRESET_FORMATS[preset]) {
      mergedOpts.format = QUALITY_PRESET_FORMATS[preset]
    }
    // qualityPreset 为 null/空 或无匹配 → format 不设置，使用 yt-dlp 默认行为
    // 文本模式 cookies：解析写入 Netscape 格式文件，作为 --cookies 传入，并将解析后的路径回写数据库
    if (mergedOpts.cookies_mode === 'text' && mergedOpts.cookies_text) {
      const cookiesPath = cookiesTextToFilePath(this.dataDir, taskId)
      const ok = writeCookiesTextToFile(mergedOpts.cookies_text, cookiesPath)
      if (ok) {
        mergedOpts.cookies = cookiesPath
        mergedOpts.cookiesFromBrowser = ''  // 清除浏览器模式，避免冲突
        console.log(`[DownloadService] Cookies text → ${cookiesPath}`)
        // 回写：cookies_text → cookies（文件路径），前端等效命令可直接复制测试
        try {
          const row = this.db.db.prepare('SELECT yt_dlp_options FROM download_queue WHERE id = ?').get(taskId) as any
          if (row?.yt_dlp_options) {
            const saved = JSON.parse(row.yt_dlp_options)
            saved.cookies = cookiesPath
            delete saved.cookies_text
            this.db.db.prepare('UPDATE download_queue SET yt_dlp_options = ? WHERE id = ?').run(JSON.stringify(saved), taskId)
          }
        } catch { /* ignore */ }
      } else {
        console.warn(`[DownloadService] Cookies text 为空或格式无效，跳过`)
      }
    }

    dl = dl.output(path.join(outputDir, outBase + '.' + (mergedOpts.mergeOutputFormat || 'mp4')))
    if (mergedOpts.format) dl = dl.format(mergedOpts.format)
    dl = dl.addOption('mergeOutputFormat', mergedOpts.mergeOutputFormat)
    if (mergedOpts.noPlaylist != null) { if (mergedOpts.noPlaylist) dl = dl.addOption('noPlaylist', true) } else { /* null = 不设置 */ }
    if (mergedOpts.socketTimeout != null) dl = dl.addOption('socketTimeout', mergedOpts.socketTimeout)
    if (mergedOpts.extractorRetries != null) dl = dl.addOption('extractorRetries', mergedOpts.extractorRetries)
    if (mergedOpts.cookiesFromBrowser) dl = dl.cookiesFromBrowser(mergedOpts.cookiesFromBrowser)
    if (mergedOpts.cookies) dl = dl.cookies(mergedOpts.cookies)
    if (mergedOpts.proxy) dl = dl.proxy(mergedOpts.proxy)
    if (mergedOpts.limitRate) dl = dl.rateLimit(mergedOpts.limitRate)
    if (mergedOpts.username) dl = dl.username(mergedOpts.username)
    if (mergedOpts.password) dl = dl.password(mergedOpts.password)
    if (mergedOpts.retries !== undefined) dl = dl.addOption('retries', mergedOpts.retries)
    if (mergedOpts.noCheckCertificates) dl = dl.addOption('noCheckCertificates', true)
    if (mergedOpts.geoBypass) dl = dl.addOption('geoBypass', true)
    if (mergedOpts.userAgent) dl = dl.addOption('userAgent', mergedOpts.userAgent)
    if (mergedOpts.referer) dl = dl.addOption('referer', mergedOpts.referer)
    if (mergedOpts.sleepInterval !== undefined) dl = dl.addOption('sleepInterval', mergedOpts.sleepInterval)
    if (mergedOpts.addHeaders) dl = dl.options({ addHeaders: mergedOpts.addHeaders })
    if (mergedOpts.extractorArgs) dl = dl.options({ extractorArgs: mergedOpts.extractorArgs })
    if (mergedOpts.rawArgs && mergedOpts.rawArgs.length > 0) dl = dl.addArgs(...mergedOpts.rawArgs)

    const result = await dl.run()

    // Check cancelled after yt-dlp finishes
    if (this.cancelSet.has(taskId)) return filePath

    // 确定实际输出文件路径（yt-dlp 可能产生与预期不同路径的文件）
    let actualOutputPath = filePath
    if (result.filePaths && result.filePaths.length > 0) {
      actualOutputPath = result.filePaths[0]
    }

    // 清理 yt-dlp 格式合并残留的中间片段（如 video.tmp.f137.mp4、video.tmp.f140.m4a）
    // 这些片段由 yt-dlp 下载分离的视频/音频流时产生，合并后本应自动删除，但有时会残留
    if (isTmp) {
      try {
        const outPrefix = path.basename(outBase)
        const files = fs.readdirSync(outputDir)
        for (const f of files) {
          const fullPath = path.join(outputDir, f)
          if (f.startsWith(outPrefix) && fullPath !== actualOutputPath) {
            try { fs.unlinkSync(fullPath) } catch { /* 忽略单个文件清理失败 */ }
          }
        }
      } catch { /* 忽略目录读取失败 */ }
    }

    // 同步 db 中的 filename 扩展名，确保与实际输出一致
    const actualExt = path.extname(actualOutputPath).replace('.', '').toLowerCase()
    if (actualExt) {
      try {
        const row = this.db.db.prepare('SELECT filename FROM download_queue WHERE id = ?').get(taskId) as any
        if (row?.filename) {
          const dbExt = path.extname(row.filename).replace('.', '').toLowerCase()
          if (dbExt && dbExt !== actualExt) {
            const newFilename = row.filename.replace(/\.[^.]+$/, `.${actualExt}`)
            this.db.db.prepare('UPDATE download_queue SET filename = ? WHERE id = ?').run(newFilename, taskId)
          }
        }
      } catch { /* ignore */ }
    }

    return actualOutputPath
  }

  /** HTTP 直链下载（支持取消） */
  private downloadFile(
    url: string,
    filePath: string,
    taskId: string,
    onProgress: (progress: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http

      // Create AbortController for this download
      const controller = new AbortController()
      this.abortMap.set(taskId, controller)

      const req = protocol.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      }, (response) => {
        // Handle redirect
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            this.abortMap.delete(taskId)
            this.downloadFile(redirectUrl, filePath, taskId, onProgress).then(resolve).catch(reject)
            return
          }
        }

        if (response.statusCode !== 200) {
          this.abortMap.delete(taskId)
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }

        const file = fs.createWriteStream(filePath)
        let receivedBytes = 0
        let lastProgressEmit = 0
        const contentLength = response.headers['content-length']
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0

        response.pipe(file)

        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length
          if (totalBytes > 0) {
            const progress = Math.round((receivedBytes / totalBytes) * 100)
            // Throttle progress updates to avoid too many SSE events
            if (progress !== lastProgressEmit) {
              lastProgressEmit = progress
              onProgress(progress)
            }
          } else {
            // No Content-Length: report progress based on received bytes (cap at 99%)
            // Approximate: use log scale so the bar climbs quickly then slows
            const mb = receivedBytes / (1024 * 1024)
            const progress = Math.min(Math.round(Math.log10(mb + 1) * 30), 99)
            if (progress !== lastProgressEmit) {
              lastProgressEmit = progress
              onProgress(progress)
            }
          }
        })

        file.on('finish', () => {
          file.close()
          this.abortMap.delete(taskId)
          // If cancelled during write, clean up
          if (this.cancelSet.has(taskId)) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
            reject(new Error('Download cancelled'))
            return
          }
          resolve()
        })

        file.on('error', (err) => {
          file.close()
          this.abortMap.delete(taskId)
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
          reject(err)
        })
      })

      req.on('error', (err: any) => {
        this.abortMap.delete(taskId)
        if (err.name === 'AbortError') {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
          reject(new Error('Download cancelled'))
          return
        }
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        reject(err)
      })

      req.setTimeout(300000, () => {
        this.abortMap.delete(taskId)
        req.destroy()
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        reject(new Error('Download timeout'))
      })
    })
  }

  // ════════════════════════════════════════════════════════════════
  // 工具方法
  // ════════════════════════════════════════════════════════════════

  /** Extract filename from URL (strips/replaces pseudo-static extensions like .html on video platforms) */
  private extractFilename(url: string, fallbackId?: string): string {
    const parts = url.split('?')[0].split('/')
    let filename = parts[parts.length - 1] || `file_${Date.now()}`
    // Pseudo-static web extensions (html/php/etc.) are not real file types
    const dotIdx = filename.lastIndexOf('.')
    if (dotIdx > 0) {
      const ext = filename.slice(dotIdx + 1).toLowerCase()
      if (PSEUDO_STATIC_EXTS.has(ext)) {
        // Replace with .mp4 for known video platforms, otherwise strip
        if (isVideoPlatform(url)) {
          filename = filename.slice(0, dotIdx) + '.mp4'
        } else {
          filename = filename.slice(0, dotIdx)
        }
      }
    }
    // Append video ID for uniqueness (unless filename already contains it)
    const vid = extractVideoId(url) || fallbackId?.slice(0, 8) || ''
    if (vid && !filename.includes(vid)) {
      const extIdx = filename.lastIndexOf('.')
      if (extIdx > 0) {
        filename = filename.slice(0, extIdx) + '_' + vid + filename.slice(extIdx)
      } else {
        filename = filename + '_' + vid
      }
    }
    return filename
  }

  /** Sanitize filename */
  private sanitizeFilename(filename: string): string {
    filename = filename.replace(/[\/\\]/g, '_')
    filename = filename.replace(/[<>:"|?*]/g, '')
    filename = filename.replace(/[\x00-\x1f]/g, '')
    if (filename.length > 200) {
      const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
      filename = filename.slice(0, 200 - ext.length) + ext
    }
    return filename
  }

  /** Normalize file path */
  private normalizeFilePath(filename: string): string {
    const clean = filename.replace(/[\/\\]/g, '_')
    const parts = clean.split('/')
    return parts[parts.length - 1]
  }

  /** Get direct file info via HEAD request */
  private getDirectFileInfo(url: string): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http
      const req = protocol.request(url, { method: 'HEAD', timeout: 10000 }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.getDirectFileInfo(res.headers.location).then(resolve).catch(reject)
          return
        }
        if (res.statusCode !== 200) {
          res.destroy()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        const contentLength = res.headers['content-length']
        resolve({
          title: this.extractFilename(url),
          url,
          ext: this.guessExtFromUrl(url),
          filesize: contentLength ? parseInt(contentLength, 10) : undefined,
        })
        res.destroy()
      })
      req.on('error', reject)
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('HEAD timeout')) })
      req.end()
    })
  }

  private guessExtFromUrl(url: string): string {
    const ext = extractExtFromUrl(url)
    if (ext) {
      const type = classifyExt(ext)
      if (type !== 'unknown') return ext
    }
    return 'mp4'
  }
}
