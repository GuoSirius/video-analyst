import { Injectable } from '@nestjs/common'
import * as fs from 'fs'

@Injectable()
export class WhisperService {
  private baseUrl: string

  constructor() {
    this.baseUrl = process.env.MEMO_AI_BASE_URL || 'http://127.0.0.1:9588'
  }

  async loadModel(modelPath: string): Promise<any> {
    const formData = new FormData()
    formData.append('model', modelPath)

    const resp = await fetch(`${this.baseUrl}/load`, {
      method: 'POST',
      body: formData,
    })
    return resp.json()
  }

  async inference(
    filePath: string,
    options: { temperature?: number; temperature_inc?: number; response_format?: string } = {},
  ): Promise<any> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const fileBuffer = fs.readFileSync(filePath)
    const blob = new Blob([fileBuffer])

    const formData = new FormData()
    formData.append('file', blob, filePath.split('/').pop() || 'audio.wav')
    formData.append('temperature', String(options.temperature ?? 0.0))
    formData.append('temperature_inc', String(options.temperature_inc ?? 0.2))
    formData.append('response_format', options.response_format ?? 'json')

    const resp = await fetch(`${this.baseUrl}/inference`, {
      method: 'POST',
      body: formData,
    })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Whisper inference failed: ${resp.status} ${errText}`)
    }

    return resp.json()
  }

  getBaseUrl(): string {
    return this.baseUrl
  }
}
