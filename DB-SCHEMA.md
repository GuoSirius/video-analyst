# 数据库设计文档

**数据库**: SQLite（`data/video-analyst.db`）| **引擎**: better-sqlite3 | **模式**: WAL + 外键开启
**说明**: 数据库不提交 Git，服务启动时自动 `CREATE TABLE IF NOT EXISTS` 并写入一个示例采集任务。

---

## 表结构

### 1. `tasks` — 通用任务队列

所有耗时操作的统一调度入口（当前仅 `crawler` 类型）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `type` | TEXT NOT NULL | `crawler` |
| `status` | TEXT | `pending` / `running` / `paused` / `completed` / `failed` / `cancelled` |
| `payload` | TEXT(JSON) | 任务参数（见下方 crawler payload） |
| `result` | TEXT(JSON) | 任务结果（完成后写入） |
| `error` | TEXT | 失败时的错误信息 |
| `progress` | INTEGER | 0-100 进度百分比 |
| `retries` | INTEGER | 已重试次数 |
| `max_retries` | INTEGER | 最大重试次数（默认 3） |
| `started_at` | TEXT | 任务开始执行时间（首次 status→running 时写入，暂停继续不重置） |
| `created_at` / `updated_at` | TEXT | 时间戳 |

索引: `idx_tasks_type`, `idx_tasks_status`

**状态流转**:
```
                    ┌──→ cancelled (用户终止) ←──┐
                    │                            │
pending ──→ running ──→ completed                │
   ↑          │  │              ↑                │
   │          │  └──→ failed ───┘ (retries<3)   │
   │          │         ↓ (retries=max)          │
   │          │         failed (执行失败)         │
   │          │                                  │
   │        paused ←──→ running (暂停/继续)       │
   │          │                                  │
   └── retry / reRun (清除 started_at 重新开始)   │
   └── start (pending→running)                   │
```

**crawler payload 结构**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 任务名称 |
| `url` | string | 起始页面地址 |
| `mode` | `'single'` / `'list'` / `'site'` | 采集模式（site=整站递归爬取） |
| `rules` | CrawlRule[] | 提取规则 |
| `itemSelector` | string | 列表项 CSS 选择器（list 模式必填；site 模式可选，命中则按列表式提取） |
| `paginationMode` | `'none'` / `'page'` / `'count'` | 翻页方式 |
| `nextPageSelector` | string | "下一页" CSS 选择器 |
| `urlPattern` | string | URL 模板，`{page}` 表示页码 |
| `pageStart` | number | URL 模式起始页码（默认 1） |
| `maxPages` | number | 最大页数（0=无限） |
| `maxItems` | number | 最大条数（count 模式） |
| `loadMoreSelector` | string | "加载更多"选择器（实验性） |
| `detailLinkField` | FieldSpec | 详情页 URL 字段指定（fields + mode） |
| `detailRules` | CrawlRule[] | 详情页提取规则 |
| `titleField` | FieldSpec | 指定标题字段（fields + mode，留空自动查找） |
| `mediaUrlField` | FieldSpec | 指定媒体 URL 字段 |
| `errorMode` | `'lenient'` / `'standard'` / `'strict'` | 容错模式（默认 standard） |
| `autoStart` | boolean | 创建后是否自动执行（默认 false） |
| `mode='site'` 专用字段（整站递归爬取） |||
| `sameDomain` | boolean | 仅爬同主域（含子域），默认 true（防爬到外站） |
| `allowPaths` | string[] | 路径前缀白名单，如 `['/docs']` |
| `denyPaths` | string[] | 路径前缀黑名单，如 `['/login','/cart']` |
| `includeRegex` | string[] | URL 正则白名单 |
| `excludeRegex` | string[] | URL 正则黑名单（优先级高于白名单） |
| `maxDepth` | number | 最大递归深度，0=无限 |
| `maxPages` | number | 最大访问页数，0=无限 |
| `delayMs` | number | 请求间隔 ms（礼貌爬取/防封），默认 200 |
| `linkSelector` | string | 链接发现选择器，默认 `a[href]` |

**crawler result 结构**:
```json
{ "itemsFound": 100, "skippedPages": 1, "skippedItems": 3 }
```
整站（site）模式额外包含：`pagesVisited`、`linksDiscovered`、`errors`、`skipped`、`pagesPending`。

---

### 2. `crawl_items` — 爬虫采集结果

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `task_id` | TEXT FK → tasks(id) CASCADE | 所属爬虫任务 |
| `source_url` | TEXT | 来源页面 URL（列表页或单页 URL） |
| `detail_url` | TEXT | 详情页 URL（NULL=无详情页，有值可单项重采） |
| `title` | TEXT | 条目标题（优先 titleField 指定字段，否则自动查找） |
| `media_url` | TEXT | 媒体文件链接 |
| `media_type` | TEXT | video / audio / image / link / text |
| `media_source` | TEXT | 平台名 / direct / 域名 |
| `status` | TEXT | `crawled`(已采集) / `pending` / `error` |
| `extra_data` | TEXT(JSON) | 完整的提取数据 |
| `created_at` | TEXT | 采集时间 |

索引: `idx_crawl_items_task`

**CrawlRule 结构**:
| 字段 | 说明 |
|------|------|
| `name` | 字段名（存储 key） |
| `selector` | CSS 选择器 |
| `attr` | 属性名：留空=提取文本；填写=提取属性值（src/href） |
| `regex` | 正则捕获组：截取部分内容（如 `/product/(\d+)` 提取 ID） |

---

### 3. `crawl_frontier` — 整站爬取待访问队列（BFS frontier）

整站（site）模式使用的「待访问 / 已访问 URL 队列」。`(task_id, url)` 具有 **UNIQUE 约束**，配合 `INSERT OR IGNORE` 实现 URL 去重（同一 URL 在同一任务内只入队一次，避免重复访问与重复提取），`status` 标记处理状态，支持暂停后续跑（pending 行持久化保留）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `task_id` | TEXT FK → tasks(id) CASCADE | 所属爬虫任务 |
| `url` | TEXT | 待访问/已访问 URL（已归一化为绝对地址、去 fragment） |
| `depth` | INTEGER | 发现深度（入口 = 0） |
| `status` | TEXT | `pending` / `visited` / `failed` / `skipped` |
| `parent_url` | TEXT | 从哪个页面发现该链接（用于溯源） |
| `error` | TEXT | 失败原因 |
| `discovered_at` / `visited_at` | TEXT | 时间戳 |

索引: `idx_frontier_task_status (task_id, status)`；UNIQUE 约束 `(task_id, url)` 自动建立唯一索引（等价 `idx_frontier_url`，无需重复创建）。

---

### 4. `settings` — 键值配置

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | TEXT PK | 配置键 |
| `value` | TEXT NOT NULL | 配置值 |

通用键值配置表，**当前未预置任何键值**（保留为扩展位）。通过 `DatabaseService` 读写。

---

## 相关源码索引

| 表 | 建表 | 主要读写 |
|---|---|---|
| `tasks` | `server/src/common/database/database.service.ts` | `server/src/common/queue/queue.service.ts` |
| `crawl_items` | 同上 | `server/src/crawler/crawler.service.ts` |
| `crawl_frontier` | 同上 | `server/src/crawler/crawler.controller.ts`（`processSiteTask` / frontier helpers） |
| `settings` | 同上 | `server/src/common/database/database.service.ts` |
