import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../common/database/database.service'
import { encrypt, decrypt } from '../common/crypto/crypto.util'
import * as https from 'https'
import * as http from 'http'

export interface AIProviderModel {
  name: string
  role: 'default' | 'fallback'
}

export interface AIProvider {
  id: string
  name: string
  api_key: string
  base_url: string
  models: AIProviderModel[]
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

  /** 获取所有 provider (前端展示用，api_key 脱敏) */
  getProviders(): AIProvider[] {
    const rows = this.db.db.prepare(
      'SELECT * FROM ai_providers ORDER BY enabled DESC, priority ASC'
    ).all() as any[]
    return rows.map(r => ({
      ...r,
      api_key: maskKey(decrypt(r.api_key)),
      models: JSON.parse(r.models || '[]'),
    }))
  }

  /** 获取启用的 provider（内部调用用，api_key 解密） */
  private getEnabledProviders(): AIProvider[] {
    const rows = this.db.db.prepare(
      'SELECT * FROM ai_providers WHERE enabled = 1 ORDER BY priority ASC'
    ).all() as any[]
    return rows.map(r => ({ ...r, api_key: decrypt(r.api_key), models: JSON.parse(r.models || '[]') }))
  }

  /** 获取单个 provider */
  getProvider(id: string): AIProvider | undefined {
    const row = this.db.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as any
    if (!row) return undefined
    return { ...row, api_key: decrypt(row.api_key), models: JSON.parse(row.models || '[]') }
  }

  /** 创建或更新供应商（api_key 加密存储） */
  saveProvider(p: Omit<AIProvider, 'created_at'>) {
    const modelsJson = Array.isArray(p.models) ? JSON.stringify(p.models) : '[]'
    this.db.db.prepare(`
      INSERT OR REPLACE INTO ai_providers (id, name, api_key, base_url, models, priority, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, p.name, encrypt(p.api_key), p.base_url, modelsJson, p.priority, p.enabled ? 1 : 0)
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

  /** 按优先级依次尝试调用（支持 provider 内多模型回退） */
  async callLLM(config: AIConfig, inputText: string): Promise<{ text: string; provider: string; model: string }> {
    const providers = config.provider
      ? [this.getProvider(config.provider)].filter(Boolean) as AIProvider[]
      : this.getEnabledProviders()

    if (!providers.length) throw new Error('没有可用的 AI 供应商')

    const errors: string[] = []
    for (const p of providers) {
      const models = this.getProviderModels(p, config.model)
      if (!models.length) {
        errors.push(`${p.name}: 未配置模型`)
        continue
      }
      for (const modelName of models) {
        try {
          const text = await this.callProvider(p, { ...config, model: modelName }, inputText)
          return { text, provider: p.name, model: modelName }
        } catch (err: any) {
          errors.push(`${p.name}/${modelName}: ${err.message}`)
        }
      }
    }
    throw new Error(`所有尝试均失败:\n${errors.join('\n')}`)
  }

  /** 获取供应商的有序模型列表：default 在前，fallback 在后 */
  private getProviderModels(p: AIProvider, overrideModel?: string): string[] {
    if (overrideModel) return [overrideModel]
    const models = p.models || []
    if (!models.length) return []
    return [...models]
      .sort((a, b) => a.role === 'default' ? -1 : b.role === 'default' ? 1 : 0)
      .map(m => m.name)
  }

  /** 从 provider API 动态获取可用模型列表 */
  async fetchModelsFromApi(baseUrl: string, apiKey: string): Promise<string[]> {
    const base = (baseUrl || '').replace(/\/+$/, '')
    // 构造候选 URL：先试 baseUrl/models，再去掉末段路径再试 /models
    const candidates = [`${base}/models`]
    const lastSegment = base.split('/').pop() || ''
    if (/^v\d+$/i.test(lastSegment) || ['anthropic', 'api'].includes(lastSegment)) {
      const parent = base.split('/').slice(0, -1).join('/')
      candidates.push(`${parent}/models`)
    }
    // 去重
    const urls = [...new Set(candidates)]

    for (const url of urls) {
      try {
        const models = await this.fetchModelsFromUrl(url, apiKey)
        if (models.length > 0) return models
      } catch { /* try next URL */ }
    }
    // 全部失败：返回空数组而不是抛异常
    return []
  }

  private fetchModelsFromUrl(url: string, apiKey: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http
      const req = mod.get(url, { headers: { Authorization: `Bearer ${apiKey}` } }, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          try {
            const json = JSON.parse(data)
            const models = ((json.data || []) as any[]).map((m: any) => m.id).filter(Boolean).sort()
            resolve(models)
          } catch { reject(new Error('parse error')) }
        })
      })
      req.on('error', (err: Error) => reject(err))
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
    })
  }

  private async callProvider(p: AIProvider, config: AIConfig, inputText: string): Promise<string> {
    const model = config.model || p.models?.find(m => m.role === 'default')?.name || ''
    const prompt = (config.prompt || '').replace(/\{\{content\}\}/g, inputText)
    const isMinimax = p.name === 'minimax'
    const url = isMinimax
      ? `${p.base_url}/v1/text/chatcompletion_v2`
      : `${p.base_url}/chat/completions`

    const body = {
      model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
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

function maskKey(key: string): string {
  if (!key || key.length <= 8) return key
  return key.slice(0, 6) + '****' + key.slice(-4)
}
