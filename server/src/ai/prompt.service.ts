import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../common/database/database.service'
import { v4 as uuid } from 'uuid'

export interface Prompt {
  id: string
  name: string
  content: string
  is_default: number
  created_at: string
  updated_at: string
}

@Injectable()
export class PromptService {
  constructor(private readonly db: DatabaseService) {}

  getAll(): Prompt[] {
    return this.db.db.prepare('SELECT * FROM ai_prompts ORDER BY is_default DESC, created_at ASC').all() as Prompt[]
  }

  getDefault(): Prompt | undefined {
    return this.db.db.prepare('SELECT * FROM ai_prompts WHERE is_default = 1 LIMIT 1').get() as any
  }

  save(p: { id?: string; name: string; content: string; is_default?: boolean }) {
    const id = p.id || uuid()
    const isDefault = p.is_default ? 1 : 0
    if (isDefault) {
      this.db.db.prepare('UPDATE ai_prompts SET is_default = 0').run()
    }
    this.db.db.prepare(`
      INSERT OR REPLACE INTO ai_prompts (id, name, content, is_default, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(id, p.name, p.content, isDefault)
    return this.getAll()
  }

  delete(id: string) {
    this.db.db.prepare('DELETE FROM ai_prompts WHERE id = ?').run(id)
    return this.getAll()
  }
}
