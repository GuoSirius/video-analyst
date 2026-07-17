# 采集列表导出：恢复「按任务分组」

## 背景
用户记得"批量导出按任务划分（一个任务一个文件/sheet）"，但在采集列表页看不到这个逻辑。

经核查：按任务分组功能**一直存在**，只是挂在**任务页**（`CrawlerTasks.vue` → `POST /crawler/export`）。
采集列表页走的 `POST /crawler/export-items` 把所有勾选项混进**一个 sheet**。

git 证实：列表页自 `e5b6f9f` 引入多选起就一直用 `export-items`，从未调用过分组版——不是"逻辑变了"，而是两页两套独立导出。

## 改动（提交 `047e461`，未推送）
| 文件 | 改动 |
|---|---|
| `server/src/crawler/crawler.controller.ts` | `exportItems` 重写：按 `task_id` 分组、**只导出勾选的 itemIds**（不拉整任务） |
| `web/src/api/modules/crawler.ts` | `exportItems` 入参加 `multiFile?: boolean` |
| `web/src/pages/CrawlerItems.vue` | `selectedItemsMeta` 补 `task_id`；导出弹窗加「单文件多Sheet/多文件」切换；`loadExportFields` 的 taskIds 同时取自 `selectedItemsMeta`（覆盖跨任务离屏选中）；`doExport` 传 `multiFile` |

## 跨任务输出形态
- **excel + 单文件多Sheet**（默认）：一个 xlsx，每任务一个 sheet
- **excel + 多文件**：zip，每任务一个独立 .xlsx
- **json / yaml**：按任务名分组对象
- **csv**：zip，每任务一个 .csv
- 单任务：保持原有单文件行为

## 验证（重启 dev 加载新后端，实测）
样例：跨 2 个任务各勾 2 条（共 4 条）。
- `multiFile:true` → 返回 zip，含 `普诺赛英文站宣传册采集.xlsx` + `普诺赛中文站实验操作指南.xlsx`
- `multiFile:false` → 返回单 xlsx，含 2 个同名 sheet
- 行数核对：每任务导出 **2 行数据**（非整任务 13 行）→ 确认"只导出勾选"

## 使用方式
采集列表页勾选多项（可跨任务，因选中已改为全局保持）→ 点批量导出 → 选格式 →
跨任务且非 csv 时出现「单文件多Sheet / 多文件」开关 → 导出。
