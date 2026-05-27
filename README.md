# Video Analyst

音视频采集 · 转码 · 识别 · 分析一站式处理工具。

## 功能

- **爬虫采集** — 抓取网页内容，支持列表、翻页，提取标题及媒体链接（兼容B站、腾讯视频、优酷等内嵌视频）
- **转码处理** — 基于 FFmpeg 将音视频统一转为 16kHz 单声道 WAV，适配 Whisper 识别
- **语音识别** — 调用 Whisper API 将音频转为文字
- **AI 分析** — 接入 DeepSeek / MiniMax 大模型，自定义提示词进行总结、关键词提取
- **数据导出** — 自定义字段，导出 Excel

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | NestJS 11 + SWC + better-sqlite3 |
| 前端 | Vue 3 + Element Plus + UnoCSS + Vite 7 |
| 转码 | FFmpeg (fluent-ffmpeg) |
| 爬虫 | Cheerio |
| 数据库 | SQLite (零依赖，数据文件在 `data/` 目录) |
| 包管理 | pnpm workspace |

## 快速开始

```bash
# 环境要求: Node.js >= 24, pnpm >= 9, FFmpeg

# 1. 安装依赖
pnpm install

# 2. 配置环境变量 (已内置 MiniMax / DeepSeek 默认 Key)
cp .env.example .env

# 3. 开发模式 (前后端热重载)
pnpm dev
# → 前端 http://localhost:5173
# → 后端 http://localhost:3000

# 4. 生产构建
pnpm build && pnpm start
# → 访问 http://localhost:3000
```

## 项目结构

```
video-analyst/
├── server/              # NestJS 后端
│   └── src/
│       ├── common/      # database, queue, sse
│       ├── crawler/     # 爬虫模块
│       ├── transcoder/  # 转码模块
│       ├── whisper/     # 语音识别模块
│       ├── ai/          # 大模型模块
│       └── export/      # 导出模块
├── web/                 # Vue 3 前端
│   └── src/
│       ├── pages/       # 页面组件
│       ├── api/         # API 封装
│       └── composables/ # 组合式函数
├── data/                # 运行时数据 (gitignore)
│   ├── video-analyst.db # SQLite 数据库
│   ├── media/           # 上传文件
│   ├── transcoded/      # 转码输出
│   └── exports/         # Excel 导出
└── .env                 # 环境配置
```

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `SERVER_HOST` | 后端绑定地址 | `0.0.0.0` |
| `SERVER_PORT` | 后端端口 | `3000` |
| `WEB_PORT` | 前端开发端口 | `5173` |
| `FFMPEG_PATH` | FFmpeg 路径 | 系统 PATH |
| `MEMO_AI_BASE_URL` | Whisper 服务地址 | `http://127.0.0.1:9588` |
| `MINIMAX_API_KEY` | MiniMax API Key | (已内置) |
| `MINIMAX_BASE_URL` | MiniMax Base URL | `https://api.minimax.chat` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | (已内置) |
| `DEEPSEEK_BASE_URL` | DeepSeek Base URL | `https://api.deepseek.com/v1` |
