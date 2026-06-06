import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'

@Injectable()
export class PipelineService {
  constructor(private readonly db: DatabaseService) {}

  /** 根据爬虫任务 ID 判断是否应该自动导入下载队列 */
  shouldAutoImportDownload(crawlerTaskId: string): boolean {
    const task = this.getCrawlerTask(crawlerTaskId)
    if (!task) return false
    const p = task.payload
    // New granular flag takes precedence; fall back to legacy autoDownload
    if (p.autoImportDownload !== undefined) return !!p.autoImportDownload
    return !!(p.autoPipeline || p.autoDownload)
  }

  /** 根据爬虫任务 ID 判断是否应该自动启动下载 */
  shouldAutoStartDownload(crawlerTaskId: string): boolean {
    const task = this.getCrawlerTask(crawlerTaskId)
    if (!task) return false
    const p = task.payload
    if (p.autoStartDownload !== undefined) return !!p.autoStartDownload
    return !!(p.autoPipeline || p.autoDownload)
  }

  /** 根据爬虫任务 ID 判断是否应该自动转码 */
  shouldAutoTranscode(crawlerTaskId: string): boolean {
    const task = this.getCrawlerTask(crawlerTaskId)
    if (!task) return false
    const p = task.payload
    return !!(p.autoPipeline || p.autoTranscode)
  }

  /** 根据爬虫任务 ID 判断是否应该自动 Whisper 识别（转码完成后） */
  shouldAutoWhisper(crawlerTaskId: string): boolean {
    const task = this.getCrawlerTask(crawlerTaskId)
    if (!task) return false
    const p = task.payload
    // New granular flag takes precedence; fall back to legacy autoTranscode
    if (p.autoWhisper !== undefined) return !!p.autoWhisper
    return !!(p.autoPipeline || p.autoTranscode)
  }

  /** 根据爬虫任务 ID 判断是否应该自动 AI 分析 */
  shouldAutoAI(crawlerTaskId: string): boolean {
    const task = this.getCrawlerTask(crawlerTaskId)
    if (!task) return false
    const p = task.payload
    return !!(p.autoPipeline || p.autoAI)
  }

  /** 通过 crawl_items.id 追溯到爬虫任务 ID */
  getCrawlerTaskIdFromItemId(itemId: string): string | null {
    const item = this.db.db.prepare('SELECT task_id FROM crawl_items WHERE id = ?').get(itemId) as any
    return item?.task_id || null
  }

  /** 通过 download_queue.id 追溯到爬虫任务 ID */
  getCrawlerTaskIdFromDownloadId(downloadId: string): string | null {
    const dl = this.db.db.prepare('SELECT item_id FROM download_queue WHERE id = ?').get(downloadId) as any
    if (!dl?.item_id) return null
    return this.getCrawlerTaskIdFromItemId(dl.item_id)
  }

  private getCrawlerTask(taskId: string): any {
    const row = this.db.db.prepare('SELECT * FROM tasks WHERE id = ? AND type = ?').get(taskId, 'crawler') as any
    if (!row) return null
    return {
      ...row,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : undefined,
    }
  }
}
