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

  /** 种子示例：纯爬虫采集任务（无下载 / 转码 / 识别 / AI 配置） */
  private seedDefaults() {
    const taskStmt = this.db.prepare(`
      INSERT OR IGNORE INTO tasks (id, type, status, payload, result, error, progress, retries, max_retries, started_at, created_at, updated_at)
      VALUES (?, ?, 'completed', ?, ?, NULL, 100, 0, 3, ?, ?, ?)
    `)
    // 1) 普诺赛中文站实验操作指南
    taskStmt.run(
      '54b8b05a-c1ee-4a5f-b880-a0438eb210fd',
      'crawl',
      JSON.stringify({"name":"普诺赛中文站实验操作指南","url":"https://www.procell.com.cn/resource/guide","mode":"list","rules":[{"name":"title","selector":"span","attr":"","regex":""},{"name":"link","selector":"a","attr":"href","regex":""},{"name":"id","selector":"a","attr":"href","regex":"\\/(\\d+)(?:$|\\?|#)"}],"itemSelector":".guide-list > li","paginationMode":"page","maxPages":0,"urlPattern":"https://www.procell.com.cn/resource/guide?page={page}","pageStart":1,"detailRules":[{"name":"content","selector":".page.landing-page .container.mt-5:nth-child(3)","attr":"","regex":""}],"errorMode":"standard","titleField":{"fields":["title"],"mode":"first"},"detailLinkField":{"fields":["link"],"mode":"first"},"idField":{"fields":["id"],"mode":"first"}}),
      JSON.stringify({ itemsFound: 0 }),
      '2026-07-16 09:08:13', '2026-07-16 09:06:15', '2026-07-16 09:08:14',
    )
    // 2) 普诺赛中文站新品速递
    taskStmt.run(
      '99a06506-ff9f-4731-9f23-4ca410f9dfce',
      'crawl',
      JSON.stringify({"name":"普诺赛中文站新品速递","url":"https://www.procell.com.cn/resource/products-alerts","mode":"list","rules":[{"name":"title","selector":".article-title","attr":"","regex":""},{"name":"link","selector":"a.d-block.position-relative","attr":"href","regex":""},{"name":"id","selector":"a.d-block.position-relative","attr":"href","regex":"\\/(\\d+)(?:$|\\?|#)"}],"itemSelector":".huodong-list","paginationMode":"page","maxPages":0,"urlPattern":"https://www.procell.com.cn/resource/products-alerts?page={page}","pageStart":1,"detailRules":[{"name":"content","selector":".page.landing-page .container.mt-5:nth-child(3)","attr":"","regex":""}],"errorMode":"standard","titleField":{"fields":["title"],"mode":"first"},"detailLinkField":{"fields":["link"],"mode":"first"},"idField":{"fields":["id"],"mode":"first"}}),
      JSON.stringify({ itemsFound: 0 }),
      '2026-07-16 09:08:17', '2026-07-16 08:47:53', '2026-07-16 09:08:18',
    )
    // 3) 普诺赛官网宣传册采集（英文站，列表抓取 PDF）
    taskStmt.run(
      '69a2e781-16af-4b7a-9ca3-f3e5d41b48b6',
      'crawl',
      JSON.stringify({ name: '普诺赛英文站宣传册采集', url: 'https://www.procellsystem.com/resources/brochure', mode: 'list', rules: [{ name: 'title', selector: '.text-left.px-4.d-block', attr: '', regex: '' }, { name: 'pdfUrl', selector: 'a.download-list', attr: 'href', regex: '' }], itemSelector: '.bg-white .row.mt-3 .col-12.col-lg-4.mb-3', paginationMode: 'none', autoStart: false, errorMode: 'standard', titleField: { fields: ['title'], mode: 'first' }, mediaUrlField: { fields: ['pdfUrl'], mode: 'all' } }),
      JSON.stringify({ itemsFound: 0 }),
      '2026-06-05 11:41:47', '2026-06-05 11:41:47', '2026-06-08 09:24:22',
    )
    // 4) 普诺赛英文站视频采集（列表 + 详情页解析腾讯/哔哩/优酷/YouTube 视频 ID，纯抓取）
    taskStmt.run(
      '6ff7f96b-fe08-435c-8705-69e102e58759',
      'crawl',
      JSON.stringify({ name: '普诺赛英文站视频采集', url: 'https://www.procellsystem.com/resources/videos', mode: 'list', rules: [{ name: 'id', selector: '', attr: 'href', regex: '-(\\d+)(?:$|\\?|#)' }, { name: 'title', selector: '.my-2.two-lines', attr: '', regex: '' }, { name: 'link', selector: '', attr: 'href', regex: '' }], itemSelector: '.bg-white .row.mb-3 > a', paginationMode: 'page', maxPages: 0, urlPattern: 'https://www.procellsystem.com/resources/videos?page={page}', pageStart: 1, detailRules: [{ name: 'videoIframeUrl', selector: '.video-box iframe', attr: 'src', regex: '' }, { name: 'tencentVid', selector: '.video-box iframe', attr: 'src', regex: '(?:^https?:\\/\\/v\\.qq\\.com.*?)(?:\\?|&)vid=([^&#]+)(?:$|&|#)' }, { name: 'bilibiliBvid', selector: '.video-box iframe', attr: 'src', regex: '(?:^https?:\\/\\/player\\.bilibili\\.com.*?)(?:\\?|&)bvid=([^&#]+)(?:$|&|#)' }, { name: 'youtubeId', selector: '.video-box iframe', attr: 'src', regex: '(?:^https?:\\/\\/www\\.youtube\\.com.*?)\\/([^/\\?#]+)(?:$|\\?|#)' }, { name: 'youkuId', selector: '.video-box iframe', attr: 'src', regex: '(?:^https?:\\/\\/player\\.youku\\.com.*?)\\/([^/\\?#]+)(?:$|&|#)' }], errorMode: 'standard', titleField: { fields: ['title'], mode: 'first' }, detailLinkField: { fields: ['link'], mode: 'first' }, mediaUrlField: { fields: ['tencentVid', 'bilibiliBvid', 'youtubeId', 'youkuId'], mode: 'all' }, idField: { fields: ['id'], mode: 'first' } }),
      JSON.stringify({ itemsFound: 0 }),
      '2026-06-05 11:42:10', '2026-06-05 11:42:10', '2026-06-08 09:24:22',
    )
    // 5) 普诺赛中文站视频采集（列表 + 详情页解析上述视频平台 ID，纯抓取）
    taskStmt.run(
      '2b2b277a-1b66-4914-8ded-cc6468fd5bae',
      'crawl',
      JSON.stringify({ name: '普诺赛中文站视频采集', url: 'https://www.procell.com.cn/resource/video', mode: 'list', rules: [{ name: 'id', selector: 'a.px-2', attr: 'href', regex: '\\/(\\d+)(?:$|\\?|#)' }, { name: 'title', selector: 'a.px-2', attr: '', regex: '' }, { name: 'link', selector: 'a.px-2', attr: 'href', regex: '' }, { name: 'thumbnail', selector: '.video-img>img:nth-child(2)', attr: 'src', regex: '' }], itemSelector: '.col-6.col-md-4.mb-4>.huodong-list', paginationMode: 'page', maxPages: 0, urlPattern: 'https://www.procell.com.cn/resource/video?page={page}', pageStart: 1, detailRules: [{ name: 'videoIframeUrl', selector: '.vedio-content>iframe', attr: 'src', regex: '' }, { name: 'tencentVid', selector: '.vedio-content>iframe', attr: 'src', regex: '(?:^https?:\\/\\/v\\.qq\\.com.*?)(?:\\?|&)vid=([^&#]+)(?:$|&|#)' }, { name: 'bilibiliBvid', selector: '.vedio-content>iframe', attr: 'src', regex: '(?:^https?:\\/\\/player\\.bilibili\\.com.*?)(?:\\?|&)bvid=([^&#]+)(?:$|&|#)' }, { name: 'youtubeId', selector: '.vedio-content>iframe', attr: 'src', regex: '(?:^https?:\\/\\/www\\.youtube\\.com.*?)\\/([^/\\?#]+)(?:$|\\?|#)' }, { name: 'youkuId', selector: '.vedio-content>iframe', attr: 'src', regex: '(?:^https?:\\/\\/player\\.youku\\.com.*?)\\/([^/\\?#]+)(?:$|&|#)' }], errorMode: 'standard', titleField: { fields: ['title'], mode: 'first' }, detailLinkField: { fields: ['link'], mode: 'first' }, mediaUrlField: { fields: ['tencentVid', 'bilibiliBvid', 'youtubeId', 'youkuId', 'thumbnail'], mode: 'all' }, idField: { fields: ['id'], mode: 'first' } }),
      JSON.stringify({ itemsFound: 0 }),
      '2026-06-05 14:20:33', '2026-06-05 14:20:33', '2026-06-08 09:24:22',
    )
  }
}
