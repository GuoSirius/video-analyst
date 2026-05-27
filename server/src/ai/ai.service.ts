import { Injectable } from '@nestjs/common'

export interface AIConfig {
  provider: 'minimax' | 'deepseek'
  model: string
  prompt: string
  temperature?: number
  maxTokens?: number
}

@Injectable()
export class AIService {
  private configs: Record<string, { apiKey: string; baseUrl: string }>

  constructor() {
    this.configs = {
      minimax: {
        apiKey: process.env.MINIMAX_API_KEY || '',
        baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat',
      },
      deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      },
    }
  }

  async callLLM(config: AIConfig, inputText: string): Promise<string> {
    const cfg = this.configs[config.provider]
    if (!cfg.apiKey) {
      throw new Error(`API key not configured for ${config.provider}`)
    }

    const isMinimax = config.provider === 'minimax'
    const url = isMinimax
      ? `${cfg.baseUrl}/v1/text/chatcompletion_v2`
      : `${cfg.baseUrl}/chat/completions`

    const body = isMinimax
      ? {
          model: config.model || 'MiniMax-M1',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: `${config.prompt}\n\nInput text:\n${inputText}` },
          ],
          temperature: config.temperature ?? 0.7,
          max_tokens: config.maxTokens ?? 4096,
        }
      : {
          model: config.model || 'deepseek-chat',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: `${config.prompt}\n\nInput text:\n${inputText}` },
          ],
          temperature: config.temperature ?? 0.7,
          max_tokens: config.maxTokens ?? 4096,
        }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`${config.provider} API error (${resp.status}): ${errText}`)
    }

    const data = await resp.json() as any

    if (isMinimax) {
      return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || JSON.stringify(data)
    } else {
      return data.choices?.[0]?.message?.content || JSON.stringify(data)
    }
  }

  getProviders() {
    return Object.entries(this.configs).map(([key, cfg]) => ({
      name: key,
      configured: !!cfg.apiKey,
    }))
  }
}
