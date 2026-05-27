import { Controller, Post, Get, Delete, Param, Body, Sse } from '@nestjs/common'
import { Observable } from 'rxjs'
import { AIService, AIConfig } from './ai.service'
import { QueueService } from '../common/queue/queue.service'
import { SseService } from '../common/sse/sse.service'
import { DatabaseService } from '../common/database/database.service'
import { v4 as uuid } from 'uuid'

@Controller('api/ai')
export class AIController {
  constructor(
    private readonly ai: AIService,
    private readonly queue: QueueService,
    private readonly sse: SseService,
    private readonly db: DatabaseService,
  ) {}

  @Get('providers')
  getProviders() {
    return this.ai.getProviders()
  }

  @Post('analyze')
  async startAnalyze(@Body() body: {
    config: AIConfig
    transcriptionIds: string[]
    batchSize?: number
  }) {
    if (!body.transcriptionIds?.length) {
      return { error: 'No transcriptions selected' }
    }

    const tasks: { taskId: string; transcriptionId: string }[] = []
    for (const tid of body.transcriptionIds) {
      const task = this.queue.createTask('ai', { config: body.config, transcriptionId: tid })
      tasks.push({ taskId: task.id, transcriptionId: tid })
      this.processAITask(task.id, body.config, tid)
    }

    return { tasks }
  }

  @Get('tasks')
  getTasks() {
    return this.queue.getTasksByType('ai')
  }

  @Get('results')
  getResults() {
    return this.db.db.prepare('SELECT * FROM ai_results ORDER BY created_at DESC').all()
  }

  @Delete('tasks/:id')
  cancelTask(@Param('id') id: string) {
    this.queue.cancelTask(id)
    return { ok: true }
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.sse.getTaskStream()
  }

  private async processAITask(taskId: string, config: AIConfig, transcriptionId: string) {
    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 10)

      const transcription = this.db.db.prepare('SELECT * FROM transcriptions WHERE id = ?').get(transcriptionId) as any
      if (!transcription) {
        throw new Error('Transcription not found')
      }

      this.queue.updateTaskProgress(taskId, 30)
      const result = await this.ai.callLLM(config, transcription.content)
      this.queue.updateTaskProgress(taskId, 80)

      const resultId = uuid()
      this.db.db.prepare(`
        INSERT INTO ai_results (id, transcription_id, model, prompt, result, status)
        VALUES (?, ?, ?, ?, ?, 'completed')
      `).run(resultId, transcriptionId, config.model, config.prompt, result)

      this.queue.updateTaskProgress(taskId, 100)
      this.queue.updateTaskResult(taskId, { resultId, result })
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }
}
