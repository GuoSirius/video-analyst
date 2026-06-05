# Video Analyst - 项目说明

## 项目概述

音视频采集→转码→语音识别→AI分析一站式处理工具。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | NestJS 11 + SWC 编译 + better-sqlite3 |
| 前端 | Vue 3 + Element Plus (暗黑模式) + UnoCSS (presetUno) + Vite 7 + FontAwesome 6 (CSS) |
| 包管理 | pnpm workspace (server + web) |
| 数据库 | SQLite (data/video-analyst.db，已提交仓库) |

## 启动

```bash
pnpm install        # 安装依赖
cp .env.example .env # 配置环境变量（填入 API Key）
pnpm dev            # 开发模式（前后端热重载）
pnpm build && pnpm start  # 生产模式（后端托管前端）
```

- 前端: http://localhost:5173
- 后端: http://localhost:3000
- 前端 API 直连后端（VITE_API_BASE_URL），不走 Vite proxy

## 项目结构

```
server/src/
├── common/
│   ├── database/    # SQLite 初始化 + 建表 + seedDefaults()
│   ├── queue/       # SQLite 任务队列 (pending→running→completed/failed)
│   ├── sse/         # SSE 实时推送任务进度
│   ├── pipeline/    # 自动化流水线 (isAutoMode/setAutoMode)
│   ├── crypto/      # AES-256-GCM 加密 (encrypt/decrypt)
│   └── utils/       # 共享工具 (date, url 检测/分类/ID提取)
├── settings/        # 全局设置 API (/api/settings/pipeline)
├── crawler/         # 爬虫 (cheerio + CSS选择器 + 翻页)
├── transcoder/      # FFmpeg 转码 → 16kHz mono WAV
├── whisper/         # 语音识别 (远端API 或 本地whisper CLI)
├── ai/              # 大模型调用 (多provider优先级+fallback)
├── downloader/      # yt-dlp / HTTP直链 下载
└── export/          # Excel 导出 (exceljs)

web/src/
├── api/
│   ├── client.ts    # axios 实例
│   ├── index.ts     # barrel 统一导出
│   └── modules/     # 按模块拆分: crawler/transcoder/whisper/ai/export/settings
├── pages/           # 仪表盘/爬虫/转码/AI分析/导出/模型管理
└── composables/     # useSSE 实时进度
```

## 核心设计

### 1. 任务队列
所有耗时操作（爬虫/转码/识别/AI）通过 SQLite 任务队列执行：
- `tasks` 表: id, type, status, payload, result, error, progress, retries
- 状态流转: pending → running → completed/failed
- 失败自动重试（retries < max_retries）
- SSE 实时推送进度到前端

### 2. 自动化流水线
三层控制：
- **全自动**: 全局开关 ON → 上传后自动 转码→识别→AI
- **半自动**: 勾选结果 → 点"继续流水线" → 后续自动完成
- **纯手动**: 全局开关 OFF → 每步独立操作

流水线链: transcode → whisper → AI，在 `processTranscodeTask`/`processWhisperTask` 中检查 `pipeline.isAutoMode()`

### 3. AI 模型管理
- `ai_providers` 表存储模型配置（api_key 加密存储）
- 调用时按 priority 排序，失败自动 fallback 到下一个
- 加密: `server/src/common/crypto/crypto.util.ts` (AES-256-GCM)
- 前端: `/models` 页面增删改查，上下调优先级
- 首次启动: `seedDefaults()` 从 .env 导入默认模型

### 4. Whisper 双模式
- API 模式: 设置 `MEMO_AI_BASE_URL` → 调用远端 `/inference`
- 本地模式: 留空 → 使用 `whisper` CLI 命令（需 pip install openai-whisper）
- 模型可选: tiny/base/small/medium/large

### 5. 数据库表

详见 [DB-SCHEMA.md](./DB-SCHEMA.md) — 完整 ER 图、字段说明、数据流、读写频率。

- `tasks` - 任务队列
- `crawl_items` - 爬虫采集结果
- `transcriptions` - 语音识别结果
- `ai_results` - AI 分析结果
- `ai_providers` - AI 模型配置（加密）
- `ai_prompts` - 提示词模板
- `settings` - 键值对（pipeline_auto, whisper_model 等）

