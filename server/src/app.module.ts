import { Module } from '@nestjs/common'
import { ServeStaticModule } from '@nestjs/serve-static'
import { join } from 'path'
import { DatabaseModule } from './common/database/database.module'
import { QueueModule } from './common/queue/queue.module'
import { SseModule } from './common/sse/sse.module'
import { PipelineModule } from './common/pipeline/pipeline.module'
import { CrawlerModule } from './crawler/crawler.module'
import { TranscoderModule } from './transcoder/transcoder.module'
import { WhisperModule } from './whisper/whisper.module'
import { AIModule } from './ai/ai.module'
import { ExportModule } from './export/export.module'
import { SettingsModule } from './settings/settings.module'
import { DownloadModule } from './downloader/download.module'

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', '..', 'web', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    DatabaseModule,
    QueueModule,
    SseModule,
    PipelineModule,
    SettingsModule,
    CrawlerModule,
    DownloadModule,
    TranscoderModule,
    WhisperModule,
    AIModule,
    ExportModule,
  ],
})
export class AppModule {}
