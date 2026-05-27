import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'

@Injectable()
export class PipelineService {
  constructor(private readonly db: DatabaseService) {}

  isAutoMode(): boolean {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key = 'pipeline_auto'").get() as any
    return row?.value === 'true'
  }

  setAutoMode(enabled: boolean) {
    this.db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_auto', ?)").run(String(enabled))
  }

  getStatus() {
    return { autoMode: this.isAutoMode() }
  }
}
