import { Module } from '@nestjs/common'
import { TranscoderController } from './transcoder.controller'
import { TranscoderService } from './transcoder.service'
import { WhisperModule } from '../whisper/whisper.module'
import { SseModule } from '../common/sse/sse.module'

@Module({
  imports: [SseModule, WhisperModule],
  controllers: [TranscoderController],
  providers: [TranscoderService],
})
export class TranscoderModule {}
