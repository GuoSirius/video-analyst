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
    this.migrate()
    this.initTables()
    this.seedDefaults()
  }

  /** 向后兼容：清理已移除模块遗留的表（转码 / 识别 / AI / 下载 / 供应商 / 提示词） */
  private migrate() {
    for (const table of ['transcriptions', 'ai_results', 'ai_providers', 'ai_prompts', 'download_queue']) {
      try { this.db.exec(`DROP TABLE IF EXISTS ${table}`) } catch { /* ignore */ }
    }
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
        extra_data TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_crawl_items_task ON crawl_items(task_id);
    `)
  }

  /** 种子示例：一个通用的网页采集任务（纯爬虫，无下载 / 转码 / 识别 / AI 配置） */
  private seedDefaults() {
    // 种子示例任务：普诺赛官网宣传册采集（英文站）
    const taskStmt = this.db.prepare(`
      INSERT OR IGNORE INTO tasks (id, type, status, payload, result, error, progress, retries, max_retries, started_at, created_at, updated_at)
      VALUES (?, ?, 'completed', ?, ?, NULL, 100, 0, 3, ?, ?, ?)
    `)
    taskStmt.run(
      '69a2e781-16af-4b7a-9ca3-f3e5d41b48b6',
      'crawl',
      JSON.stringify({ name: '普诺赛英文站宣传册采集', url: 'https://www.procellsystem.com/resources/brochure', mode: 'list', rules: [{ name: 'title', selector: '.text-left.px-4.d-block', attr: '', regex: '' }, { name: 'pdfUrl', selector: 'a.download-list', attr: 'href', regex: '' }], itemSelector: '.bg-white .row.mt-3 .col-12.col-lg-4.mb-3', paginationMode: 'none', autoStart: false, errorMode: 'standard', titleField: { fields: ['title'], mode: 'first' }, mediaUrlField: { fields: ['pdfUrl'], mode: 'all' } }),
      JSON.stringify({ itemsFound: 13 }),
      '2026-06-05 11:41:47', '2026-06-05 11:41:47', '2026-06-08 09:24:22',
    )
  }
}
