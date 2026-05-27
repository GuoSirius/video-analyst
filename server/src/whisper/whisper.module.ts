import { Module } from '@nestjs/common'
import { WhisperController } from './whisper.controller'
import { WhisperService } from './whisper.service'
import { SseModule } from '../common/sse/sse.module'

@Module({
  imports: [SseModule],
  controllers: [WhisperController],
  providers: [WhisperService],
})
export class WhisperModule {}
