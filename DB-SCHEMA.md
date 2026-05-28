# 数据库设计文档

**数据库**: SQLite (`data/video-analyst.db`) | **引擎**: better-sqlite3 | **模式**: WAL + 外键开启

---

## 实体关系图

```
┌──────────────┐        ┌─────────────────┐
│   settings   │        │  ai_providers   │    ai_prompts
│  (键值配置)   │        │  (AI模型配置)    │    (提示词模板)
└──────────────┘        └─────────────────┘   ┌────────────────────┐
                                               │ id (PK)            │
                                               │ name               │
                                               │ content (含{{...}}) │
                                               │ is_default (0/1)   │
                                               └────────────────────┘
                                                       │
                                                       │ 被 AI 分析页引用
                                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                         tasks (任务队列)                          │
│  id | type | status | payload(JSON) | result(JSON) | progress    │
│                       ▲ 统一调度入口                              │
└──────────────────────────────────────────────────────────────────┘
          │                    │                    │
   type=crawler          type=transcode      type=whisper/ai
          │                    │                    │
          ▼                    ▼                    ▼
┌────────────────┐   (转码文件→WAV)    ┌──────────────────┐
│  crawl_items   │          │          │  transcriptions  │
│────────────────│          │          │──────────────────│
│ id (PK)        │◄─────────┘          │ id (PK)          │
│ task_id (FK) ──┤                     │ item_id (FK) ────┤──→ crawl_items
│ source_url     │                     │ file_path        │
│ title          │                     │ content (识别文本) │
│ media_url      │                     │ language/duration│
│ media_type     │                     │ status           │
│ media_source   │                     └────────┬─────────┘
│ extra_data(JSON)│                             │
└────────────────┘                               │ transcription_id (FK)
                                                 ▼
                                     ┌──────────────────┐
                                     │   ai_results     │
                                     │──────────────────│
                                     │ id (PK)          │
                                     │ transcription_id │──→ transcriptions
                                     │ model            │
                                     │ prompt           │
                                     │ result (AI分析)   │
                                     │ status           │
                                     └──────────────────┘
```

## 流水线数据流

```
爬虫采集 ──→ crawl_items ──→ 转码(WAV) ──→ transcriptions ──→ AI分析 ──→ ai_results
  │              │                │               │                │
  ▼              ▼                ▼               ▼                ▼
task(crawler)  (文件)       task(transcode)  task(whisper)    task(ai)
```

每次阶段操作创建一个 `tasks` 记录追踪进度，阶段产出存入对应的业务表。链式外键级联删除：删任务 → 删爬虫条目 → 删转录 → 删 AI 结果。

---

## 表详细说明

### 1. `tasks` — 通用任务队列

所有耗时操作的统一调度入口。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `type` | TEXT NOT NULL | `crawler` / `transcode` / `whisper` / `ai` |
| `status` | TEXT | `pending` → `running` → `completed` / `failed` / `cancelled` |
| `payload` | TEXT(JSON) | 任务参数，按 type 不同结构不同 |
| `result` | TEXT(JSON) | 任务结果（完成后写入） |
| `error` | TEXT | 失败时的错误信息 |
| `progress` | INTEGER | 0-100 进度百分比 |
| `retries` | INTEGER | 已重试次数 |
| `max_retries` | INTEGER | 最大重试次数（默认 3） |
| `created_at` / `updated_at` | TEXT | 时间戳 |

**状态流转**:
```
pending ──→ running ──→ completed
   ↑          │              ↑
   │          └──→ failed ───┘ (retries < max_retries 时回到 pending)
   └── retryTask() 手动重试 (completed/failed/cancelled → pending)
```

**payload 结构示例**:

| type | payload |
|---|---|
| `crawler` | `{ name, url, selector, maxPages, ... }` |
| `transcode` | `{ file, outputDir }` |
| `whisper` | `{ filePath, model, language }` |
| `ai` | `{ config: { provider, model, prompt }, transcriptionId }` |

索引: `idx_tasks_type`, `idx_tasks_status`

---

### 2. `crawl_items` — 爬虫采集结果

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `task_id` | TEXT FK → tasks(id) CASCADE | 所属爬虫任务 |
| `source_url` | TEXT | 来源页面 URL |
| `title` | TEXT | 条目标题 |
| `media_url` | TEXT | 媒体文件链接 |
| `media_type` | TEXT | 媒体类型（video/audio） |
| `media_source` | TEXT | 媒体来源平台标识 |
| `status` | TEXT | pending / downloaded / transcoded / error |
| `extra_data` | TEXT(JSON) | 扩展数据（作者、时长等） |
| `created_at` | TEXT | 创建时间 |

