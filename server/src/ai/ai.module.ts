import { Module } from '@nestjs/common'
import { AIController } from './ai.controller'
import { AIService } from './ai.service'
import { SseModule } from '../common/sse/sse.module'

@Module({
  imports: [SseModule],
  controllers: [AIController],
  providers: [AIService],
})
export class AIModule {}
