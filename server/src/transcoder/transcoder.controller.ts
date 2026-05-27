import { Controller, Post, Get, Delete, Param, Body, Query, Sse, UploadedFiles, UseInterceptors } from '@nestjs/common'
import { Observable } from 'rxjs'
import { FilesInterceptor } from '@nestjs/platform-express'
import { TranscoderService } from './transcoder.service'
import { QueueService } from '../common/queue/queue.service'
import { SseService } from '../common/sse/sse.service'
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
    private readonly queue: QueueService,
    private readonly sse: SseService,
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
  async startConvert(@Body() body: { files?: string[]; dir?: string; itemIds?: string[] }) {
    let filesToConvert: string[] = []

    if (body.files?.length) {
      filesToConvert = body.files.map(f => path.resolve(mediaDir, f))
    } else if (body.dir) {
      filesToConvert = this.transcoder.scanDirectory(body.dir)
    }

    if (!filesToConvert.length) {
      return { error: 'No files to convert' }
    }

    const tasks: { taskId: string; file: string }[] = []
    for (const file of filesToConvert) {
      if (!fs.existsSync(file)) continue
      const task = this.queue.createTask('transcode', { file, outputDir })
      tasks.push({ taskId: task.id, file })
      this.processTranscodeTask(task.id, file, outputDir)
    }

    return { tasks }
  }

  @Get('tasks')
  getTasks() {
    return this.queue.getTasksByType('transcode')
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

  private async processTranscodeTask(taskId: string, inputPath: string, outDir: string) {
    try {
      this.queue.updateTaskStatus(taskId, 'running')
      this.queue.updateTaskProgress(taskId, 0)

      const outputPath = await this.transcoder.transcode(inputPath, outDir, (pct) => {
        this.queue.updateTaskProgress(taskId, pct)
      })

      this.queue.updateTaskResult(taskId, { outputPath })
    } catch (err: any) {
      this.queue.updateTaskError(taskId, err.message)
    }
  }
}
