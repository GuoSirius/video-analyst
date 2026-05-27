import { Injectable } from '@nestjs/common'
import { exec, execSync } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const execAsync = promisify(exec)

export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large'

export interface WhisperOptions {
  model?: WhisperModel
  temperature?: number
  temperature_inc?: number
  response_format?: 'json' | 'text' | 'srt' | 'vtt'
}

@Injectable()
export class WhisperService {
  private baseUrl: string
  private loadedModel: string | null = null

  constructor() {
    this.baseUrl = process.env.MEMO_AI_BASE_URL || ''
  }

  isApiMode(): boolean { return !!this.baseUrl }
  getBaseUrl(): string { return this.baseUrl }

  async getStatus(): Promise<{ mode: 'api' | 'local' | 'unavailable'; detail: string }> {
    if (this.baseUrl) {
      try {
        const resp = await fetch(`${this.baseUrl}/inference`, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
        if (resp.ok || resp.status === 405) {
          return { mode: 'api', detail: `远端服务: ${this.baseUrl}` }
        }
        return { mode: 'api', detail: `远端服务异常: HTTP ${resp.status}` }
      } catch {
        return { mode: 'api', detail: `远端服务不可达: ${this.baseUrl}` }
      }
    }
    try {
      const out = execSync('whisper --help 2>&1', { timeout: 5000, encoding: 'utf-8' })
      if (out.includes('usage') || out.includes('--model')) {
        return { mode: 'local', detail: '本地 Whisper CLI' }
      }
      return { mode: 'unavailable', detail: 'whisper CLI 未正确安装' }
    } catch (err: any) {
      const msg = err.stderr || err.stdout || err.message || ''
      if (msg.includes('not found') || msg.includes('not recognized')) {
        return { mode: 'unavailable', detail: 'whisper CLI 未安装，请执行: pip install openai-whisper' }
      }
      return { mode: 'unavailable', detail: `whisper CLI 异常: ${msg.slice(0, 100)}` }
    }
  }

  getAvailableModels(): WhisperModel[] {
    return ['tiny', 'base', 'small', 'medium', 'large']
  }

  /** 加载模型（仅 API 模式生效，加载后缓存） */
  async loadModel(model: WhisperModel): Promise<void> {
    if (!this.isApiMode()) return // CLI 模式无需加载
    if (this.loadedModel === model) return // 已加载相同模型

    // 尝试加载，不阻塞 inference（服务可能已预加载）
    try {
      const formData = new FormData()
      formData.append('model', model)
      await fetch(`${this.baseUrl}/load`, { method: 'POST', body: formData, signal: AbortSignal.timeout(10000) })
      this.loadedModel = model
    } catch {
      // /load 可能不支持或超时，记录但不报错
    }
  }

  /** 主推理接口：API 模式自动加载模型，CLI 模式直接用模型参数 */
  async inference(filePath: string, options: WhisperOptions = {}): Promise<{ text: string }> {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)

    if (this.isApiMode()) {
      // 自动加载模型（内部判断缓存）
      await this.loadModel(options.model || 'base')
      return this.apiInference(filePath, options)
    }
    return this.localInference(filePath, options)
  }

  private async apiInference(filePath: string, options: WhisperOptions): Promise<{ text: string }> {
    const fileBuffer = fs.readFileSync(filePath)
    const blob = new Blob([fileBuffer])

    const formData = new FormData()
    formData.append('file', blob, filePath.split(/[\\/]/).pop() || 'audio.wav')
    formData.append('temperature', String(options.temperature ?? 0.0))
    formData.append('temperature_inc', String(options.temperature_inc ?? 0.2))
    formData.append('response_format', options.response_format ?? 'json')

    const resp = await fetch(`${this.baseUrl}/inference`, { method: 'POST', body: formData })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Whisper API error (${resp.status}): ${errText}`)
    }

    const data = await resp.json() as any
    return { text: data.text || JSON.stringify(data) }
  }

  private async localInference(filePath: string, options: WhisperOptions): Promise<{ text: string }> {
    const model = options.model || 'base'
    const tmpDir = path.join(os.tmpdir(), 'video-analyst-whisper')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

    const fmt = options.response_format === 'srt' ? 'srt' : options.response_format === 'vtt' ? 'vtt' : 'txt'
    const cmd = `whisper "${filePath}" --model ${model} --output_format ${fmt} --output_dir "${tmpDir}" 2>&1`

    try {
      await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 })
    } catch (err: any) {
      if (err.stdout?.includes('error') || err.stderr?.includes('error')) {
        throw new Error(`Whisper CLI error: ${err.stderr || err.stdout || err.message}`)
      }
    }

    const basename = path.basename(filePath, path.extname(filePath))
    const ext = fmt === 'txt' ? 'txt' : fmt
    const outPath = path.join(tmpDir, `${basename}.${ext}`)
    if (fs.existsSync(outPath)) {
      return { text: fs.readFileSync(outPath, 'utf-8').trim() }
    }

    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(basename))
    if (files.length > 0) {
      return { text: fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8').trim() }
    }

    throw new Error('Whisper CLI completed but no output text file found')
  }
}
