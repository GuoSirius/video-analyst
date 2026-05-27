import { Injectable } from '@nestjs/common'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const execAsync = promisify(exec)

export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large'

@Injectable()
export class WhisperService {
  private baseUrl: string

  constructor() {
    this.baseUrl = process.env.MEMO_AI_BASE_URL || ''
  }

  isApiMode(): boolean {
    return !!this.baseUrl
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

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
    // Check local CLI
    try {
      const { execSync } = require('child_process')
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

  async inference(
    filePath: string,
    options: { temperature?: number; model?: WhisperModel; language?: string } = {},
  ): Promise<{ text: string }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    if (this.isApiMode()) {
      return this.apiInference(filePath, options)
    }
    return this.localInference(filePath, options)
  }

  private async apiInference(
    filePath: string,
    options: { temperature?: number },
  ): Promise<{ text: string }> {
    const fileBuffer = fs.readFileSync(filePath)
    const blob = new Blob([fileBuffer])

    const formData = new FormData()
    formData.append('file', blob, filePath.split('/').pop() || 'audio.wav')
    formData.append('temperature', String(options.temperature ?? 0.0))
    formData.append('temperature_inc', '0.2')
    formData.append('response_format', 'json')

    const resp = await fetch(`${this.baseUrl}/inference`, {
      method: 'POST',
      body: formData,
    })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Whisper API error (${resp.status}): ${errText}`)
    }

    const data = await resp.json() as any
    return { text: data.text || JSON.stringify(data) }
  }

  private async localInference(
    filePath: string,
    options: { model?: WhisperModel; language?: string } = {},
  ): Promise<{ text: string }> {
    const model = options.model || 'base'
    const tmpDir = path.join(os.tmpdir(), 'video-analyst-whisper')
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true })
    }

    const outputFile = path.join(tmpDir, `${Date.now()}`)
    const langArg = options.language ? `--language ${options.language}` : ''

    const cmd = `whisper "${filePath}" --model ${model} --output_format txt --output_dir "${tmpDir}" ${langArg} 2>&1`

    try {
      await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 })
    } catch (err: any) {
      // Whisper sometimes exits non-zero but still produces output
      if (err.stdout?.includes('error') || err.stderr?.includes('error')) {
        throw new Error(`Whisper CLI error: ${err.stderr || err.stdout || err.message}`)
      }
    }

    // Read the generated txt file
    const basename = path.basename(filePath, path.extname(filePath))
    const txtPath = path.join(tmpDir, `${basename}.txt`)
    if (fs.existsSync(txtPath)) {
      const text = fs.readFileSync(txtPath, 'utf-8').trim()
      return { text }
    }

    // Try find any txt file in tmpDir
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.txt'))
    if (files.length > 0) {
      const text = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8').trim()
      return { text }
    }

    throw new Error('Whisper CLI completed but no output text file found')
  }
}
