# Video Analyst

音视频采集 · 转码 · 识别 · 分析一站式处理工具。

## 执行流程

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ 爬虫采集  │ ──→ │ 转码处理  │ ──→ │ 语音识别  │ ──→ │ AI 分析  │ ──→ Excel 导出
│ 提取链接  │     │ → WAV    │     │ Whisper  │     │ 大模型   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
      │                │                │                │
      └──── 也可从任意环节开始 ─────────┘                │
                                                         │
      ┌──────────────────────────────────────────────────┘
      │ 选中结果 → 点"继续流水线" → 后续全自动完成
```

### 三种执行模式

| 模式 | 操作方式 | 说明 |
|---|---|---|
| **全自动** | 打开顶部"自动"开关 | 上传文件/指定目录后，转码→识别→分析全自动完成 |
| **逐环节手动** | 关闭"自动"开关 | 每步独立操作，自由选择进入下一步的内容 |
| **半自动** | 任意环节勾选 → "继续流水线" | 从当前环节开始，后续全自动完成 |

### 各环节入口

| 起点 | 场景 |
|---|---|
| 爬虫页面 | 输入 URL，抓取媒体链接 → 勾选 → 继续流水线 |
| 转码页面 | 上传音视频文件或指定本地目录 → 自动/手动转码 |
| AI 页面 | 勾选已转码文件 → 语音识别 → 勾选识别结果 → AI 分析 |

### 语音识别 (Whisper) 双模式

| 模式 | 配置 | 说明 |
|---|---|---|
| **API 模式** | 设置 `MEMO_AI_BASE_URL` | 调用远端 Whisper 服务 |
| **本地模式** | 不设置 `MEMO_AI_BASE_URL` | 使用本机 `whisper` CLI，可选 tiny/base/small/medium/large 模型 |

模型选择：`GET/POST /api/whisper/models`，或通过设置接口持久化。

## 功能

- **爬虫采集** — 抓取网页内容，支持列表、翻页，提取标题及媒体链接（兼容B站、腾讯视频、优酷等内嵌视频）
- **转码处理** — 基于 FFmpeg 将音视频统一转为 16kHz 单声道 WAV，适配 Whisper 识别
- **语音识别** — Whisper API 或本地 CLI，支持 tiny~large 多模型选择
- **AI 分析** — 接入 DeepSeek / MiniMax 大模型，自定义提示词进行总结、关键词提取
- **数据导出** — 自定义字段，导出 Excel
- **自动化流水线** — 可全自动/半自动/手动控制各环节串联

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | NestJS 11 + SWC + better-sqlite3 |
| 前端 | Vue 3 + Element Plus + UnoCSS + Vite 7 + FontAwesome 6 |
| 转码 | FFmpeg (fluent-ffmpeg) |
| 爬虫 | Cheerio |
| 语音识别 | Whisper API / 本地 CLI |
| AI | DeepSeek + MiniMax |
| 数据库 | SQLite (零依赖，数据文件在 `data/` 目录) |
| 包管理 | pnpm workspace |

## 快速开始

```bash
# 环境要求: Node.js >= 24, pnpm >= 9, FFmpeg
# 本地 Whisper 模式还需: pip install openai-whisper

# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，根据需要配置：
#   - 远程 API: 设置 MEMO_AI_BASE_URL
#   - 本地模式: 不设置 MEMO_AI_BASE_URL，需安装 whisper CLI

# 3. 开发模式 (前后端热重载)
pnpm dev

# 4. 生产构建
pnpm build && pnpm start
```

## 项目结构

```
video-analyst/
├── server/                 # NestJS 后端
│   └── src/
│       ├── common/
│       │   ├── database/   # SQLite 数据库 + 表结构
│       │   ├── queue/      # SQLite 任务队列 (状态/进度/重试)
│       │   ├── sse/        # SSE 实时推送
│       │   └── pipeline/   # 自动化流水线服务
│       ├── settings/       # 全局设置 (流水线开关/Whisper 模型)
│       ├── crawler/        # 爬虫 (cheerio + CSS 选择器)
│       ├── transcoder/     # ffmpeg 转码 (16kHz mono WAV)
│       ├── whisper/        # 语音识别 (API / 本地 CLI)
│       ├── ai/             # 大模型 (DeepSeek + MiniMax)
│       └── export/         # Excel 导出 (exceljs)
├── web/                    # Vue 3 前端
│   └── src/
│       ├── pages/          # 仪表盘/爬虫/转码/AI/导出
│       ├── api/            # 全部 API 封装 (含 settings)
│       └── composables/    # useSSE 实时进度
├── data/                   # 运行时数据
│   ├── video-analyst.db    # SQLite 数据库 (Git 提交)
│   ├── media/              # 用户上传的音视频 (gitignore)
│   ├── transcoded/         # FFmpeg 转码输出 WAV (gitignore)
│   └── exports/            # Excel 导出文件 (gitignore)
└── .env                    # 环境配置
```

## API 总览

| 模块 | 主要接口 |
|---|---|
| 爬虫 | `POST /api/crawler/crawl` `GET /api/crawler/tasks` `GET /api/crawler/items` |
| 转码 | `POST /api/transcoder/upload` `POST /api/transcoder/convert` `GET /api/transcoder/ffmpeg-check` |
| 识别 | `POST /api/whisper/transcribe` `GET /api/whisper/results` `GET /api/whisper/models` |
| AI | `POST /api/ai/analyze` `GET /api/ai/providers` `GET /api/ai/results` |
| 导出 | `POST /api/export/excel` `GET /api/export/columns` |
| 设置 | `GET /api/settings/pipeline` `POST /api/settings/pipeline` |
| 进度 | 所有模块均有 `GET /api/*/events` (SSE) 实时推送任务状态 |

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `SERVER_HOST` | 后端绑定地址 | `0.0.0.0` |
| `SERVER_PORT` | 后端端口 | `3000` |
| `WEB_PORT` | 前端开发端口 | `5173` |
| `VITE_API_BASE_URL` | 前端 API 地址 | `http://127.0.0.1:3000/api` |
| `FFMPEG_PATH` | FFmpeg 路径 | 系统 PATH |
| `MEMO_AI_BASE_URL` | Whisper 远端地址 | 留空则用本机 whisper CLI |
| `MINIMAX_API_KEY` | MiniMax API Key | (已内置) |
| `MINIMAX_BASE_URL` | MiniMax Base URL | `https://api.minimax.chat` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | (已内置) |
| `DEEPSEEK_BASE_URL` | DeepSeek Base URL | `https://api.deepseek.com/v1` |
