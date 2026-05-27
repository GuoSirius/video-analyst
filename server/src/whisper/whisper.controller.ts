import { Controller, Post, Get, Delete, Param, Body, Query, Sse } from '@nestjs/common'
import { Observable } from 'rxjs'
import { WhisperService } from './whisper.service'
import { AIService } from '../ai/ai.service'
import { QueueService } from '../common/queue/queue.service'
import { SseService } from '../common/sse/sse.service'
import { DatabaseService } from '../common/database/database.service'
import { PipelineService } from '../common/pipeline/pipeline.service'
import { v4 as uuid } from 'uuid'
import * as path from 'path'
import * as fs from 'fs'

@Controller('api/whisper')
export class WhisperController {
  private transcodedDir: string

  constructor(
    private readonly whisper: WhisperService,
    private readonly ai: AIService,
    private readonly queue: QueueService,
    private readonly sse: SseService,
    private readonly db: DatabaseService,
    private readonly pipeline: PipelineService,
  ) {
    this.transcodedDir = path.resolve(process.cwd(), '..', 'data', 'transcoded')
  }

  @Get('models')
  getModels() {
    const current = this.db.db.prepare("SELECT value FROM settings WHERE key = 'whisper_model'").get() as any
    return {
      models: this.whisper.getAvailableModels(),
      current: current?.value || 'base',
      mode: this.whisper.isApiMode() ? 'api' : 'local',
    }
  }

  @Post('models')
  setModel(@Body() body: { model: string }) {
    this.db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('whisper_model', ?)").run(body.model)
    return { model: body.model }
  }

  @Post('transcribe')
  async startTranscribe(@Body() body: { filePath?: string; itemIds?: string[]; options?: any }) {
    const filesToProcess: { path: string; itemId?: string }[] = []

    if (body.filePath) {
      filesToProcess.push({ path: body.filePath })
    }

    if (body.itemIds?.length) {
      const items = this.db.db.prepare(
        'SELECT * FROM crawl_items WHERE id IN (' + body.itemIds.map(() => '?').join(',') + ')'
      ).all(...body.itemIds) as any[]
      for (const item of items) {
        const filename = item.media_url ? path.basename(item.media_url, path.extname(item.media_url)) + '.wav' : null
        if (filename) {
          const transcodedPath = path.join(this.transcodedDir, filename)
          if (fs.existsSync(transcodedPath)) {
            filesToProcess.push({ path: transcodedPath, itemId: item.id })
          }
        }
      }
    }

    if (!filesToProcess.length) {
      return { error: 'No files to transcribe' }
    }

    const tasks: { taskId: string; file: string }[] = []
    for (const { path: fp, itemId } of filesToProcess) {
      const task = this.queue.createTask('whisper', { filePath: fp, itemId, options: body.options || {} })
      tasks.push({ taskId: task.id, file: fp })
      this.processWhisperTask(task.id, fp, itemId, body.options)
    }

    return { tasks }
  }

  @Get('tasks')
  getTasks() {
    return this.queue.getTasksByType('whisper')
  }

  @Get('results')
  getResults(@Query('itemId') itemId?: string) {
    const sql = itemId
      ? 'SELECT * FROM transcriptions WHERE item_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM transcriptions ORDER BY created_at DESC'
    return itemId
      ? this.db.db.prepare(sql).all(itemId)
      : this.db.db.prepare(sql).all()
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

  private async processWhisperTask(taskId: string, filePath: string, itemId?: string, options?: any) {
    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 30)

      const modelRow = this.db.db.prepare("SELECT value FROM settings WHERE key = 'whisper_model'").get() as any
      const model = (modelRow?.value || 'base') as any
      const result = await this.whisper.inference(filePath, { ...options, model })

      const transcriptionId = uuid()
      this.db.db.prepare(`
        INSERT INTO transcriptions (id, item_id, file_path, content, language, duration, status)
        VALUES (?, ?, ?, ?, ?, ?, 'completed')
      `).run(
        transcriptionId, itemId || null, filePath,
        result.text || JSON.stringify(result), 'auto', 0,
      )

      this.queue.updateTaskProgress(taskId, 100)
      this.queue.updateTaskResult(taskId, { transcriptionId, text: result.text })

      // Auto-chain: whisper → AI
      if (this.pipeline.isAutoMode()) {
        const config = {
          provider: 'deepseek' as const,
          model: 'deepseek-chat',
          prompt: '请对以下文本进行总结，提取关键信息和关键词，用中文回复。',
        }
        const aiTask = this.queue.createTask('ai', { config, transcriptionId })
        this.processAIChain(aiTask.id, config, transcriptionId)
      }
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }

  private async processAIChain(taskId: string, config: any, transcriptionId: string) {
    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 10)
      const transcription = this.db.db.prepare('SELECT * FROM transcriptions WHERE id = ?').get(transcriptionId) as any
      if (!transcription) throw new Error('Transcription not found')
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
