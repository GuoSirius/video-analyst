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

@Injectable()
export class DownloadService {
  private downloadDir: string
  private ytDlp: YtDlp

  constructor(
    private readonly db: DatabaseService,
    private readonly sse: SseService,
  ) {
    this.downloadDir = path.resolve(process.cwd(), '..', 'data', 'downloads')
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true })
    }
    this.ytDlp = new YtDlp()
  }

  getDownloadDir() {
    return this.downloadDir
  }

  /** Process pending download tasks */
  async processDownloads() {
    const pendingTasks = this.db.db.prepare(
      'SELECT * FROM download_queue WHERE status = ? ORDER BY created_at ASC LIMIT 5'
    ).all('pending') as any[]

    for (const task of pendingTasks) {
      try {
        await this.executeDownload(task)
      } catch (err: any) {
        console.error(`[DownloadScheduler] Task ${task.id} failed:`, err.message)
      }
    }
  }

  /** Execute a single download task */
  private async executeDownload(task: any) {
    const taskId = task.id
    const url = task.url
    const itemId = task.item_id
    const filename = this.sanitizeFilename(task.filename || this.extractFilename(url))
    const itemDir = itemId ? path.join(this.downloadDir, itemId.slice(0, 8)) : this.downloadDir

    const normalizedFilename = this.normalizeFilePath(filename)
    const dirPath = path.join(itemDir, path.dirname(normalizedFilename))
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    const filePath = path.join(itemDir, normalizedFilename)

    try {
      this.db.db.prepare(`UPDATE download_queue SET status = 'downloading', updated_at = datetime('now') WHERE id = ?`).run(taskId)
      this.sse.emitEvent('download', { taskId, itemId, status: 'downloading', progress: 0 })

      // 根据 download_method 字段选择下载方式
      const method = task.download_method  // NULL | 'yt-dlp' | 'file'

      if (method === 'file') {
        // 强制 HTTP 直链下载
        await this.downloadFile(url, filePath, (progress) => {
          this.db.db.prepare(`UPDATE download_queue SET progress = ? WHERE id = ?`).run(progress, taskId)
          this.sse.emitEvent('download', { taskId, itemId, status: 'downloading', progress })
        })
      } else if (method === 'yt-dlp') {
        // 强制 yt-dlp 下载
        await this.downloadWithYtDlpLib(url, filePath, taskId, itemId)
      } else {
        // NULL：自动检测（兼容旧数据 + 手动添加的链接）
        const site = this.detectSite(url)
        if (site === 'direct') {
          await this.downloadFile(url, filePath, (progress) => {
            this.db.db.prepare(`UPDATE download_queue SET progress = ? WHERE id = ?`).run(progress, taskId)
            this.sse.emitEvent('download', { taskId, itemId, status: 'downloading', progress })
          })
        } else {
          await this.downloadWithYtDlpLib(url, filePath, taskId, itemId)
        }
      }

      this.db.db.prepare(`UPDATE download_queue SET status = 'completed', file_path = ?, progress = 100, updated_at = datetime('now') WHERE id = ?`).run(filePath, taskId)
      this.sse.emitEvent('download', { taskId, itemId, status: 'completed', filePath, progress: 100 })

    } catch (err: any) {
      this.db.db.prepare(`UPDATE download_queue SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`).run(err.message, taskId)
      this.sse.emitEvent('download', { taskId, itemId, status: 'failed', error: err.message })
    }
  }

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

    // 应用用户配置的 yt-dlp 选项
    if (opts.format) {
      dl = dl.format(opts.format)
    } else {
      dl = dl.filter('mergevideo').type('mp4')
    }
    if (opts.cookiesFromBrowser) dl = dl.cookiesFromBrowser(opts.cookiesFromBrowser)
    if (opts.cookies) dl = dl.cookies(opts.cookies)
    if (opts.proxy) dl = dl.proxy(opts.proxy)
    if (opts.limitRate) dl = dl.rateLimit(opts.limitRate)
    if (opts.username) dl = dl.username(opts.username)
    if (opts.password) dl = dl.password(opts.password)
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

    // 如果下载的文件名与预期不同，重命名
    if (result.filePaths && result.filePaths.length > 0) {
      const actualPath = result.filePaths[0]
      if (actualPath !== filePath && fs.existsSync(actualPath)) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        fs.renameSync(actualPath, filePath)
      }
    }
  }

  /** HTTP 直链下载（保留原有逻辑） */
  private downloadFile(url: string, filePath: string, onProgress: (progress: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http
      const file = fs.createWriteStream(filePath)
      let receivedBytes = 0
      let totalBytes = 0

      const request = protocol.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            file.close()
            fs.unlinkSync(filePath)
            this.downloadFile(redirectUrl, filePath, onProgress).then(resolve).catch(reject)
            return
          }
        }

        if (response.statusCode !== 200) {
          file.close()
          fs.unlinkSync(filePath)
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }

        const contentLength = response.headers['content-length']
        totalBytes = contentLength ? parseInt(contentLength, 10) : 0

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
          resolve()
        })

        file.on('error', (err) => {
          file.close()
          fs.unlinkSync(filePath)
          reject(err)
        })
      })

      request.on('error', (err) => {
        file.close()
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        reject(err)
      })

      request.setTimeout(300000, () => {
        request.destroy()
        file.close()
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        reject(new Error('Download timeout'))
      })
    })
  }

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

  /** Retry a failed download task */
  async retryDownload(taskId: string) {
    const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(taskId) as any
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'failed' && task.status !== 'completed') {
      return { error: 'Only failed or completed tasks can be retried' }
    }
    this.db.db.prepare(`UPDATE download_queue SET status = 'pending', error = NULL, progress = 0, updated_at = datetime('now') WHERE id = ?`).run(taskId)
    await this.executeDownload(task)
    return { ok: true }
  }

  /** Delete a download task */
  deleteTask(taskId: string) {
    const task = this.db.db.prepare('SELECT * FROM download_queue WHERE id = ?').get(taskId) as any
    if (!task) return { error: 'Task not found' }
    if (task.file_path && fs.existsSync(task.file_path)) {
      fs.unlinkSync(task.file_path)
    }
    this.db.db.prepare('DELETE FROM download_queue WHERE id = ?').run(taskId)
    return { ok: true }
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

  // ==================== 站点识别与分发 ====================

  /** 判断 URL 是否属于受支持的站点 */
  detectSite(url: string): 'bilibili' | 'tencent' | 'youtube' | 'direct' | 'unknown' {
    const u = url.toLowerCase()
    if (u.includes('bilibili.com') || u.includes('b23.tv') || u.includes('bilivideo.com')) return 'bilibili'
    if (u.includes('qq.com') || u.includes('v.qq.com') || u.includes('tenpay.com')) return 'tencent'
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
    const ext = u.split('?')[0].split('.').pop()?.trim() || ''
    if (['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv', 'wmv', 'm4v'].includes(ext)) return 'direct'
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
      // getInfoAsync 返回 VideoInfo | PlaylistInfo，仅处理 VideoInfo
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
      // fallback: HEAD 检测
      return this.getDirectFileInfo(url)
    }
  }

  /** 获取直链文件的头部信息 */
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
    if (['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv', 'wmv', 'm4v', 'mp3', 'wav', 'ogg'].includes(last)) return last
    return 'mp4'
  }

  /**
   * 创建下载任务（支持站点链接）
   */
  async createDownloadTask(
    urls: Array<{ url: string; fieldName?: string }>,
    extra: { item_id?: string; filenamePrefix?: string },
  ): Promise<string[]> {
    const taskIds: string[] = []

    for (const { url, fieldName } of urls) {
      const id = uuid()
      const site = this.detectSite(url)

      if (site === 'direct') {
        const filename = this.sanitizeFilename(extra.filenamePrefix || this.extractFilename(url))
        const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || 'mp4'
        const fileType = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv'].includes(ext) ? 'video' : 'unknown'
        this.db.db.prepare(`
          INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, progress)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)
        `).run(id, extra.item_id || null, url, filename, fileType, fieldName || 'link')
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
        this.db.db.prepare(`
          INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, progress)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)
        `).run(id, extra.item_id || null, url, filename, 'video', fieldName || 'link')
        taskIds.push(id)
      } catch (err: any) {
        console.error(`[DownloadService] Failed to get info for ${url}:`, err.message)
        this.db.db.prepare(`
          INSERT INTO download_queue (id, item_id, url, filename, file_type, field_name, status, error, progress)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0)
        `).run(id, extra.item_id || null, url,
          this.sanitizeFilename(extra.filenamePrefix || 'video') + '.*',
          'video', fieldName || 'link', err.message)
        taskIds.push(id)
      }
    }

    return taskIds
  }
}
