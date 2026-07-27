# Video Analyst — 开发约定（供 AI / 开发者参考）

> 本文档面向接手本仓库的开发者与 AI 编码助手，描述技术栈、项目结构、核心设计与前端规范。
> 业务使用请参阅 [README.md](./README.md) 与 [爬虫使用指南](./CRAWLER-GUIDE.md)，数据库细节见 [DB-SCHEMA.md](./DB-SCHEMA.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | NestJS 11 + SWC 编译 + better-sqlite3 |
| 前端 | Vue 3 + Element Plus（暗黑模式）+ UnoCSS（presetUno）+ Vite + FontAwesome 6（CSS） |
| 包管理 | pnpm workspace（server + web） |
| 数据库 | SQLite（`data/video-analyst.db`，由 data/.gitignore 强制跟踪、随仓库提交；启动时建表，tasks 为空时写入示例任务） |

## 启动

```bash
pnpm install
cp .env.example .env   # 默认值即可本地运行，无需填 Key
pnpm dev               # 开发模式（前后端热重载）
pnpm build && pnpm start  # 生产模式（后端托管前端）
```

- 前端: http://localhost:5173 ｜ 后端: http://localhost:3000
- 前端 API 直连后端（`VITE_API_BASE_URL`），不走 Vite proxy
- `data/video-analyst.db` 已随仓库提交（data/.gitignore 强制跟踪），首次启动自动建表；tasks 为空时写入示例任务

## 项目结构

```
server/src/
├── common/
│   ├── database/    # SQLite 初始化 + 建表 + seedDefaults()
│   ├── queue/       # SQLite 任务队列（pending→running→completed/failed）+ tasks 控制器
│   ├── sse/         # SSE 实时推送任务进度
│   └── utils/       # 共享工具（date、url 检测 / 分类 / ID 提取）
└── crawler/         # 爬虫（cheerio + CSS 选择器 + 翻页 + 详情页 + 导出）

web/src/
├── api/
│   ├── client.ts    # axios 实例
│   ├── index.ts     # barrel 统一导出
│   └── modules/     # crawler.ts（按模块拆分）
├── pages/           # 仪表盘 / 爬虫任务 / 采集列表
└── composables/     # useSSE 实时进度
```

## 核心设计

### 1. 任务队列
所有耗时操作通过 SQLite 任务队列执行：
- `tasks` 表: id, type, status, payload, result, error, progress, retries
- 状态流转: pending → running → completed / failed（失败自动重试，retries < max_retries）
- SSE 实时推送进度到前端
- 当前仅 `crawler` 一种任务类型
- 整站爬取（site 模式）使用 `crawl_frontier` 表作为 BFS 待访问队列，按范围规则（同域 / 路径黑白名单 / URL 正则黑白名单）过滤并去重，复用同一套提取与入库逻辑

### 2. 前端规范
- 使用 UnoCSS class（不是内联 style），presetUno 已配置 preflight: false
- 自定义字号用任意值语法: `text-[13px]` `text-[11px]`
- Element Plus 组件用于表单: el-button / el-input / el-table / el-dialog 等
- FontAwesome 图标用 CSS 方式: `<i class="fas fa-xxx">`（不是 SVG 组件）
- 暗黑模式: `html.dark` + Element Plus dark css-vars + `web/src/style.css`
- **下拉 + 自由输入**: cookies 等场景用 `el-select` + `filterable` + `allow-create` + `clearable`，预设常用值但允许自定义
- **弹窗合并**: 相近功能的弹窗共用一个 dialog，通过 `v-if` 条件区块 + 动态 title 区分模式

## 环境变量

| 变量 | 说明 |
|---|---|
| SERVER_HOST / SERVER_PORT / WEB_PORT | 服务地址和端口 |
| VITE_API_BASE_URL | 前端 API 地址（默认 http://127.0.0.1:3000/api） |

## 注意事项
- `.env.example` 不含真实 Key，`.env` 由用户自行配置
- `data/video-analyst.db` 已随仓库提交（data/.gitignore 强制跟踪），启动自动建表，tasks 为空时写入示例任务
- 换电脑后: git clone → pnpm install → cp .env.example .env → pnpm dev
