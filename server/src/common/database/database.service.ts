import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'
import { encrypt } from '../crypto/crypto.util'

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
    this.migrate()
    this.seedDefaults()
  }

  /** Add columns added after initial release to existing databases */
  private migrate() {
    try { this.db.exec(`ALTER TABLE tasks ADD COLUMN started_at TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE crawl_items ADD COLUMN detail_url TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE crawl_items ADD COLUMN download_status TEXT DEFAULT 'pending'`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE crawl_items ADD COLUMN download_tasks TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE crawl_items ADD COLUMN media_fields TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE download_queue ADD COLUMN download_method TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE download_queue ADD COLUMN yt_dlp_options TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE download_queue ADD COLUMN reimport_pending INTEGER DEFAULT 0`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE download_queue ADD COLUMN reimport_opts TEXT`) } catch { /* column exists */ }
    // Fix legacy default: download_status should be NULL (not imported) instead of 'pending'
    try { this.db.exec(`UPDATE crawl_items SET download_status = NULL WHERE download_status = 'pending'`) } catch { /* ignore */ }
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
        started_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS crawl_items (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        source_url TEXT,
        detail_url TEXT,
        title TEXT,
        media_url TEXT,
        media_type TEXT,
        media_source TEXT,
        status TEXT DEFAULT 'pending',
        download_status TEXT DEFAULT NULL,
        download_tasks TEXT,
        media_fields TEXT,
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

      CREATE TABLE IF NOT EXISTS ai_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        api_key TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL DEFAULT '',
        default_model TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ai_prompts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_crawl_items_task ON crawl_items(task_id);
      CREATE INDEX IF NOT EXISTS idx_transcriptions_item ON transcriptions(item_id);
      CREATE INDEX IF NOT EXISTS idx_ai_results_transcription ON ai_results(transcription_id);

      CREATE TABLE IF NOT EXISTS download_queue (
        id TEXT PRIMARY KEY,
        item_id TEXT REFERENCES crawl_items(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        filename TEXT,
        file_type TEXT,
        field_name TEXT,
        status TEXT DEFAULT 'pending',
        file_path TEXT,
        error TEXT,
        progress INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_download_queue_item ON download_queue(item_id);
      CREATE INDEX IF NOT EXISTS idx_download_queue_status ON download_queue(status);
    `)
  }

  /** 从 .env 导入默认模型（INSERT OR IGNORE，仅首次初始化时写入） */
  private seedDefaults() {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO ai_providers (id, name, api_key, base_url, default_model, priority, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `)
    stmt.run('minimax', 'minimax',
      encrypt(process.env.MINIMAX_API_KEY || ''),
      process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
      'MiniMax-M2.7', 1)
    stmt.run('deepseek', 'deepseek',
      encrypt(process.env.DEEPSEEK_API_KEY || ''),
      process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      'deepseek-v4-flash', 2)

    const promptStmt = this.db.prepare(`
      INSERT OR IGNORE INTO ai_prompts (id, name, content, is_default)
      VALUES (?, ?, ?, ?)
    `)
    promptStmt.run('default', '通用总结', '请对以下文本进行总结，提取关键信息和关键词，用中文回复。\n\n{{content}}', 1)
    promptStmt.run('keywords', '提取关键词', '请从以下文本中提取最重要的关键词和短语，用中文列出。\n\n{{content}}', 0)
    promptStmt.run('summary', '详细摘要', '请对以下文本进行详细摘要，保留主要观点和结论，用中文回复。\n\n{{content}}', 0)

    // Fix legacy data: keep only 'default' as the default prompt
    this.db.prepare("UPDATE ai_prompts SET is_default = 0 WHERE id != 'default' AND is_default = 1").run()
  }
}
