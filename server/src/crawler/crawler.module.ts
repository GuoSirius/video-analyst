import { Module } from '@nestjs/common'
import { CrawlerController } from './crawler.controller'
import { CrawlerService } from './crawler.service'
import { SseModule } from '../common/sse/sse.module'
import { DownloadModule } from '../downloader/download.module'

@Module({
  imports: [SseModule, DownloadModule],
  controllers: [CrawlerController],
  providers: [CrawlerService],
})
export class CrawlerModule {}
