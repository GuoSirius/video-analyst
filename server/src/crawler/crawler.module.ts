import { Module } from '@nestjs/common'
import { CrawlerController } from './crawler.controller'
import { CrawlerService } from './crawler.service'
import { SseModule } from '../common/sse/sse.module'

@Module({
  imports: [SseModule],
  controllers: [CrawlerController],
  providers: [CrawlerService],
})
export class CrawlerModule {}
