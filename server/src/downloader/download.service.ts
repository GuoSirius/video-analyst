import { Injectable } from '@nestjs/common'
import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { YtDlp } from 'ytdlp-nodejs'
import { DatabaseService } from '../common/database/database.service'
import { SseService } from '../common/sse/sse.service'
import { v4 as uuid } from 'uuid'
import type { YtDlpOptions } from '../crawler/crawler.service'

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
  private ytDlp: YtDlp
  /** 被终止的任务 ID 集合（yt-dlp 无法真正中断，完成后检查此集合忽略结果） */
  private cancelSet = new Set<string>()
  /** HTTP 下载的 AbortController 映射（支持真正中断 HTTP 直链下载） */
  private abortMap = new Map<string, AbortController>()

  constructor(
    private readonly db: DatabaseService,
    private readonly sse: SseService,
  ) {
    this.downloadDir = path.resolve(projectRoot, 'data', 'downloads')
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true })
    }
    this.ytDlp = new YtDlp()
  }

  getDownloadDir() {
    return this.downloadDir
  }

  /** Process pending download tasks — called by scheduler */
  async processDownloads() {
    const pendingTasks = this.db.db.prepare(
      'SELECT * FROM download_queue WHERE status = ? ORDER BY created_at ASC LIMIT 5'
    ).all('pending') as any[]

    for (const task of pendingTasks) {
      if (this.cancelSet.has(task.id)) continue
      try {
        await this.executeDownload(task)
      } catch (err: any) {
        console.error(`[DownloadScheduler] Task ${task.id} failed:`, err.message)
      }
    }
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
      const dateStr = new Date().toISOString().slice(0, 10)  // e.g. 2026-06-06
      return path.join(this.downloadDir, 'uploads', dateStr)
    }

    // 手动添加链接 / 其他：manual/{YYYY-MM-DD}/
    const dateStr = new Date().toISOString().slice(0, 10)  // e.g. 2026-06-06
    return path.join(this.downloadDir, 'manual', dateStr)
  }

  /** Determine file type by download method first, then by URL/extension */
  private resolveFileType(task: any): string {
    const method = task.download_method  // NULL | 'yt-dlp' | 'file'
    const url = task.url || ''
    const ext = (task.filename || '').includes('.')
      ? (task.filename as string).split('.').pop()?.toLowerCase() || ''
      : ''

    // yt-dlp 下载 → 一定是视频（站点视频平台）
    if (method === 'yt-dlp') return 'video'

    // HTTP 直链 → 根据扩展名判断
    if (method === 'file') return this.getFileTypeByExt(ext)

    // NULL（自动检测/旧数据）→ URL 平台检测 + 扩展名兜底
    if (this.isVideoPlatform(url)) return 'video'

    // 从 filename 提取扩展名
    if (ext) {
      const ft = this.getFileTypeByExt(ext)
      if (ft !== 'unknown') return ft
    }

    // URL 路径末段兜底
    const lastSeg = url.split('?')[0].split('/').pop() || ''
    const urlExt = lastSeg.includes('.') ? lastSeg.split('.').pop()?.toLowerCase() || '' : ''
    if (urlExt && urlExt !== 'html' && urlExt !== 'php' && urlExt !== 'asp' && urlExt !== 'jsp') {
      return this.getFileTypeByExt(urlExt)
    }

    return 'unknown'
  }

  /** 已知视频平台检测（伪静态页面如 .html 结尾但实际是视频） */
  private isVideoPlatform(url: string): boolean {
    const sites = [
      'v.qq.com', 'bilibili.com', 'bilivideo.com', 'b23.tv',
      'youtube.com', 'youtu.be', 'douyin.com', 'iesdouyin.com',
      'youku.com', 'iqiyi.com', 'vimeo.com', 'twitch.tv',
      'twitter.com', 'x.com', 'instagram.com', 'tiktok.com',
    ]
    return sites.some(s => url.includes(s))
  }

  /** 纯扩展名 → 文件类型（不含平台判断） */
  private getFileTypeByExt(ext: string): string {
    const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4v', 'ts', 'm3u8']
    const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma', 'opus']
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
    const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'yaml', 'yml', 'txt', 'md']
    if (videoExts.includes(ext)) return 'video'
    if (audioExts.includes(ext)) return 'audio'
    if (imageExts.includes(ext)) return 'image'
    if (docExts.includes(ext)) return 'document'
    return 'unknown'
  }

  /** Execute a single download task */
  private async executeDownload(task: any) {
    const taskId = task.id
    const url = task.url
    const itemId = task.item_id
    const filename = this.sanitizeFilename(task.filename || this.extractFilename(url))

    // 目录结构: {taskName}_{taskId8}/{itemId8}/ | uploads/{YYYY-MM}/ | manual/{YYYY-MM-DD}/
    const itemDir = this.resolveDownloadPath(task)
    const normalizedFilename = this.normalizeFilePath(filename)
    const dirPath = path.join(itemDir, path.dirname(normalizedFilename))
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    const filePath = path.join(itemDir, normalizedFilename)

    // Check if cancelled before starting
    if (this.cancelSet.has(taskId)) {
      this.handleCancelled(taskId, filePath)
      return
    }

    try {
      this.db.db.prepare(`UPDATE download_queue SET status = 'downloading', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(taskId)
      this.sse.emitEvent('download', { taskId, itemId, status: 'downloading', progress: 0 })

      // 根据 download_method 字段选择下载方式
      const method = task.download_method  // NULL | 'yt-dlp' | 'file'

      if (method === 'file') {
        await this.downloadFile(url, filePath, taskId, (progress) => {
          if (this.cancelSet.has(taskId)) return // 忽略进度更新
          this.db.db.prepare(`UPDATE download_queue SET progress = ? WHERE id = ?`).run(progress, taskId)
          this.sse.emitEvent('download', { taskId, itemId, status: 'downloading', progress })
        })
      } else if (method === 'yt-dlp') {
        await this.downloadWithYtDlpLib(url, filePath, taskId, itemId)
      } else {
        // NULL：自动检测（兼容旧数据 + 手动添加的链接）
        const site = this.detectSite(url)
        if (site === 'direct') {
          await this.downloadFile(url, filePath, taskId, (progress) => {
            if (this.cancelSet.has(taskId)) return
            this.db.db.prepare(`UPDATE download_queue SET progress = ? WHERE id = ?`).run(progress, taskId)
            this.sse.emitEvent('download', { taskId, itemId, status: 'downloading', progress })
          })
        } else {
          await this.downloadWithYtDlpLib(url, filePath, taskId, itemId)
        }
      }

      // Check if cancelled after download completed
      if (this.cancelSet.has(taskId)) {
        this.handleCancelled(taskId, filePath)
        return
      }

      // Download succeeded — handle reimport_pending first
      const didReimport = await this.handleReimportIfPending(taskId)
      if (!didReimport) {
        this.db.db.prepare(`UPDATE download_queue SET status = 'completed', file_path = ?, progress = 100, updated_at = datetime('now') WHERE id = ?`).run(toRelative(filePath), taskId)
        this.sse.emitEvent('download', { taskId, itemId, status: 'completed', filePath, progress: 100 })
      }
      return

    } catch (err: any) {
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

    // Create new download tasks
    const insertStmt = this.db.db.prepare(`
      INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, download_method, yt_dlp_options)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `)

    for (const u of opts.urls) {
      const newId = uuid()
      const ytOptsJson = u.ytDlpOptions ? JSON.stringify(u.ytDlpOptions) : null
      insertStmt.run(newId, opts.itemId, u.url, u.filename, u.fileType, u.fieldName, u.downloadMethod, ytOptsJson)
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

  /** Batch start pending tasks */
  batchStart(ids: string[]) {
    const stmt = this.db.db.prepare(`UPDATE download_queue SET status = 'pending', error = NULL, progress = 0 WHERE id = ?`)
    let count = 0
    for (const id of ids) {
      const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as any
      if (task && task.status === 'pending') {
        // Already pending — will be picked up by scheduler; just ensure it's clean
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

  /** Batch auto pipeline: transcode → whisper → AI for completed downloads */
  async batchAutoPipeline(ids: string[], queueService: any) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = []

    for (const id of ids) {
      try {
        const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as any
        if (!task) { results.push({ id, ok: false, error: '任务不存在' }); continue }
        if (task.status !== 'completed') { results.push({ id, ok: false, error: '只能对已完成的下载执行流水线' }); continue }
        const filePath = resolvePath(task.file_path)
        if (!filePath || !fs.existsSync(filePath)) { results.push({ id, ok: false, error: '下载文件不存在' }); continue }

        // 追溯爬虫任务 ID
        let crawlerTaskId: string | undefined
        if (task.item_id) {
          const item = this.db.db.prepare('SELECT task_id FROM crawl_items WHERE id = ?').get(task.item_id) as any
          crawlerTaskId = item?.task_id || undefined
        }

        const outputDir = path.resolve(projectRoot, 'data', 'transcoded')
        const fileName = task.filename || path.basename(filePath)

        // Create transcode task — processing handled by caller (controller)
        queueService.createTask('transcode', {
          file: toRelative(filePath),
          outputDir: toRelative(outputDir),
          source: 'download',
          fileName,
          crawlerTaskId,
        })
        results.push({ id, ok: true })
      } catch (err: any) {
        results.push({ id, ok: false, error: err.message })
      }
    }

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
        const filename = this.sanitizeFilename(extra.filenamePrefix || this.extractFilename(url))
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
        const filename = this.sanitizeFilename(
          extra.filenamePrefix || (info.title ? info.title + '.' + ext : this.extractFilename(url))
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

  /** 使用 ytdlp-nodejs 库下载站点视频 */
  private async downloadWithYtDlpLib(
    url: string,
    filePath: string,
    taskId: string,
    itemId: string,
  ): Promise<void> {
    const outputDir = path.dirname(filePath)
    const baseName = path.basename(filePath, path.extname(filePath))

    // 读取 yt-dlp 配置选项
    const task = this.db.db.prepare('SELECT yt_dlp_options FROM download_queue WHERE id = ?').get(taskId) as any
    const opts: YtDlpOptions = task?.yt_dlp_options ? JSON.parse(task.yt_dlp_options) : {}

    let dl = this.ytDlp
      .download(url)
      .output(path.join(outputDir, baseName + '.%(ext)s'))
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
    // ════════════════════════════════════════════════════════

    // 1. 硬编码安全默认（可被覆盖）
    const mergedOpts: any = {
      format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      mergeOutputFormat: 'mp4',
      noPlaylist: true,         // 防止意外下载整个播放列表
      socketTimeout: 30,        // 避免连接挂起
      extractorRetries: 3,      // 提取器错误重试
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
    dl = dl.format(mergedOpts.format)
    dl = dl.addOption('mergeOutputFormat', mergedOpts.mergeOutputFormat)
    if (mergedOpts.noPlaylist) dl = dl.addOption('noPlaylist', true)
    if (mergedOpts.socketTimeout) dl = dl.addOption('socketTimeout', mergedOpts.socketTimeout)
    if (mergedOpts.extractorRetries) dl = dl.addOption('extractorRetries', mergedOpts.extractorRetries)
    if (mergedOpts.cookiesFromBrowser) dl = dl.cookiesFromBrowser(mergedOpts.cookiesFromBrowser)
    if (mergedOpts.cookies) dl = dl.cookies(mergedOpts.cookies)
    if (mergedOpts.proxy) dl = dl.proxy(mergedOpts.proxy)
    if (mergedOpts.limitRate) dl = dl.rateLimit(mergedOpts.limitRate)
    if (mergedOpts.username) dl = dl.username(mergedOpts.username)
    if (mergedOpts.password) dl = dl.password(mergedOpts.password)
    if (opts.retries !== undefined) dl = dl.addOption('retries', opts.retries)
    if (opts.noCheckCertificates) dl = dl.addOption('noCheckCertificates', true)
    if (opts.geoBypass) dl = dl.addOption('geoBypass', true)
    if (opts.userAgent) dl = dl.addOption('userAgent', opts.userAgent)
    if (opts.referer) dl = dl.addOption('referer', opts.referer)
    if (opts.sleepInterval !== undefined) dl = dl.addOption('sleepInterval', opts.sleepInterval)
    if (opts.addHeaders) dl = dl.options({ addHeaders: opts.addHeaders })
    if (opts.extractorArgs) dl = dl.options({ extractorArgs: opts.extractorArgs })
    if (opts.rawArgs && opts.rawArgs.length > 0) dl = dl.addArgs(...opts.rawArgs)

    const result = await dl.run()

    // Check cancelled after yt-dlp finishes
    if (this.cancelSet.has(taskId)) return

    // 如果下载的文件名与预期不同，重命名
    if (result.filePaths && result.filePaths.length > 0) {
      const actualPath = result.filePaths[0]
      if (actualPath !== filePath && fs.existsSync(actualPath)) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        fs.renameSync(actualPath, filePath)
      }
    }
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
        const contentLength = response.headers['content-length']
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0

        response.pipe(file)

        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length
          if (totalBytes > 0) {
            const progress = Math.round((receivedBytes / totalBytes) * 100)
            onProgress(progress)
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

  /** Extract filename from URL */
  private extractFilename(url: string): string {
    const parts = url.split('?')[0].split('/')
    const filename = parts[parts.length - 1]
    return filename || `file_${Date.now()}`
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
    const u = url.split('?')[0].split('#')[0]
    const last = u.split('/').pop()?.split('.').pop()?.toLowerCase() || 'mp4'
    const validExts = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv', 'wmv', 'm4v', 'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'yaml', 'yml', 'txt', 'md']
    if (validExts.includes(last)) return last
    return 'mp4'
  }
}
