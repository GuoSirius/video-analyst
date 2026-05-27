import { Module } from '@nestjs/common'
import { TranscoderController } from './transcoder.controller'
import { TranscoderService } from './transcoder.service'
import { SseModule } from '../common/sse/sse.module'

@Module({
  imports: [SseModule],
  controllers: [TranscoderController],
  providers: [TranscoderService],
})
export class TranscoderModule {}
