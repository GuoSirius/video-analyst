import 'reflect-metadata'
import * as http from 'http'
import Database from 'better-sqlite3'
import { Subject } from 'rxjs'
import { CrawlerService } from '../crawler.service'
import { CrawlerController } from '../crawler.controller'
import { QueueService } from '../../common/queue/queue.service'
import { DatabaseService } from '../../common/database/database.service'
import { normalizeLink, inScope, extractLinks, ScopeConfig } from '../site-crawler.util'

// ── 简易断言 ──
let passed = 0
let failed = 0
function assert(cond: any, msg: string) {
  if (cond) {
    passed++
    console.log('  ✓ ' + msg)
  } else {
    failed++
    console.error('  ✗ ' + msg)
  }
}

// ── 临时 SQLite（仅建测试所需表）──
function makeDb(): DatabaseService {
  const d = new Database(':memory:')
  d.pragma('journal_mode = WAL')
  d.pragma('foreign_keys = ON')
  d.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT NOT NULL, result TEXT, error TEXT, progress INTEGER DEFAULT 0,
      retries INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 3,
      started_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS crawl_items (
      id TEXT PRIMARY KEY, task_id TEXT, source_url TEXT, detail_url TEXT, title TEXT,
      media_url TEXT, media_type TEXT, media_source TEXT, status TEXT DEFAULT 'pending',
      extra_data TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS crawl_frontier (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, url TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', parent_url TEXT, error TEXT,
      discovered_at TEXT DEFAULT (datetime('now')), visited_at TEXT,
      UNIQUE(task_id, url)
    );
    CREATE INDEX IF NOT EXISTS idx_frontier_task_status ON crawl_frontier(task_id, status);
    CREATE INDEX IF NOT EXISTS idx_frontier_url ON crawl_frontier(task_id, url);
  `)
  const svc = new DatabaseService()
  ;(svc as any).db = d
  return svc
}

async function main() {
  // ── 本地 mock 站点 ──
  const pages: Record<string, string> = {
    '/': `<html><body>
      <a href="/page1">Page1</a>
      <a href="/page2">Page2</a>
      <a href="/admin">Admin</a>
      <a href="https://external.example.com/foo">External</a>
      <div class="item"><span>TitleA</span></div>
      <div class="item"><span>TitleB</span></div>
    </body></html>`,
    '/page1': `<html><body>
      <a href="/page1a">Page1a</a>
      <a href="/page2">Page2</a>
      <div class="item"><span>TitleC</span></div>
    </body></html>`,
    '/page2': `<html><body><a href="/">Home</a></body></html>`,
    '/page1a': `<html><body><p>no items</p></body></html>`,
    '/admin': `<html><body><a href="/">Home</a></body></html>`,
  }
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0]
    if (pages[url] != null) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(pages[url])
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as any).port
  const BASE = `http://127.0.0.1:${port}`
  const ENTRY = BASE + '/'

  // ── 构造控制器（真实 CrawlerService / QueueService + 内存库 + 桩 SSE）──
  const dbService = makeDb()
  const queue = new QueueService(dbService)
  const sseStub: any = { getTaskStream: () => new Subject().asObservable() }
  const crawler = new CrawlerService()
  // 测试环境：mock 站点监听 127.0.0.1，被生产 SSRF 防护拦截。
  // 此处仅覆盖实例方法 fetchHtml 绕过 host 校验（生产代码不变），直接走 http 请求。
  ;(crawler as any).fetchHtml = (url: string, timeoutMs = 15000): Promise<string> => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs)
    return fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
      signal: controller.signal,
    }).then((resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
      return resp.text()
    }).finally(() => { if (timer) clearTimeout(timer) })
  }
  const controller = new CrawlerController(crawler, queue, sseStub, dbService)

  function insertTask(id: string, payload: any) {
    dbService.db.prepare(
      `INSERT INTO tasks (id, type, status, payload, progress) VALUES (?, 'crawl', 'pending', ?, 0)`,
    ).run(id, JSON.stringify(payload))
  }
  function getTask(id: string) {
    return dbService.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any
  }
  function countItems(id: string) {
    return (dbService.db.prepare('SELECT COUNT(*) c FROM crawl_items WHERE task_id = ?').get(id) as any).c
  }
  function frontierUrls(id: string) {
    return (dbService.db.prepare('SELECT url FROM crawl_frontier WHERE task_id = ?').all(id) as any[]).map((r) => r.url)
  }

  const basePayload = (over: any = {}) => ({
    name: 'test-site',
    url: ENTRY,
    mode: 'site',
    rules: [{ name: 'title', selector: '.item', attr: '' }, { name: 'link', selector: 'a', attr: 'href' }],
    itemSelector: '.item',
    sameDomain: true,
    allowPaths: [],
    denyPaths: ['/admin'],
    includeRegex: [],
    excludeRegex: [],
    maxDepth: 0,
    maxPages: 5,
    delayMs: 0,
    errorMode: 'standard',
    ...over,
  })

  console.log('\n[1] 纯函数单测')
  // normalizeLink
  assert(normalizeLink('/page1', ENTRY) === ENTRY + 'page1', 'normalizeLink 相对链接转绝对')
  assert(normalizeLink('#top', ENTRY) === null, 'normalizeLink 忽略纯锚点')
  assert(normalizeLink('mailto:a@b.com', ENTRY) === null, 'normalizeLink 忽略 mailto')
  assert(normalizeLink('javascript:void(0)', ENTRY) === null, 'normalizeLink 忽略 javascript')
  // inScope
  const scope: ScopeConfig = { sameDomain: true, allowPaths: [], denyPaths: ['/admin'], includeRegex: [], excludeRegex: [] }
  assert(inScope(BASE + '/page1', scope, '127.0.0.1:' + port) === true, 'inScope 同域通过')
  assert(inScope('https://external.example.com/x', scope, '127.0.0.1:' + port) === false, 'inScope 外站拦截')
  assert(inScope(BASE + '/admin', scope, '127.0.0.1:' + port) === false, 'inScope 路径黑名单拦截')
  assert(inScope(BASE + '/docs', scope, '127.0.0.1:' + port) === true, 'inScope 非黑名单路径通过')
  const scopeAllow: ScopeConfig = { sameDomain: true, allowPaths: ['/docs'], denyPaths: [], includeRegex: [], excludeRegex: [] }
  assert(inScope(BASE + '/docs/a', scopeAllow, '127.0.0.1:' + port) === true, 'inScope 路径白名单通过')
  assert(inScope(BASE + '/blog', scopeAllow, '127.0.0.1:' + port) === false, 'inScope 路径白名单外拦截')
  const scopeRx: ScopeConfig = { sameDomain: true, allowPaths: [], denyPaths: [], includeRegex: [], excludeRegex: ['\\.css$'] }
  assert(inScope(BASE + '/a.css', scopeRx, '127.0.0.1:' + port) === false, 'inScope 正则黑名单拦截 .css')
  // extractLinks
  const links = extractLinks(pages['/'], 'a[href]', ENTRY)
  assert(links.includes(BASE + '/page1') && links.includes(BASE + '/page2'), 'extractLinks 提取站内链接')
  assert(links.includes('https://external.example.com/foo'), 'extractLinks 提取外链（由 inScope 后续过滤）')
  assert(!links.includes(ENTRY + '#top'), 'extractLinks 去 fragment')

  console.log('\n[2] 整站 BFS 集成测试')
  const T1 = 'task-integration-1'
  insertTask(T1, basePayload())
  await (controller as any).processSiteTask(T1, basePayload(), undefined)
  const r1 = JSON.parse(getTask(T1).result || '{}')
  assert(getTask(T1).status === 'completed', '任务完成')
  assert(r1.pagesVisited === 4, `访问 4 页 (entry/page1/page2/page1a)，实际 ${r1.pagesVisited}`)
  assert(r1.itemsFound === 3, `提取 3 条 item (entry2+page1)，实际 ${r1.itemsFound}`)
  assert(countItems(T1) === 3, 'crawl_items 落库 3 条')
  const f1 = frontierUrls(T1)
  assert(!f1.some((u: string) => u.includes('external.example.com')), '外站链接未入队')
  assert(!f1.some((u: string) => u.includes('/admin')), '黑名单路径未入队')
  assert(f1.length === 4, `frontier 共 4 条 (去重后)，实际 ${f1.length}`)

  console.log('\n[3] 暂停续跑（frontier 持久化）')
  const T2 = 'task-resume-2'
  // 预置 frontier：entry 已访问，page1 待访问
  dbService.db.prepare(`INSERT INTO crawl_frontier (id, task_id, url, depth, status) VALUES (?,?,?,0,'visited')`).run('f-entry', T2, ENTRY)
  dbService.db.prepare(`INSERT INTO crawl_frontier (id, task_id, url, depth, status) VALUES (?,?,?,1,'pending')`).run('f-page1', T2, BASE + '/page1')
  const resumePayload = basePayload()
  insertTask(T2, resumePayload)
  dbService.db.prepare(`UPDATE tasks SET status='running' WHERE id=?`).run(T2)
  // 带 resumeState 调用（模拟暂停后继续）：不应清空 frontier，应从 page1 继续
  await (controller as any).processSiteTask(T2, resumePayload, { pagesVisited: 1, linksDiscovered: 3, itemsFound: 2, errors: 0, skipped: 0 })
  const r2 = JSON.parse(getTask(T2).result || '{}')
  assert(r2.pagesVisited === 4, `续跑后累计访问 4 页 (1+page1/page1a/page2)，实际 ${r2.pagesVisited}`)
  assert(r2.itemsFound === 3, `续跑后累计 itemsFound=3 (2+page1)，实际 ${r2.itemsFound}`)
  const entryRow = dbService.db.prepare(`SELECT status FROM crawl_frontier WHERE task_id=? AND url=?`).get(T2, ENTRY) as any
  assert(entryRow && entryRow.status === 'visited', '续跑未清空 frontier（entry 仍为 visited）')

  server.close()
  console.log(`\n结果：通过 ${passed}，失败 ${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('测试异常：', e)
  process.exit(1)
})