索引: `idx_crawl_items_task`

---

### 3. `transcriptions` — 语音识别结果

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `item_id` | TEXT FK → crawl_items(id) CASCADE | 关联爬虫条目 |
| `file_path` | TEXT | 转码后的 WAV 文件路径 |
| `content` | TEXT | Whisper 识别全文 |
| `language` | TEXT | 检测/指定的语言 |
| `duration` | REAL | 音频时长（秒） |
| `status` | TEXT | pending / processing / completed / error |
| `created_at` | TEXT | 创建时间 |

索引: `idx_transcriptions_item`

---

### 4. `ai_results` — AI 分析结果

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `transcription_id` | TEXT FK → transcriptions(id) CASCADE | 关联转录文本 |
| `model` | TEXT NOT NULL | 使用的模型标识（如 `deepseek-chat`） |
| `prompt` | TEXT | 实际使用的提示词（含替换后的内容） |
| `result` | TEXT | AI 返回的分析结果 |
| `status` | TEXT | pending / processing / completed / error |
| `created_at` | TEXT | 创建时间 |

索引: `idx_ai_results_transcription`

---

### 5. `settings` — 键值配置

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | TEXT PK | 配置键 |
| `value` | TEXT NOT NULL | 配置值 |

预置键:

| key | 默认值 | 说明 |
|---|---|---|
| `pipeline_auto` | `"true"` | 全自动流水线开关 |
| `whisper_model` | 动态 | Whisper 模型选择 (tiny/base/small/medium/large) |

无外键，独立于业务数据。通过 `PipelineService` / `SettingsService` 读写。

---

### 6. `ai_providers` — AI 模型配置

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 如 `minimax`、`deepseek` |
| `name` | TEXT UNIQUE | 显示名称 |
| `api_key` | TEXT | API 密钥（AES-256-GCM 加密存储） |
| `base_url` | TEXT | API 地址 |
| `default_model` | TEXT | 默认模型名 |
| `priority` | INTEGER | 优先级（越小越优先，失败自动 fallback） |
| `enabled` | INTEGER | 0=禁用 1=启用 |
| `created_at` | TEXT | 创建时间 |

种子数据: MiniMax (priority=1) + DeepSeek (priority=2)，Key 从 `.env` 导入。

`/models` 页面 CRUD + 上下调优先级。AI 调用时按 priority 排序，失败自动尝试下一个启用的 provider。

---

### 7. `ai_prompts` — 提示词模板

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 如 `default`、`keywords` |
| `name` | TEXT NOT NULL | 名称 |
| `content` | TEXT | 模板内容，`{{content}}` 占位符在运行时替换为实际文本 |
| `is_default` | INTEGER | 0/1，全局唯一默认（应用层保证互斥） |
| `created_at` / `updated_at` | TEXT | 时间戳 |

种子数据: 通用总结(默认) + 提取关键词 + 详细摘要

`/prompts` 页面 CRUD，`save()` 方法在设默认前先 `UPDATE SET is_default=0` 确保互斥。

---

## 表规模与读写频率

| 表 | 增长模式 | 读频率 | 写频率 |
|---|---|---|---|
| `tasks` | 线性 | 高（仪表盘轮询 + SSE 推送） | 高 |
| `crawl_items` | 批量（每页 N 条） | 中 | 中 |
| `transcriptions` | 线性 | 中 | 低 |
| `ai_results` | 线性 | 中 | 低 |
| `settings` | 固定（~5行） | 高（每次流水线判断） | 极低 |
| `ai_providers` | 固定（~5行） | 低 | 极低 |
| `ai_prompts` | 固定（~10行） | 低 | 极低 |

---

## 相关源码索引

| 表 | 建表 | 主要读写 |
|---|---|---|
| `tasks` | `server/src/common/database/database.service.ts` | `server/src/common/queue/queue.service.ts` |
| `crawl_items` | 同上 | `server/src/crawler/crawler.service.ts` |
| `transcriptions` | 同上 | `server/src/whisper/whisper.controller.ts` |
| `ai_results` | 同上 | `server/src/ai/ai.controller.ts` |
| `settings` | 同上 | `server/src/common/pipeline/pipeline.service.ts` |
| `ai_providers` | 同上 | `server/src/ai/ai.service.ts` |
| `ai_prompts` | 同上 | `server/src/ai/prompt.service.ts` |
