import { Module } from '@nestjs/common'
import { AIController } from './ai.controller'
import { PromptController } from './prompt.controller'
import { AIService } from './ai.service'
import { PromptService } from './prompt.service'
import { SseModule } from '../common/sse/sse.module'

@Module({
  imports: [SseModule],
  controllers: [AIController, PromptController],
  providers: [AIService, PromptService],
  exports: [AIService],
})
export class AIModule {}
