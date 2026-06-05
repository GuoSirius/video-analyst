import { Controller, Get, Post, Put, Body } from '@nestjs/common'
import { DatabaseService } from '../common/database/database.service'

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly db: DatabaseService) {}

  /** @deprecated 流水线控制已改为任务级别，此接口仅返回固定值兼容前端 */
  @Get('pipeline')
  getPipeline() {
    return { autoMode: false }
  }

  /** @deprecated 流水线控制已改为任务级别 */
  @Post('pipeline')
  setPipeline(@Body() _body: { autoMode: boolean }) {
    return { autoMode: false }
  }

  /** 获取 yt-dlp 全局默认参数 */
  @Get('ytdlp-defaults')
  getYtdlpDefaults() {
    try {
      const row = this.db.db.prepare("SELECT value FROM settings WHERE key = 'download_ytdlp_defaults'").get() as any
      if (row?.value) {
        return { opts: JSON.parse(row.value) }
      }
    } catch { /* ignore */ }
    return { opts: {} }
  }

  /** 设置 yt-dlp 全局默认参数（会与任务级参数合并，任务级优先） */
  @Put('ytdlp-defaults')
  setYtdlpDefaults(@Body() body: { opts: Record<string, any> }) {
    const value = JSON.stringify(body.opts || {})
    this.db.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('download_ytdlp_defaults', ?)"
    ).run(value)
    return { ok: true }
  }
}
