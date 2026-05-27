import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../common/database/database.service'

export interface ProviderInfo {
  name: string
  configured: boolean
}

export interface AIConfig {
  provider?: string
  model?: string
  prompt: string
  temperature?: number
  maxTokens?: number
}

@Injectable()
export class AIService {
  private configs: Record<string, { apiKey: string; baseUrl: string }>

  constructor(private readonly db: DatabaseService) {
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

  /** 获取按优先级排序的 provider 列表 */
  getProviders(): ProviderInfo[] {
    const priority = this.getPriority()
    const ordered = [...priority, ...Object.keys(this.configs).filter(k => !priority.includes(k))]
    return ordered.map(name => ({
      name,
      configured: !!this.configs[name]?.apiKey,
    }))
  }

  /** 获取优先级列表 */
  getPriority(): string[] {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key = 'ai_priority'").get() as any
    if (!row) return ['deepseek', 'minimax']
    try { return JSON.parse(row.value) } catch { return ['deepseek', 'minimax'] }
  }

  /** 设置优先级 */
  setPriority(providers: string[]) {
    this.db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_priority', ?)").run(JSON.stringify(providers))
  }

  /** 按优先级依次尝试，失败则尝试下一个 */
  async callLLM(config: AIConfig, inputText: string): Promise<{ text: string; provider: string }> {
    const providers = config.provider ? [config.provider] : this.getPriority()
    const errors: string[] = []

    for (const provider of providers) {
      const cfg = this.configs[provider]
      if (!cfg?.apiKey) {
        errors.push(`${provider}: 未配置 API Key`)
        continue
      }
      try {
        const text = await this.callOneProvider(provider, config, inputText)
        return { text, provider }
      } catch (err: any) {
        errors.push(`${provider}: ${err.message}`)
      }
    }

    throw new Error(`所有模型调用失败:\n${errors.join('\n')}`)
  }

  private async callOneProvider(
    provider: string,
    config: AIConfig,
    inputText: string,
  ): Promise<string> {
    const cfg = this.configs[provider]
    const isMinimax = provider === 'minimax'
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
      throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`)
    }

    const data = await resp.json() as any
    if (isMinimax) {
      return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || JSON.stringify(data)
    }
    return data.choices?.[0]?.message?.content || JSON.stringify(data)
  }
}
