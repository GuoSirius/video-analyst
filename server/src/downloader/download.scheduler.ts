import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { DownloadService } from './download.service'

@Injectable()
export class DownloadScheduler implements OnModuleInit, OnModuleDestroy {
  private intervalId: NodeJS.Timeout | null = null
  private readonly INTERVAL_MS = 5000 // 5秒检查一次

  constructor(private readonly download: DownloadService) {}

  onModuleInit() {
    // Start the scheduler
    this.intervalId = setInterval(() => {
      this.download.processDownloads().catch(err => {
        console.error('[DownloadScheduler] Process error:', err)
      })
    }, this.INTERVAL_MS)
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }
}