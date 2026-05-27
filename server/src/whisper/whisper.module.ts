import { Module } from '@nestjs/common'
import { WhisperController } from './whisper.controller'
import { WhisperService } from './whisper.service'
import { AIModule } from '../ai/ai.module'
import { SseModule } from '../common/sse/sse.module'

@Module({
  imports: [SseModule, AIModule],
  controllers: [WhisperController],
  providers: [WhisperService],
  exports: [WhisperService],
})
export class WhisperModule {}
