# 爬虫采集系统 — 完整指南

## 目录
1. [采集模式](#1-采集模式)
2. [提取规则](#2-提取规则)
3. [翻页配置](#3-翻页配置)
4. [详情页提取](#4-详情页提取)
5. [标题自动查找](#5-标题自动查找)
6. [错误容忍与重试](#6-错误容忍与重试)
7. [任务状态与操作](#7-任务状态与操作)
8. [单项重试与重采](#8-单项重试与重采)
9. [实时更新 (SSE)](#9-实时更新-sse)

---

## 1. 采集模式

| 模式 | 说明 | 结果格式 | 适用场景 |
|------|------|---------|---------|
| **单页采集** | 抓取单个页面内容 | 一个对象 | 新闻详情、文章页 |
| **列表采集** | 抓取列表页中所有条目 | 一个数组 | 产品列表、文章列表 |

```
单页采集: URL → fetch → parseHtml(rules) → 1 个 item
列表采集: URL → fetch → parseHtml(rules, itemSelector) → N 个 items
```

---

## 2. 提取规则

每条规则包含四个部分：

```
┌──────────┬────────────────┬──────────────┬──────────────┐
│  字段名   │  CSS 选择器     │   提取方式    │   正则截取    │
│  (name)  │  (selector)    │   (attr)     │   (regex)    │
├──────────┼────────────────┼──────────────┼──────────────┤
│  title   │  h1, .title   │  (空=文本)    │  (空=完整值)  │
│  image   │  img.thumb    │  src         │  (空=完整值)  │
│  link    │  a.card       │  href        │  /product/(\d+) │
│  price   │  .price       │  (空=文本)    │  (\d+)       │
└──────────┴────────────────┴──────────────┴──────────────┘
```

**提取方式 (attr)**：
- 留空 → 提取标签内**文本** (`el.text().trim()`)
- 填写属性名 → 提取标签**属性值** (`el.attr(attr)`)，如 `src`、`href`、`data-url`

**正则截取 (regex)**：
- 留空 → 返回完整值
- 填写正则 → 返回**第一个捕获组** `( )` 的内容

| 原始值 | attr | regex | 结果 |
|--------|------|-------|------|
| `<a href="/product/12345">商品A</a>` | `href` | `/product/(\d+)` | `12345` |
| `<span>共 128 件</span>` | 空 | `(\d+)` | `128` |
| `<h1>完整标题</h1>` | 空 | 空 | `完整标题` |

### 预设模板

**单页模式**：
- 文章模板：title, content, date, author
- 媒体模板：title, media_url

**列表模式**：
- 商品模板：title, price, image, link
- 基础列表：title, date, author

---

## 3. 翻页配置

### 三种模式

| 模式 | 参数 | 停止条件 |
|------|------|---------|
| **不翻页** | 无 | 仅当前页 |
| **按页数** | maxPages | 抓满 N 页停止，0=全部 |
| **按条数** | maxItems | 累计满 N 条停止 |

### 两种翻页方式

**方式一：CSS 选择器翻页**
```
nextPageSelector = ".pagination .next"
→ 在页面中找到匹配的元素 → 提取 href → 跟随链接
```
适用于有独立"下一页"CSS 类的站点。

**方式二：URL 模式翻页（推荐）**
```
urlPattern = "https://example.com/list?page={page}"
pageStart = 1
→ 直接替换 {page} 生成 URL，不依赖页面中的链接
```
适用于分页按钮无独立 CSS 标识、或 URL 有规律递增的站点。

| 配置 | 效果 |
|------|------|
| pageStart=1, maxPages=0 | 从第 1 页开始抓取全部 |
| pageStart=5, maxPages=10 | 从第 5 页开始抓 10 页（页5-14）|
| pageStart=3, maxPages=1 | 只抓第 3 页 |

**翻页结束判断**：
- CSS 模式：`findNextPageUrl` 返回 null → 结束
- URL 模式：下一页返回 404 或 items=0 → 结束
- 硬上限：任何模式不超过 10000 页

**加载更多**（实验性）：
`loadMoreSelector` 填写"加载更多"按钮/链接的 CSS 选择器，适用于链接型加载更多。纯 JS 滚动加载的站点暂不支持。

---

## 4. 详情页提取

列表模式下，可选地对每个列表项进入详情页提取更多字段：

```
列表页 → 提取每个 item（title, link, price…）
         │
         ├─ 提取详情链接: $(detailLinkSelector).attr('href')
         │
         └─ 进入详情页 → parseHtml(detailRules) → 合并数据
```

**配置**：
- `detailLinkSelector`：从列表项中提取详情页链接的选择器（如 `a.title`）
- `detailRules`：详情页的提取规则（如 content、tags、author_bio）

**注意**：详情页数据与列表数据合并，同名字段以详情页为准。

---

## 5. 关键字段指定

用户可以显式指定三个关键字段名，避免代码猜测。在新建/编辑任务的 Step 2 中配置：

| 字段 | 配置项 | 作用 | 未指定时的行为 |
|------|--------|------|---------------|
| 标题字段 | `titleField` | 列表中每条数据的显示标题，支持逗号分隔的多个字段 | 自动查找：title → name → articleTitle → productName → heading → 最长文本 → (无标题) |
| 详情链接字段 | `detailLinkField` | 进入详情页的 URL，支持逗号分隔的多个字段 | 使用 CSS 选择器 `detailLinkSelector` 从 DOM 提取 href |
| 媒体资源字段 | `mediaUrlField` | 视频/音频/图片等媒体 URL，支持逗号分隔的多个字段 | 自动查找：videoUrl → audioUrl → mediaUrl → imageUrl → picUrl → thumbnail → image → url → link |
| 唯一标识字段 | `idField` | 唯一标识每项的字段名（如 `id`、`itemId`），重采/重试时用于精确匹配 | 使用 link → title 匹配 |

### 字段命名规范

系统默认使用**小驼峰命名**（camelCase），推荐在提取规则中也使用小驼峰：

| 推荐 | 不推荐 |
|------|--------|
| `videoUrl` | `video_url` |
| `audioUrl` | `audio_url` |
| `mediaUrl` | `media_url` |
| `imageUrl` | `image_url` |
| `articleTitle` | `article_title` |

用户可以指定逗号分隔的多个字段名，程序按顺序尝试匹配，返回第一个有值的字段。例如：
- `titleField = "title,name,heading"` → 先找 `title`，找不到找 `name`，再找不到找 `heading`
- `mediaUrlField = "videoUrl,audioUrl"` → 先找视频 URL，找不到找音频 URL

### 标题自动查找优先级

采集列表中每条数据显示的标题按以下优先级确定：

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `titleField` 指定 | 用户在任务中指定的字段名 |
| 2 | `title` | 提取规则中名为 `title` 的字段 |
| 3 | `name` | 提取规则中名为 `name` 的字段 |
| 4 | `heading` / `product_name` / `article_title` | 常见标题同义字段 |
| 5 | `text[0]` | 文本数组第一个元素 |
| 6 | URL 文件名 | 从链接 URL 截取 |
| 7 | 前端智能查找 | 在 extra_data 中找最长文本字段 |
| 8 | `(无标题)` | 完全无文本时 |

在新建/编辑任务的 Step 2 中可指定"标题字段"。

---

## 6. 错误容忍与重试

### 三种容错级别

| 行为 | 宽松 (lenient) | 标准 (standard，默认) | 严格 (strict) |
|------|:---:|:---:|:---:|
| 列表页 HTTP 错误 | 跳过，继续下一页 | 重试 2 次→跳过 | 立即终止 |
| 详情页 HTTP 错误 | 跳过该项 | 重试 1 次→跳过 | 立即终止 |
| 首页 404 | 终止 | 终止 | 终止 |
| 非首页 404（URL 模式） | 视为翻页结束 | 视为翻页结束 | 报错终止 |
| 网络错误（DNS/连接） | 跳过 | 重试→跳过 | 终止 |

### 翻页结束 vs 异常判断

```
HTTP 404 + URL模式 + 无限翻页 + 非首页 → 翻页结束（正常完成）
其他情况（首页404、网络错误、500等） → 真实异常（按容错级别处理）
```

### 任务结果统计

完成后 result 包含：
```json
{
  "itemsFound": 100,
  "skippedPages": 1,
  "skippedItems": 3
}
```

---

## 7. 任务状态与操作

### 状态定义

| 状态 | 中文 | 说明 |
|------|------|------|
| `pending` | 未开始 | 任务已创建，等待执行 |
| `running` | 进行中 | 正在采集 |
| `paused` | 已暂停 | 用户暂停，可继续 |
| `completed` | 已完成 | 采集成功完成 |
| `failed` | 执行失败 | 发生错误（严格模式或无法恢复的错误） |
| `cancelled` | 用户终止 | 用户手动终止 |

### 各状态可用操作

| 状态 | 可用操作 |
|------|---------|
| 未开始 | 开始、编辑、删除 |
| 进行中 | 暂停、终止 |
| 已暂停 | 继续(重启)、终止 |
| 已完成 | 查看结果、编辑、删除、重新执行 |
| 执行失败 | 编辑、删除、重试 |
| 用户终止 | 编辑、删除、重新执行 |

### 删除规则

- 可删除：未开始、已完成、执行失败、用户终止
- **不可删除**：进行中、已暂停
- 删除支持**批量**（勾选 + 二次确认 + 仅删除可删状态的）

### 新建任务选项

| 选项 | 默认 | 说明 |
|------|------|------|
| 创建后自动执行 | 关闭 | 开启则创建后立即开始采集 |
| 容错级别 | 标准 | 宽松/标准/严格 |

---

## 8. 单项重试与重采

### 原理

采集时记录了两个关键 URL，使单项重采成为可能：

| 字段 | 来源 | 用途 |
|------|------|------|
| `source_url` | 当前采集时的页面 URL | 定位列表页 |
| `detail_url` | detailLinkSelector 从列表项提取 | 直接抓详情页 |

### 重采流程

```
item.detail_url 是否存在？
  ├─ 是 → 直接 fetch(detail_url) → parseHtml(detailRules) → 详情数据
  │       同时 fetch(source_url) → parseHtml(rules) → findMatchingItem → 列表数据
  │       合并: { ...列表数据, ...详情数据 } ← 详情优先
  │
  └─ 否 → fetch(source_url) → parseHtml(rules) → findMatchingItem → 列表数据
```

### 列表项匹配策略

| 优先级 | 匹配方式 | 可靠性 |
|--------|----------|--------|
| 1 | `idField` 字段精确匹配 | 高（唯一标识不会变） |
| 2 | `link` 字段完全相等 | 高（URL 唯一） |
| 3 | `title` 字段完全相等 | 中（可能变化） |

### 前端按钮

| 项状态 | 按钮 |
|--------|------|
| 已采集 (`crawled`) | 查看 / **重采** / 删除 |
| 错误 (`error`) | 查看 / **重试** / 删除 |

- **重试**：失败的项 → 重新抓取 → 成功后恢复 `crawled`
- **重采**：成功的项 → 刷新数据 → 获取最新内容
- 两者后端逻辑相同，差异仅在前端显示条件和提示文案

---

## 9. 实时更新 (SSE)

### 架构

```
后端 processCrawlTask()
  ├─ updateTaskStatus('running')  ─→ SSE: { status:'running', progress:0... }
  ├─ updateTaskProgress(50)       ─→ SSE: { status:'running', progress:50... }
  └─ updateTaskResult(...)        ─→ SSE: { status:'completed', progress:100... }
                                      │
前端 EventSource('/api/crawler/events') ← 后端绝对地址
  ├─ 收到事件 → Object.assign(tasks[idx], { status, progress, started_at, ... })
  ├─ 终端状态 → refreshItemCounts() 刷新采集数
  └─ 断线 → 3 秒自动重连
```

### 更新内容

| 事件触发 | 更新内容 |
|----------|---------|
| 状态变更 | status、操作按钮自动切换 |
| 进度更新 | 进度条实时变化 |
| 任务完成 | status→completed、采集数刷新、按钮切换 |
| 任务删除 | 表格行自动移除 |

### 注意事项

- SSE URL 必须使用后端绝对地址 (`VITE_API_BASE_URL`)，不能用相对路径
- 任务创建不触发 SSE，由前端 `refresh()` 获取初始列表
- 采集数（itemCounts）在任务到达终端/暂停状态时通过 `refreshItemCounts()` 异步更新
