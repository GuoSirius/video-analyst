# Video Analyst

基于规则的网页爬虫采集工具：新建爬取任务、执行爬取、查看结果并导出。

## 功能

- **规则化采集** — 通过 CSS 选择器 + 正则提取字段，支持单页、列表、整站三种模式
- **整站爬取** — 以入口 URL 为起点，按 BFS 递归发现站内链接、范围过滤、去重后逐页提取（详见 [爬虫使用指南](./CRAWLER-GUIDE.md) 第 10 节）
- **翻页与详情页** — 支持「按页数 / 按条数 / URL 模式」翻页，可进入详情页补充提取
- **字段智能识别** — 可显式指定标题 / 详情链接 / 媒体 / 唯一 ID 字段，未指定时自动推断
- **容错与重试** — 宽松 / 标准 / 严格三档容错，任务与单项均支持重试、重采
- **实时进度** — SSE 推送任务状态与进度，前端自动刷新
- **多格式导出** — 采集结果导出 JSON / CSV / YAML / Excel，字段可勾选

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | NestJS 11 + SWC + better-sqlite3 |
| 前端 | Vue 3 + Element Plus（暗黑模式）+ UnoCSS + Vite + FontAwesome 6 |
| 爬虫 | Cheerio（CSS 选择器 + 正则） |
| 数据库 | SQLite（零依赖，文件 `data/video-analyst.db`，启动时自动建表 / 重建） |
| 包管理 | pnpm workspace（server + web） |

## 快速开始

```bash
# 环境要求: Node.js 22（better-sqlite3 是原生模块，已按 Node 22 ABI 编译；请勿用 Node 24/26 启动，否则报 ERR_DLOPEN_FAILED）, pnpm >= 9

# 1. 安装依赖
pnpm install

# 2. 配置环境变量（可选，默认值即可本地运行）
cp .env.example .env

# 3. 开发模式（前后端热重载）
pnpm dev

# 4. 生产构建（后端托管前端静态资源）
pnpm build && pnpm start
```

- 前端开发: http://localhost:5173
- 后端: http://localhost:3000
- 前端 API 直连后端（`VITE_API_BASE_URL`），不走 Vite proxy

## 项目结构

```
video-analyst/
├── server/                 # NestJS 后端
│   └── src/
│       ├── common/
│       │   ├── database/   # SQLite 初始化 + 建表 + 种子示例
│       │   ├── queue/      # SQLite 任务队列（状态 / 进度 / 重试）+ tasks 控制器
│       │   ├── sse/        # SSE 实时推送
│       │   └── utils/      # 共享工具（date、url 检测 / 分类 / ID 提取）
│       ├── crawler/        # 爬虫（cheerio + CSS 选择器 + 翻页 + 详情页 + 导出）
│       └── main.ts
├── web/                    # Vue 3 前端
│   └── src/
│       ├── pages/          # 仪表盘 / 爬虫任务 / 采集列表
│       ├── api/            # API 封装（crawler 模块）
│       └── composables/    # useSSE 实时进度
├── data/                   # 运行时数据（video-analyst.db 由 data/.gitignore 强制跟踪，随仓库提交）
│   └── video-analyst.db    # SQLite（首次启动建表；tasks 为空时写入示例任务）
└── .env
```

## API 总览

| 模块 | 主要接口 |
|---|---|
| 任务 | `POST /api/crawler/crawl` · `GET /api/crawler/tasks` · `GET /api/crawler/tasks/paginated` · `POST /api/crawler/tasks/:id/start｜pause｜stop｜retry｜rerun` · `PUT /api/crawler/tasks/:id` · `DELETE /api/crawler/tasks/:id` |
| 采集项 | `GET /api/crawler/items` · `DELETE /api/crawler/items/:id` · `POST /api/crawler/items/:id/retry｜recrawl｜cancel` · 批量操作 |
| 导出 | `GET /api/crawler/export/fields` · `POST /api/crawler/export` · `POST /api/crawler/export-items`（格式：`json` / `yaml` / `csv` / `excel`） |
| 进度 | `GET /api/crawler/events`（SSE）实时推送任务状态与进度 |

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `SERVER_HOST` | 后端绑定地址 | `0.0.0.0` |
| `SERVER_PORT` | 后端端口 | `3000` |
| `WEB_PORT` | 前端开发端口 | `5173` |
| `VITE_API_BASE_URL` | 前端 API 地址 | `http://127.0.0.1:3000/api` |

## 更多文档

- [爬虫使用指南](./CRAWLER-GUIDE.md) — 采集模式、提取规则、翻页、详情页、字段指定、容错重试、单项重采、SSE
- [数据库设计](./DB-SCHEMA.md) — 表结构、字段说明、crawler 任务 payload
- [开发约定（CLAUDE）](./CLAUDE.md) — 技术栈、项目结构、前端规范、核心设计（供 AI / 开发者参考）