### 6. 前端规范
- 使用 UnoCSS class（不是内联 style），presetUno 已配置 preflight: false
- 自定义字号用任意值语法: `text-[13px]` `text-[11px]`
- Element Plus 组件用于表单: el-button/el-input/el-table/el-dialog 等
- FontAwesome 图标用 CSS 方式: `<i class="fas fa-xxx">`（不是 SVG 组件）
- 暗黑模式: `html.dark` + Element Plus dark css-vars + `web/src/style.css`
- **下拉+自由输入**: cookies from browser 等场景用 `el-select` + `filterable` + `allow-create` + `clearable`，预设常用值但允许自定义
- **弹窗合并**: 相近功能的弹窗共用一个 dialog，通过 `v-if` 条件区块 + 动态 title 区分模式（如错误详情/等效命令共用一个弹窗）

### 7. URL 检测与文件名规范

#### 共享工具 `server/src/common/utils/url.util.ts`

所有 URL 类型判断、扩展名提取、视频 ID 提取的**唯一入口**，禁止在业务代码中内联重复列表。

| 导出 | 用途 |
|---|---|
| `VIDEO_PLATFORM_DOMAINS` | 16 个已知视频站点域名（唯一数据源） |
| `PSEUDO_STATIC_EXTS` | 伪静态后缀集合: `html/htm/php/asp/aspx/jsp/cgi` |
| `isVideoPlatform(url)` | URL 是否属于已知视频平台 |
| `extractExtFromUrl(url)` | 从末段取扩展名，自动过滤伪静态后缀，返回 `''` 表示无有效扩展名 |
| `extractVideoId(url)` | 平台原生视频 ID（仅视频平台返回有意义值，非平台返回 `''`） |
| `classifyExt(ext)` | 扩展名 → `video/audio/image/document/unknown` |
| `resolveFileType(url, ext)` | 综合判断：扩展名 + 平台 + URL 特征 |

**ID 提取规则**: YouTube 特判 `?v=` / `youtu.be/ID`；其余平台取 URL 末段剥除伪静态/媒体后缀，过滤路由噪声（watch/page/x/video 等）

#### 文件名格式

```
{标题}_{视频ID}.{扩展名}
```

- **视频 ID 优先级**: yt-dlp `info.id` → `extractVideoId(url)` → `itemId` 前 8 位
- **直链文件**: 无平台 ID 时用 itemId 前 8 位兜底
- **非视频非直链**: 不加 ext，不加 ID 后缀
- **伪静态后缀**: 视频平台自动替换为 `.mp4`，非平台剥离
- **去重**: 若文件名已包含 ID 则跳过追加

#### 示例

| URL | 标题 | 结果 |
|---|---|---|
| `v.qq.com/x/page/l3503vghztq.html` | 冻存细胞收货处理 | `冻存细胞收货处理_l3503vghztq.mp4` |
| `bilibili.com/video/BV1xx411c7mD` | 某个视频 | `某个视频_BV1xx411c7mD.mp4` |
| `youtube.com/watch?v=abc123` | My Video | `My_Video_abc123.mp4` |
| `example.com/file.mp4` | — | `file_a1b2c3d4.mp4` |

## 环境变量

| 变量 | 说明 |
|---|---|
| SERVER_HOST / SERVER_PORT / WEB_PORT | 服务地址和端口 |
| VITE_API_BASE_URL | 前端 API 地址（默认 http://127.0.0.1:3000/api） |
| FFMPEG_PATH | FFmpeg 路径（留空用系统 PATH） |
| MEMO_AI_BASE_URL | Whisper 远端地址（留空用本地 CLI） |
| ENCRYPTION_KEY | 数据库加密密钥（可选） |
| MINIMAX_API_KEY / MINIMAX_BASE_URL | MiniMax 配置（仅首次导入用） |
| DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL | DeepSeek 配置（仅首次导入用） |

## 注意事项
- .env.example 不含真实 Key，.env 由用户自行配置
- data/video-analyst.db 提交到 Git，方便快速启动
- data/media/ transcoded/ exports/ 忽略提交
- 换电脑后: git clone → pnpm install → cp .env.example .env → 填 Key → pnpm dev
- API Key 在数据库中 AES-256-GCM 加密存储，前端展示脱敏
