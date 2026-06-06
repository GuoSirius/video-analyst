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

  /** 向后兼容：为旧版本数据库补充缺失的列（新库已在 initTables 中直接包含） */
  private migrate() {
    // --- tasks 表补列（旧库可能缺少） ---
    try { this.db.exec(`ALTER TABLE tasks ADD COLUMN started_at TEXT`) } catch { /* column exists */ }
    // --- crawl_items 表补列（旧库可能缺少） ---
    try { this.db.exec(`ALTER TABLE crawl_items ADD COLUMN detail_url TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE crawl_items ADD COLUMN download_status TEXT DEFAULT 'pending'`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE crawl_items ADD COLUMN download_tasks TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE crawl_items ADD COLUMN media_fields TEXT`) } catch { /* column exists */ }
    // --- download_queue 表补列（旧库可能缺少） ---
    try { this.db.exec(`ALTER TABLE download_queue ADD COLUMN download_method TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE download_queue ADD COLUMN yt_dlp_options TEXT`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE download_queue ADD COLUMN reimport_pending INTEGER DEFAULT 0`) } catch { /* column exists */ }
    try { this.db.exec(`ALTER TABLE download_queue ADD COLUMN reimport_opts TEXT`) } catch { /* column exists */ }
    // --- ai_providers 表补列（多模型支持） ---
    try { this.db.exec(`ALTER TABLE ai_providers ADD COLUMN models TEXT NOT NULL DEFAULT '[]'`) } catch { /* column exists */ }
    // 一次性迁移：将旧 default_model 同步到 models JSON（仅当 models 为空时）
    try {
      const rows = this.db.prepare(
        `SELECT id, default_model FROM ai_providers WHERE models = '[]' AND default_model != ''`
      ).all() as any[]
      const stmt = this.db.prepare(`UPDATE ai_providers SET models = ? WHERE id = ?`)
      for (const row of rows) {
        stmt.run(JSON.stringify([{ name: row.default_model, role: 'default' }]), row.id)
      }
    } catch { /* ignore */ }
    // 修正旧数据的默认值：download_status 应为 NULL（未导入），而非 'pending'
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
        models TEXT NOT NULL DEFAULT '[]',
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
        download_method TEXT,
        yt_dlp_options TEXT,
        reimport_pending INTEGER DEFAULT 0,
        reimport_opts TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_download_queue_item ON download_queue(item_id);
      CREATE INDEX IF NOT EXISTS idx_download_queue_status ON download_queue(status);
    `)
  }

  /** 从 .env 导入默认供应商（INSERT OR IGNORE，仅首次初始化时写入） */
  private seedDefaults() {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO ai_providers (id, name, api_key, base_url, models, priority, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `)
    stmt.run('agnes', 'Agnes',
      encrypt(process.env.AGNES_API_KEY || ''),
      process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1',
      JSON.stringify([{ name: 'agnes-2.0-flash', role: 'default' }]), 0)
    stmt.run('minimax', 'minimax',
      encrypt(process.env.MINIMAX_API_KEY || ''),
      process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
      JSON.stringify([{ name: 'MiniMax-M2.7', role: 'default' }]), 1)
    stmt.run('deepseek', 'deepseek',
      encrypt(process.env.DEEPSEEK_API_KEY || ''),
      process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      JSON.stringify([{ name: 'deepseek-v4-flash', role: 'default' }]), 2)

    const promptStmt = this.db.prepare(`
      INSERT OR IGNORE INTO ai_prompts (id, name, content, is_default)
      VALUES (?, ?, ?, ?)
    `)
    promptStmt.run('default', '通用总结', '请对以下文本进行总结，提取关键信息和关键词，用中文回复。\n\n{{content}}', 1)
    promptStmt.run('keywords', '提取关键词', '请从以下文本中提取最重要的关键词和短语，用中文列出。\n\n{{content}}', 0)
    promptStmt.run('summary', '详细摘要', '请对以下文本进行详细摘要，保留主要观点和结论，用中文回复。\n\n{{content}}', 0)

    // Fix legacy data: keep only 'default' as the default prompt
    this.db.prepare("UPDATE ai_prompts SET is_default = 0 WHERE id != 'default' AND is_default = 1").run()

    // 种子示例任务：普诺赛官网爬虫采集（英文站 ×2 + 中文站 ×1）
    const taskStmt = this.db.prepare(`
      INSERT OR IGNORE INTO tasks (id, type, status, payload, result, error, progress, retries, max_retries, started_at, created_at, updated_at)
      VALUES (?, ?, 'completed', ?, ?, NULL, 100, 0, 3, ?, ?, ?)
    `)
    taskStmt.run(
      '69a2e781-16af-4b7a-9ca3-f3e5d41b48b6',
      'crawl',
      JSON.stringify({ name: '普诺赛英文站宣传册采集', url: 'https://www.procellsystem.com/resources/brochure', mode: 'list', rules: [{ name: 'title', selector: '.text-left.px-4.d-block', attr: '', regex: '' }, { name: 'pdfUrl', selector: 'a.download-list', attr: 'href', regex: '' }], itemSelector: '.bg-white .row.mt-3 .col-12.col-lg-4.mb-3', paginationMode: 'none', autoStart: false, errorMode: 'standard', titleField: { fields: ['title'], mode: 'first' }, mediaUrlField: { fields: ['pdfUrl'], mode: 'all' } }),
      JSON.stringify({ itemsFound: 100 }),
      '2026-06-05 11:41:47', '2026-06-05 11:41:47', '2026-06-05 13:59:28',
    )
    taskStmt.run(
      '6ff7f96b-fe08-435c-8705-69e102e58759',
      'crawl',
      JSON.stringify({ name: '普诺赛英文站视频采集', url: 'https://www.procellsystem.com/resources/videos', mode: 'list', rules: [{ name: 'id', selector: '', attr: 'href', regex: '-(\\d+)(?:$|\\?|#)' }, { name: 'title', selector: '.my-2.two-lines', attr: '', regex: '' }, { name: 'link', selector: '', attr: 'href', regex: '' }], itemSelector: '.bg-white .row.mb-3 > a', paginationMode: 'page', maxPages: 0, urlPattern: 'https://www.procellsystem.com/resources/videos?page={page}', pageStart: 1, detailRules: [{ name: 'videoIframeUrl', selector: '.video-box iframe', attr: 'src', regex: '' }, { name: 'tencentVid', selector: '.video-box iframe', attr: 'src', regex: '(?:^https?:\\/\\/v\\.qq\\.com.*?)(?:\\?|&)vid=([^&#]+)(?:$|&|#)' }, { name: 'bilibiliBvid', selector: '.video-box iframe', attr: 'src', regex: '(?:^https?:\\/\\/player\\.bilibili\\.com.*?)(?:\\?|&)bvid=([^&#]+)(?:$|&|#)' }, { name: 'youtubeId', selector: '.video-box iframe', attr: 'src', regex: '(?:^https?:\\/\\/www\\.youtube\\.com.*?)\\/([^/\\?#]+)(?:$|\\?|#)' }, { name: 'youkuUrl', selector: '.video-box iframe', attr: 'src', regex: '^https?:\\/\\/player\\.youku\\.com.*' }], errorMode: 'standard', titleField: { fields: ['title'], mode: 'first' }, detailLinkField: { fields: ['link'], mode: 'first' }, mediaUrlField: { fields: ['tencentVid', 'bilibiliBvid', 'youtubeId', 'youkuUrl'], mode: 'all' }, idField: { fields: ['id'], mode: 'first' }, urlTransforms: [{ fieldName: 'tencentVid', urlTemplate: 'https://v.qq.com/x/page/{tencentVid}.html', downloadMethod: 'yt-dlp' }, { fieldName: 'bilibiliBvid', urlTemplate: 'https://www.bilibili.com/video/{bilibiliBvid}/', downloadMethod: 'yt-dlp' }, { fieldName: 'youtubeId', urlTemplate: 'https://youtu.be/{youtubeId}', downloadMethod: 'yt-dlp', ytDlpOptions: { cookiesFromBrowser: 'chrome' } }, { fieldName: 'youkuUrl', urlTemplate: '', downloadMethod: 'yt-dlp' }] }),
      JSON.stringify({ itemsFound: 50 }),
      '2026-06-05 11:39:35', '2026-06-05 11:39:35', '2026-06-05 13:59:28',
    )
    taskStmt.run(
      '2b2b277a-1b66-4914-8ded-cc6468fd5bae',
      'crawl',
      JSON.stringify({ name: '普诺赛中文站视频采集', url: 'https://www.procell.com.cn/resource/video', mode: 'list', rules: [{ name: 'id', selector: 'a.px-2', attr: 'href', regex: '\\/(\\d+)(?:$|\\?|#)' }, { name: 'title', selector: 'a.px-2', attr: '', regex: '' }, { name: 'link', selector: 'a.px-2', attr: 'href', regex: '' }, { name: 'thumbnail', selector: '.video-img>img:nth-child(2)', attr: 'src', regex: '' }], itemSelector: '.col-6.col-md-4.mb-4>.huodong-list', paginationMode: 'page', maxPages: 0, urlPattern: 'https://www.procell.com.cn/resource/video?page={page}', pageStart: 1, detailRules: [{ name: 'videoIframeUrl', selector: '.vedio-content>iframe', attr: 'src', regex: '' }, { name: 'tencentVid', selector: '.vedio-content>iframe', attr: 'src', regex: '(?:^https?:\\/\\/v\\.qq\\.com.*?)(?:\\?|&)vid=([^&#]+)(?:$|&|#)' }, { name: 'bilibiliBvid', selector: '.vedio-content>iframe', attr: 'src', regex: '(?:^https?:\\/\\/player\\.bilibili\\.com.*?)(?:\\?|&)bvid=([^&#]+)(?:$|&|#)' }, { name: 'youtubeId', selector: '.vedio-content>iframe', attr: 'src', regex: '(?:^https?:\\/\\/www\\.youtube\\.com.*?)\\/([^/\\?#]+)(?:$|\\?|#)' }, { name: 'youkuUrl', selector: '.vedio-content>iframe', attr: 'src', regex: '^https?:\\/\\/player\\.youku\\.com.*' }], errorMode: 'standard', titleField: { fields: ['title'], mode: 'first' }, detailLinkField: { fields: ['link'], mode: 'first' }, mediaUrlField: { fields: ['tencentVid', 'bilibiliBvid', 'youtubeId', 'youkuUrl', 'thumbnail'], mode: 'all' }, idField: { fields: ['id'], mode: 'first' }, urlTransforms: [{ fieldName: 'tencentVid', urlTemplate: 'https://v.qq.com/x/page/{tencentVid}.html', downloadMethod: 'yt-dlp' }, { fieldName: 'bilibiliBvid', urlTemplate: 'https://www.bilibili.com/video/{bilibiliBvid}/', downloadMethod: 'yt-dlp' }, { fieldName: 'youtubeId', urlTemplate: 'https://youtu.be/{youtubeId}', downloadMethod: 'yt-dlp', ytDlpOptions: { cookiesFromBrowser: 'chrome' } }, { fieldName: 'youkuUrl', urlTemplate: '', downloadMethod: 'yt-dlp' }] }),
      JSON.stringify({ itemsFound: 72 }),
      '2026-05-27 13:59:18', '2026-05-27 13:59:18', '2026-06-05 13:59:31',
    )
  }
}
