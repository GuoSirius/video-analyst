import { Controller, Post, Get, Delete, Param, Body, Sse, UploadedFiles, UseInterceptors } from '@nestjs/common'
import { Observable } from 'rxjs'
import { FilesInterceptor } from '@nestjs/platform-express'
import { TranscoderService } from './transcoder.service'
import { WhisperService } from '../whisper/whisper.service'
import { QueueService } from '../common/queue/queue.service'
import { SseService } from '../common/sse/sse.service'
import { PipelineService } from '../common/pipeline/pipeline.service'
import { DatabaseService } from '../common/database/database.service'
import * as path from 'path'
import * as fs from 'fs'
import { v4 as uuid } from 'uuid'
import { diskStorage } from 'multer'

const mediaDir = path.resolve(process.cwd(), '..', 'data', 'media')
const outputDir = path.resolve(process.cwd(), '..', 'data', 'transcoded')

@Controller('api/transcoder')
export class TranscoderController {
  constructor(
    private readonly transcoder: TranscoderService,
    private readonly whisper: WhisperService,
    private readonly queue: QueueService,
    private readonly sse: SseService,
    private readonly pipeline: PipelineService,
    private readonly db: DatabaseService,
  ) {}

  @Get('ffmpeg-check')
  async checkFfmpeg() {
    return this.transcoder.checkFfmpeg()
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 20, {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })
        cb(null, mediaDir)
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname)
        cb(null, `${uuid()}${ext}`)
      },
    }),
  }))
  async uploadFiles(@UploadedFiles() files: Express.Multer.File[]) {
    const filenames = files.map(f => f.filename)
    return { files: filenames, dir: mediaDir }
  }

  @Post('convert')
  async startConvert(@Body() body: { files: string[]; fileNames?: string[] }) {
    const filesToConvert = body.files.map(f => path.resolve(mediaDir, f))

    if (!filesToConvert.length) {
      return { error: 'No files to convert' }
    }

    const tasks: { taskId: string; file: string }[] = []
    for (let i = 0; i < filesToConvert.length; i++) {
      const fp = filesToConvert[i]
      if (!fs.existsSync(fp)) continue
      const displayName = body.fileNames?.[i] || path.basename(fp)
      const task = this.queue.createTask('transcode', {
        file: fp,
        outputDir,
        source: 'upload',
        fileName: displayName,
      })
      tasks.push({ taskId: task.id, file: fp })
      this.processTranscodeTask(task.id, fp, outputDir)
    }

    return { tasks }
  }

  @Get('tasks')
  getTasks(@Body('source') source?: string) {
    return this.queue.getTasksByType('transcode')
  }

  @Post('tasks/:id/start')
  startTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'pending' && task.status !== 'paused') {
      return { error: `Cannot start task in ${task.status} status` }
    }
    const { file, outputDir } = task.payload
    this.processTranscodeTask(id, file, outputDir)
    return { ok: true }
  }

  @Post('tasks/:id/pause')
  pauseTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'running') return { error: 'Task is not running' }
    this.queue.pauseTask(id)
    return { ok: true }
  }

  @Post('tasks/:id/stop')
  stopTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'running' && task.status !== 'paused') {
      return { error: 'Task is not running or paused' }
    }
    this.queue.cancelTask(id)
    return { ok: true }
  }

  @Post('tasks/:id/retry')
  retryTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status !== 'failed') return { error: 'Only failed tasks can be retried' }
    this.queue.retryTask(id)
    const { file, outputDir } = task.payload
    this.processTranscodeTask(id, file, outputDir)
    return { ok: true }
  }

  @Post('tasks/:id/rerun')
  reRunTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    this.queue.reRunTask(id)
    const { file, outputDir } = task.payload
    this.processTranscodeTask(id, file, outputDir)
    return { ok: true }
  }

  @Delete('tasks/:id')
  deleteTask(@Param('id') id: string) {
    const task = this.queue.getTask(id)
    if (!task) return { error: 'Task not found' }
    if (task.status === 'running') return { error: 'Cannot delete a running task' }
    this.queue.deleteTask(id)
    return { ok: true }
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.sse.getTaskStream()
  }

  private async processTranscodeTask(taskId: string, inputPath: string, outDir: string) {
    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 0)

      const outputPath = await this.transcoder.transcode(inputPath, outDir, (pct) => {
        this.queue.updateTaskProgress(taskId, pct)
      })

      this.queue.updateTaskResult(taskId, { outputPath })

      if (this.pipeline.isAutoMode() && fs.existsSync(outputPath)) {
        const whisperTask = this.queue.createTask('whisper', { filePath: outputPath })
        this.processWhisperChain(whisperTask.id, outputPath)
      }
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }

  private async processWhisperChain(taskId: string, filePath: string) {
    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 30)
      const result = await this.whisper.inference(filePath)
      const transcriptionId = uuid()
      this.db.db.prepare(`
        INSERT INTO transcriptions (id, file_path, content, language, duration, status)
        VALUES (?, ?, ?, 'auto', 0, 'completed')
      `).run(transcriptionId, filePath, result.text || JSON.stringify(result))
      this.queue.updateTaskProgress(taskId, 100)
      this.queue.updateTaskResult(taskId, { transcriptionId, text: result.text })
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }
}
