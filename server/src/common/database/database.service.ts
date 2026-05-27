import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  db!: Database.Database
  private dbPath: string

  constructor() {
    const dataDir = path.resolve(process.cwd(), '..', 'data')
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    this.dbPath = path.join(dataDir, 'video-analyst.db')
  }

  onModuleInit() {
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.initTables()
  }

  onModuleDestroy() {
    this.db?.close()
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL,
        result TEXT,
        error TEXT,
        progress INTEGER DEFAULT 0,
        retries INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS crawl_items (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        source_url TEXT,
        title TEXT,
        media_url TEXT,
        media_type TEXT,
        media_source TEXT,
        status TEXT DEFAULT 'pending',
        extra_data TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS transcriptions (
        id TEXT PRIMARY KEY,
        item_id TEXT REFERENCES crawl_items(id) ON DELETE CASCADE,
        file_path TEXT,
        content TEXT,
        language TEXT,
        duration REAL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ai_results (
        id TEXT PRIMARY KEY,
        transcription_id TEXT REFERENCES transcriptions(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        prompt TEXT,
        result TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO settings (key, value) VALUES ('pipeline_auto', 'true');

      CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_crawl_items_task ON crawl_items(task_id);
      CREATE INDEX IF NOT EXISTS idx_transcriptions_item ON transcriptions(item_id);
      CREATE INDEX IF NOT EXISTS idx_ai_results_transcription ON ai_results(transcription_id);
    `)
  }
}
