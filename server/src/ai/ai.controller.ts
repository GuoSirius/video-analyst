import { Controller, Post, Get, Delete, Put, Param, Body, Sse } from '@nestjs/common'
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

  // === Provider CRUD ===

  @Get('providers')
  getProviders() {
    return this.ai.getProviders()
  }

  @Post('providers')
  createProvider(@Body() body: any) {
    const p = {
      id: body.id || body.name?.toLowerCase().replace(/\s+/g, '-'),
      name: body.name,
      api_key: body.api_key || '',
      base_url: body.base_url || '',
      default_model: body.default_model || '',
      priority: body.priority ?? this.ai.getProviders().length + 1,
      enabled: body.enabled ?? 1,
    }
    this.ai.saveProvider(p)
    return this.ai.getProviders()
  }

  @Put('providers/:id')
  updateProvider(@Param('id') id: string, @Body() body: any) {
    const existing = this.ai.getProvider(id)
    if (!existing) return { error: 'Not found' }
    this.ai.saveProvider({ ...existing, ...body, id })
    return this.ai.getProviders()
  }

  @Delete('providers/:id')
  deleteProvider(@Param('id') id: string) {
    this.ai.deleteProvider(id)
    return this.ai.getProviders()
  }

  @Post('priority')
  setPriority(@Body() body: { ids: string[] }) {
    this.ai.setPriorities(body.ids)
    return this.ai.getProviders()
  }

  // === Analysis ===

  @Post('analyze')
  async startAnalyze(@Body() body: {
    config: AIConfig
    transcriptionIds: string[]
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
      if (!transcription) throw new Error('Transcription not found')

      this.queue.updateTaskProgress(taskId, 30)
      const { text, provider } = await this.ai.callLLM(config, transcription.content)
      this.queue.updateTaskProgress(taskId, 80)

      const resultId = uuid()
      this.db.db.prepare(`
        INSERT INTO ai_results (id, transcription_id, model, prompt, result, status)
        VALUES (?, ?, ?, ?, ?, 'completed')
      `).run(resultId, transcriptionId, `${provider}/${config.model || 'default'}`, config.prompt, text)

      this.queue.updateTaskProgress(taskId, 100)
      this.queue.updateTaskResult(taskId, { resultId, text, provider })
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }
}
