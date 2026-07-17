# 代码审查整改落地 — 2026-07-16

## 决策
用户原话："暂时不需要鉴权，后面再考虑；其他的按整理内容建议调整"。
→ **跳过 S1 鉴权**（后续再议），其余审查建议全部落地。

## 已实施的改动（提交 `ea4bed1`，13 文件，+99/−358，未推送）

### 安全
- **S2 SSRF**：`crawler.service.ts` 的 `fetchHtml` 新增 `isBlockedHost`，屏蔽 `localhost`/`.local`/`.internal`、私网/回环/链路本地/组播/云元数据网段（10/127/0/224+/169.254/172.16‑31/192.168），并强制 http(s) 协议白名单。
- **S3 超时**：`fetchHtml` 加 `AbortController` 15s 超时，防止慢站卡死 `processCrawlTask` 的 while 循环。

### 死代码清理（grep 引用验证为零后删除）
- 删除孤儿端点 `TasksController`（`/api/tasks`）+ 零引用的 `url.util.ts`。
- 移除 `QueueService.getPendingTasks/getRunningTasks`、`SseService.emitEvent/getGenericStream`（SSE 端点去掉 generic 流合并）、`UrlTransform.downloadMethod` + `YtDlpOptions`/`QUALITY_PRESET_FORMATS`、`CrawlPayload` 的 auto* 标志、`date.util` 的 `formatDisplay`/`nowMs`、前端 `cancelItem`/`cancelCrawlItem` 死函数与不可达的状态筛选。

### 真实 Bug 修复
- **B1**：删除永远不可达的"取消采集"按钮与 `items/:id/cancel` 端点（item 的 `processing` 是幽灵状态，server 端插入即 `crawled`）。

### 健壮性
- **B2**：不限页 `urlPattern` 改为**首页空页即停**，防止刷到 10000 上限。
- **B3**：`res.download` 回调中 `fs.unlink` 清理临时 xlsx。
- **B4**：新增轻量 `GET /api/crawler/items/counts`（支持 `taskIds` 过滤）；前端 `CrawlerTasks.refreshItemCounts` 改为调用它，不再拉全量 items 计数。
- **UI/文档**：Dashboard 5 列网格→4 列；CLAUDE.md 删除 `url.util` 过时小节。

## 验证结果
- `pnpm --filter server build`：0 TS issues；`pnpm --filter web build`：通过。
- `pnpm dev` 跑通后 curl 验证：
  - `GET /api/crawler/tasks` → 200，返回 **5** 条种子任务。
  - `GET /api/crawler/items/counts` → 200，按任务计数正确。
  - SSRF 在 `fetchHtml` 内部强制（无独立测试路由），经代码核查生效。
- 停止 dev 实例并按端口 3000/5173 递归清理进程树，端口已释放（避免占端口/锁 db）。

## 需知会事项
- 种子任务数从之前的 3 变为 **5**：`database.service.ts` 的 seedDefaults 后又加入了 2 个英文站任务（普诺赛英文站视频采集、英文站宣传册采集），属有意为之，非数据漂移。其中任务 3/4 当前无 items（尚未跑采集）。
- S1（鉴权）按用户决策推迟，未处理。
