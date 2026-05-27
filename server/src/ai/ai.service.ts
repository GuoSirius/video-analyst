import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../common/database/database.service'

export interface AIProvider {
  id: string
  name: string
  api_key: string
  base_url: string
  default_model: string
  priority: number
  enabled: number
  created_at: string
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
  constructor(private readonly db: DatabaseService) {}

  /** 获取所有 provider (按优先级排序，启用的排前面) */
  getProviders(): AIProvider[] {
    return this.db.db.prepare(
      'SELECT * FROM ai_providers ORDER BY enabled DESC, priority ASC'
    ).all() as AIProvider[]
  }

  /** 获取启用的 provider 列表（优先级顺序） */
  getEnabledProviders(): AIProvider[] {
    return this.db.db.prepare(
      'SELECT * FROM ai_providers WHERE enabled = 1 ORDER BY priority ASC'
    ).all() as AIProvider[]
  }

  /** 获取单个 provider */
  getProvider(id: string): AIProvider | undefined {
    return this.db.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as any
  }

  /** 创建或更新 provider */
  saveProvider(p: Omit<AIProvider, 'created_at'>) {
    this.db.db.prepare(`
      INSERT OR REPLACE INTO ai_providers (id, name, api_key, base_url, default_model, priority, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, p.name, p.api_key, p.base_url, p.default_model, p.priority, p.enabled ? 1 : 0)
  }

  /** 删除 provider */
  deleteProvider(id: string) {
    this.db.db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id)
  }

  /** 批量更新优先级 */
  setPriorities(ids: string[]) {
    const stmt = this.db.db.prepare('UPDATE ai_providers SET priority = ? WHERE id = ?')
    ids.forEach((id, i) => stmt.run(i + 1, id))
  }

  /** 按优先级依次尝试调用 */
  async callLLM(config: AIConfig, inputText: string): Promise<{ text: string; provider: string }> {
    const providers = config.provider
      ? [this.getProvider(config.provider)].filter(Boolean) as AIProvider[]
      : this.getEnabledProviders()

    if (!providers.length) throw new Error('没有可用的 AI 模型')

    const errors: string[] = []
    for (const p of providers) {
      try {
        const text = await this.callProvider(p, config, inputText)
        return { text, provider: p.name }
      } catch (err: any) {
        errors.push(`${p.name}: ${err.message}`)
      }
    }
    throw new Error(`所有模型调用失败:\n${errors.join('\n')}`)
  }

  private async callProvider(p: AIProvider, config: AIConfig, inputText: string): Promise<string> {
    const model = config.model || p.default_model
    const isMinimax = p.name === 'minimax'
    const url = isMinimax
      ? `${p.base_url}/v1/text/chatcompletion_v2`
      : `${p.base_url}/chat/completions`

    const body = {
      model,
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
        Authorization: `Bearer ${p.api_key}`,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`)
    }

    const data = await resp.json() as any
    return data.choices?.[0]?.message?.content || JSON.stringify(data)
  }
}
