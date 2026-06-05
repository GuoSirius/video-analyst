import { Module } from '@nestjs/common'
import { DownloadController } from './download.controller'
import { DownloadService } from './download.service'
import { DownloadScheduler } from './download.scheduler'
import { DatabaseModule } from '../common/database/database.module'
import { SseModule } from '../common/sse/sse.module'
import { TranscoderModule } from '../transcoder/transcoder.module'

@Module({
  imports: [DatabaseModule, SseModule, TranscoderModule],
  controllers: [DownloadController],
  providers: [DownloadService, DownloadScheduler],
  exports: [DownloadService],
})
export class DownloadModule {}