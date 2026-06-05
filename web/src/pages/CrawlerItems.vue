<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick, reactive } from 'vue'
import { useRoute } from 'vue-router'
import { crawlerAPI } from '../api'
import { usePagination } from '../composables/usePagination'
import { ElMessage, ElMessageBox } from 'element-plus'

const route = useRoute()

// --- State ---
const tasks = ref<any[]>([])
const items = ref<any[]>([])
const selectedTaskId = ref((route.query.taskId as string) || '')
const statusFilter = ref('all')
const typeFilter = ref('all')
const sourceFilter = ref('all')
const keyword = ref('')
let sseConnection: EventSource | null = null
const selectedIds = ref<string[]>([])
const selectedItemsMeta = reactive<Record<string, any>>({})
const tableRef = ref<any>(null)
let syncingSelection = false
const detailItem = ref<any>(null)
const detailVisible = ref(false)
const detailViewMode = ref<'table' | 'json'>('table')

// Pagination
const { page, pageSize, total, pageSizes, onPageChange, onPageSizeChange } = usePagination({
  defaultPageSize: 20,
  onFetch: () => fetchItems(),
})
const loading = ref(false)

// --- Task actions ---
async function startTask(id: string) {
  try { await crawlerAPI.startTask(id); ElMessage.success('任务已开始'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function pauseTask(id: string) {
  try { await crawlerAPI.pauseTask(id); ElMessage.success('任务已暂停'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要终止此任务吗？', '确认', { type: 'warning' })
    await crawlerAPI.stopTask(id); ElMessage.success('任务已终止'); refresh()
  } catch { /* cancelled */ }
}
async function retryTask(id: string) {
  try { await crawlerAPI.retryTask(id); ElMessage.success('已重新加入队列'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function reRunTask(id: string) {
  try {
    await ElMessageBox.confirm('重新执行将清除已有的采集数据并从头开始。', '确认', { type: 'warning' })
    await crawlerAPI.reRunTask(id); ElMessage.success('任务已重新执行'); refresh()
  } catch { /* cancelled */ }
}
async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此任务及所有采集数据吗？', '确认删除', { type: 'warning' })
    await crawlerAPI.deleteTask(id); ElMessage.success('任务已删除'); refresh()
  } catch { /* cancelled */ }
}

async function clearItems(id: string) {
  try {
    const task = tasks.value.find((t: any) => t.id === id)
    const name = task?.payload?.name || task?.payload?.url || id.slice(0, 8)
    await ElMessageBox.confirm(`确定要清空任务「${name}」下的所有采集项吗？采集任务本身不会被删除。`, '清空采集项', { type: 'warning' })
    await crawlerAPI.clearItems(id)
    ElMessage.success('已清空所有采集项')
    refresh()
  } catch { /* cancelled */ }
}

// --- Data ---
async function refresh() {
  // Always refresh tasks
  const { data: tData } = await crawlerAPI.getTasks(keyword.value)
  tasks.value = tData
  // Refresh items with filters
  await fetchItems()
}

async function fetchItems() {
  loading.value = true
  try {
    const params: any = {
      page: page.value,
      pageSize: pageSize.value,
    }
    if (selectedTaskId.value) params.taskId = selectedTaskId.value
    if (statusFilter.value !== 'all') params.status = statusFilter.value
    if (typeFilter.value !== 'all') params.mediaType = typeFilter.value
    if (sourceFilter.value !== 'all') params.mediaSource = sourceFilter.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()

    const { data } = await crawlerAPI.getItems(params)
    items.value = data.data
    total.value = data.total
    await nextTick()
    syncTableSelection()
  } catch {
    ElMessage.error('获取数据失败')
  }
  loading.value = false
}

async function refreshItemsOnly() {
  await fetchItems()
}

// ── Batch item operations ──
function findSelected(id: string) { return items.value.find((x: any) => x.id === id) || selectedItemsMeta[id] }
const deletableItemIds = computed(() => selectedIds.value)
const crawlableItemIds = computed(() => selectedIds.value.filter(id => { const item = findSelected(id); return item && item.status === 'pending' }))
const recrawlableItemIds = computed(() => selectedIds.value.filter(id => { const item = findSelected(id); return item && (item.status === 'crawled' || item.status === 'error') }))
const importableItemIds = computed(() => selectedIds.value.filter(id => { const item = findSelected(id); return item && item.status === 'crawled' && !item.download_status }))
const reimportableItemIds = computed(() => selectedIds.value.filter(id => { const item = findSelected(id); return item && item.status === 'crawled' && item.download_status === 'imported' }))
const pipelineableItemIds = computed(() => selectedIds.value.filter(id => { const item = findSelected(id); return item && item.status === 'crawled' }))

async function batchDeleteItems() {
  const ids = deletableItemIds.value
  if (!ids.length) { ElMessage.warning('请先勾选要删除的采集项'); return }
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${ids.length} 个采集项吗？`, '批量删除确认', { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' })
    await crawlerAPI.batchDeleteItems(ids)
    ElMessage.success(`已删除 ${ids.length} 个采集项`)
    for (const id of selectedIds.value) delete selectedItemsMeta[id]
    selectedIds.value = []
    refresh()
  } catch { /* cancelled */ }
}

async function batchCrawlItems() {
  const ids = crawlableItemIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有待采集的项'); return }
  try {
    await ElMessageBox.confirm(`确定要对选中的 ${ids.length} 个待采集项执行采集吗？`, '批量采集确认', { type: 'info', confirmButtonText: '确定采集', cancelButtonText: '取消' })
    const res = await crawlerAPI.batchCrawlItems(ids)
    const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0
    ElMessage.success(`已采集 ${okCount} 个项`)
    refresh()
  } catch { /* cancelled */ }
}

async function batchRecrawlItems() {
  const ids = recrawlableItemIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有可重采的项（只能重采已采集/采集失败状态）'); return }
  try {
    await ElMessageBox.confirm(`确定要对选中的 ${ids.length} 个项执行重采吗？`, '批量重采确认', { type: 'info', confirmButtonText: '确定重采', cancelButtonText: '取消' })
    const res = await crawlerAPI.batchRecrawlItems(ids)
    const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0
    ElMessage.success(`已重采 ${okCount} 个项`)
    refresh()
  } catch { /* cancelled */ }
}

async function batchImportDownload() {
  const ids = importableItemIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有可带入下载的项（需要已采集且未带入）'); return }
  try {
    await ElMessageBox.confirm(`确定要将选中的 ${ids.length} 个采集项带入下载队列吗？`, '批量带入下载确认', { type: 'info', confirmButtonText: '确定带入', cancelButtonText: '取消' })
    const res = await crawlerAPI.batchImportDownload(ids)
    const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0
    ElMessage.success(`已带入 ${okCount} 个项到下载队列`)
    refresh()
  } catch { /* cancelled */ }
}

async function batchReimportDownload() {
  const ids = reimportableItemIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有可重新带入的项（需要已带入状态）'); return }
  try {
    await ElMessageBox.confirm(`确定要将选中的 ${ids.length} 个采集项重新带入下载队列吗？旧的下载记录将被清除。`, '批量重新带入确认', { type: 'warning', confirmButtonText: '确定重新带入', cancelButtonText: '取消' })
    const res = await crawlerAPI.batchImportDownload(ids, true)
    const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0
    ElMessage.success(`已重新带入 ${okCount} 个项到下载队列`)
    refresh()
  } catch { /* cancelled */ }
}

async function batchItemsAutoPipeline() {
  const ids = pipelineableItemIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有可执行流水线的项（需要已采集状态）'); return }
  try {
    await ElMessageBox.confirm(
      `将对选中的 ${ids.length} 个采集项一键自动执行后续流水线：\n\n① 带入下载队列 → ② FFmpeg转码(16kHz WAV) → ③ Whisper语音识别 → ④ AI分析总结\n\n系统将自动开启全自动模式，各环节按顺序自动流转。`,
      '一键自动执行后续流程',
      { type: 'info', confirmButtonText: '开始执行', cancelButtonText: '取消' },
    )
    const res = await crawlerAPI.batchItemsAutoPipeline(ids)
    const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0
    const failCount = res.data?.filter?.((r: any) => !r.ok)?.length ?? 0
    if (failCount) { ElMessage.warning(`成功 ${okCount} 个，${failCount} 个失败`) }
    else { ElMessage.success(`已启动 ${okCount} 个项的完整流水线`) }
    refresh()
  } catch { /* cancelled */ }
}

// ── Export (item-level) ──
const exportDialogVisible = ref(false)
const exportFormat = ref<'json' | 'yaml' | 'csv' | 'excel'>('excel')
const exportIncludeTranscriptions = ref(false)
const exportIncludeAIResults = ref(false)
const exportFields = ref<{ key: string; alias: string; selected: boolean }[]>([])
const exportFieldGroups = ref<{ dbFields: any[]; transcriptionFields: any[]; aiFields: any[]; extraFields: any[] }>({ dbFields: [], transcriptionFields: [], aiFields: [], extraFields: [] })
const exportLoading = ref(false)

function openExportDialog() {
  const ids = selectedIds.value
  if (!ids.length) { ElMessage.warning('请先勾选要导出的采集项'); return }
  exportDialogVisible.value = true
  exportFormat.value = 'excel'
  exportIncludeTranscriptions.value = false
  exportIncludeAIResults.value = false
  loadExportFields()
}

async function loadExportFields() {
  try {
    const itemTasks = new Set<string>()
    items.value.filter((i: any) => selectedIds.value.includes(i.id)).forEach((i: any) => { if (i.task_id) itemTasks.add(i.task_id) })
    const taskIds = Array.from(itemTasks)
    if (!taskIds.length) return
    const { data } = await crawlerAPI.getExportFields(taskIds)
    exportFieldGroups.value = data
    // Build field list from API response, select all by default
    const all: { key: string; alias: string; selected: boolean }[] = []
    for (const g of [data.dbFields, data.extraFields, data.transcriptionFields, data.aiFields]) {
      for (const f of (g || [])) {
        all.push({ key: f.key, alias: '', selected: true })
      }
    }
    exportFields.value = all
  } catch { /* ignore */ }
}

function toggleAllExportFields(selected: boolean) {
  exportFields.value.forEach(f => { f.selected = selected })
}

async function doExport() {
  const selectedFields = exportFields.value.filter(f => f.selected)
  if (!selectedFields.length) { ElMessage.warning('请至少选择一个导出字段'); return }
  const itemIds = selectedIds.value
  exportLoading.value = true
  try {
    const res = await crawlerAPI.exportItems({
      itemIds,
      format: exportFormat.value,
      fields: selectedFields.map(f => ({ key: f.key, alias: f.alias || f.key })),
      includeTranscriptions: exportIncludeTranscriptions.value,
      includeAIResults: exportIncludeAIResults.value,
    })
    const blob = res.data
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const extMap: Record<string, string> = { json: 'json', yaml: 'yaml', csv: 'csv', excel: 'xlsx' }
    a.download = `export_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${extMap[exportFormat.value]}`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
    exportDialogVisible.value = false
  } catch { ElMessage.error('导出失败') }
  exportLoading.value = false
}

// ════════════════════════════════════════════════════════════════

function showDetail(row: any) {
  let extra: Record<string, any> = {}
  try { extra = typeof row.extra_data === 'string' ? JSON.parse(row.extra_data) : (row.extra_data || {}) }
  catch { extra = {} }
  detailItem.value = { ...row, extra }
  detailViewMode.value = 'table'
  detailVisible.value = true
}

function expectedFields(item: any): string[] {
  const task = tasks.value.find((t: any) => t.id === item.task_id)
  if (!task?.payload?.rules) return []
  return task.payload.rules
    .filter((r: any) => r.name)
    .map((r: any) => r.name)
    .filter((n: string) => !['title', 'media_url', 'video_url', 'audio_url', 'url'].includes(n))
}

function extraFields(item: any): [string, any][] {
  if (!item.extra_data) return []
  try {
    const data = typeof item.extra_data === 'string' ? JSON.parse(item.extra_data) : item.extra_data
    return Object.entries(data || {}).filter(([k]) => !['title', 'media_url', 'video_url', 'audio_url', 'url'].includes(k))
  } catch { return [] }
}

function formatValue(v: any): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

function isEmpty(v: any): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')
}

async function deleteItem(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此采集项吗？', '确认删除', { type: 'warning' })
    await crawlerAPI.deleteItem(id)
    ElMessage.success('已删除')
    refresh()
  } catch { /* cancelled */ }
}

async function cancelCrawlItem(id: string) {
  try {
    await ElMessageBox.confirm('确定要取消采集该项吗？', '确认', { type: 'warning' })
    await crawlerAPI.cancelItem(id)
    ElMessage.success('已取消采集')
    refresh()
  } catch { /* cancelled */ }
}

async function retrySingleItem(id: string) {
  try {
    await ElMessageBox.confirm('将重新抓取该项数据（仅该项，不影响其他）。确定继续？', '确认', { type: 'info' })
    const res = await crawlerAPI.recrawlItem(id)
    if (res.data?.error) { ElMessage.error(res.data.error) }
    else { ElMessage.success('已重新抓取'); refreshItemsOnly() }
  } catch { ElMessage.error('操作失败') }
}

async function recrawlSingleItem(id: string) {
  try {
    await ElMessageBox.confirm('将重新抓取该项数据。确定继续？', '确认', { type: 'info' })
    const res = await crawlerAPI.recrawlItem(id)
    if (res.data?.error) { ElMessage.error(res.data.error) }
    else { ElMessage.success('已重新抓取'); refreshItemsOnly() }
  } catch { ElMessage.error('操作失败') }
}

function copyJson() {
  if (!detailItem.value) return
  const obj: Record<string, any> = {
    title: detailItem.value.title,
    media_url: detailItem.value.media_url,
    media_type: detailItem.value.media_type,
    media_source: detailItem.value.media_source,
    source_url: detailItem.value.source_url,
    ...detailItem.value.extra,
  }
  navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
  ElMessage.success('已复制到剪贴板')
}

// 获取所有来源选项（从已加载数据中收集）
const sourceOptions = computed(() => {
  const sources = new Set<string>()
  items.value.forEach((i: any) => {
    if (i.media_source) sources.add(i.media_source)
  })
  return Array.from(sources).sort()
})

const currentTask = computed(() => {
  if (!selectedTaskId.value) return null
  return tasks.value.find((t: any) => t.id === selectedTaskId.value)
})

// 任务ID到名称的映射（用于显示）
const taskNameMap = computed(() => {
  const m: Record<string, string> = {}
  tasks.value.forEach((t: any) => {
    m[t.id] = t.payload?.name || t.payload?.url || t.id.slice(0, 8)
  })
  return m
})

// Watch filters — reset page via composable, then fetch
watch([selectedTaskId, statusFilter, typeFilter, sourceFilter, keyword], () => {
  page.value = 1
  fetchItems()
})

function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: '未开始', running: '进行中', completed: '已完成',
    failed: '执行失败', cancelled: '用户终止', paused: '已暂停',
  }
  return map[s] || s
}

function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canPause(s: string) { return s === 'running' }
function canStop(s: string) { return s === 'running' || s === 'paused' }
function canRetry(s: string) { return s === 'failed' }
function canReRun(s: string) { return s === 'completed' || s === 'cancelled' }
function canDelete(s: string) { return s === 'pending' || s === 'completed' || s === 'failed' || s === 'cancelled' }

function itemStatusLabel(s: string) {
  const map: Record<string, string> = {
    pending: '待采集', processing: '采集中', crawled: '已采集', error: '采集失败',
  }
  return map[s] || s || '未知'
}

function handleSelectionChange(rows: any[]) {
  if (syncingSelection) return
  const visibleIds = new Set(items.value.map((i: any) => i.id))
  const newSelected = new Map(rows.map((r: any) => [r.id, r]))
  // Remove deselected visible rows
  for (const id of visibleIds) {
    if (!newSelected.has(id)) {
      selectedIds.value = selectedIds.value.filter(x => x !== id)
      delete selectedItemsMeta[id]
    }
  }
  // Add newly selected visible rows
  for (const [id, row] of newSelected) {
    if (!selectedIds.value.includes(id)) {
      selectedIds.value.push(id)
    }
    selectedItemsMeta[id] = { id, status: row.status, download_status: row.download_status }
  }
}
async function clearAllSelections() {
  try {
    await ElMessageBox.confirm(`确定要清空全部 ${selectedIds.value.length} 个选择吗？`, '清空选择', { type: 'warning', confirmButtonText: '确定清空', cancelButtonText: '取消' })
    for (const id of selectedIds.value) delete selectedItemsMeta[id]
    selectedIds.value = []
    tableRef.value?.clearSelection()
  } catch { /* cancelled */ }
}

function resetFilters() {
  keyword.value = ''
  selectedTaskId.value = ''
  typeFilter.value = 'all'
  sourceFilter.value = 'all'
  statusFilter.value = 'all'
  page.value = 1
  fetchItems()
}

function syncTableSelection() {
  if (!tableRef.value) return
  syncingSelection = true
  items.value.forEach((row: any) => {
    if (selectedIds.value.includes(row.id)) {
      tableRef.value.toggleRowSelection(row, true)
    }
  })
  syncingSelection = false
}

// 根据采集状态判断操作按钮
function canCrawl(s: string) { return s === 'pending' }
function canCancelCrawl(s: string) { return s === 'processing' }
function canRecrawl(s: string) { return s === 'error' || s === 'crawled' }

// 导入下载：将采集项的媒体资源拆分为下载任务
async function importToDownload(id: string, retry = false) {
  try {
    if (retry) {
      await ElMessageBox.confirm('将采集项重新加入到下载队列中', '确认', { type: 'info' })
    } else {
      await ElMessageBox.confirm('将采集项的媒体资源加入到下载队列中', '确认', { type: 'info' })
    }
    const res = await crawlerAPI.importToDownloadQueue(id, retry)
    if (res.data?.error) { ElMessage.error(res.data.error) }
    else {
      ElMessage.success(retry ? '已重新加入下载队列' : '已加入下载队列')
      // 直接刷新当前页数据，确保与后端状态一致
      await fetchItems()
    }
  } catch { ElMessage.error('操作失败') }
}

// 下载状态标签
function downloadStatusLabel(s: string) {
  const map: Record<string, string> = {
    imported: '已带入',
  }
  return map[s] || s || '未带入'
}

/** When title is empty, pick the best display field from extra_data */
function pickDisplayField(item: any): string {
  try {
    const extra = item.extra_data
    if (!extra) return ''
    const data = typeof extra === 'string' ? JSON.parse(extra) : extra
    if (!data || typeof data !== 'object') return ''
    const entries = Object.entries(data) as [string, any][]
    if (!entries.length) return ''
    // Prefer fields that look like titles: longer text, not URLs, not numbers
    const urlPattern = /^https?:\/\//
    const textFields = entries.filter(([_, v]) =>
      typeof v === 'string' && v.length > 1 && !urlPattern.test(v)
    )
    if (textFields.length) {
      // Sort by length descending — longest text is likely the title
      textFields.sort((a, b) => (b[1] as string).length - (a[1] as string).length)
      const val = textFields[0][1] as string
      return val.length > 80 ? val.slice(0, 80) + '…' : val
    }
    // Fallback: use any non-empty value that's not a URL
    const anyField = entries.find(([_, v]) => typeof v === 'string' && v && !urlPattern.test(v))
    return anyField ? (anyField[1] as string).slice(0, 80) : ''
  } catch {
    return ''
  }
}

watch(selectedTaskId, () => { for (const id of selectedIds.value) delete selectedItemsMeta[id]; selectedIds.value = []; tableRef.value?.clearSelection() })

// SSE real-time updates — must use full backend URL (EventSource doesn't go through axios)
const SSE_URL = `${import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api'}/crawler/events`

function setupSSE() {
  if (sseConnection) sseConnection.close()
  sseConnection = new EventSource(SSE_URL)
  sseConnection.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data)
      if (evt.type === 'crawl') {
        const idx = tasks.value.findIndex((t: any) => t.id === evt.taskId)
        if (idx !== -1) {
          if (evt.status === 'deleted') {
            tasks.value.splice(idx, 1)
          } else {
            Object.assign(tasks.value[idx], {
              status: evt.status,
              progress: evt.progress,
              result: evt.result,
              error: evt.error,
              started_at: evt.started_at || tasks.value[idx].started_at,
              updated_at: evt.updated_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
            })
            // Refresh items when task produces/stops with data
            if (['completed', 'failed', 'cancelled', 'paused'].includes(evt.status)) {
              refreshItemsOnly()
            }
            // Also refresh task list to update item counts
            if (['completed', 'failed', 'cancelled', 'paused'].includes(evt.status)) {
              crawlerAPI.getTasks().then(({ data }) => { tasks.value = data })
            }
          }
        } else if (evt.status !== 'deleted') {
          refresh()
        }
      } else if (evt.type === 'download') {
        // 下载完成后刷新列表（仅当需要查看带入结果时）
        // download_status 只表示是否已带入，不跟踪下载状态
      }
    } catch { /* ignore */ }
  }
  sseConnection.onerror = () => {
    sseConnection?.close()
    setTimeout(setupSSE, 3000)
  }
}

function teardownSSE() {
  sseConnection?.close()
  sseConnection = null
}

onMounted(() => {
  refresh()
  setupSSE()
})
onUnmounted(teardownSSE)
</script>

<template>
  <div class="px-7 py-6">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">采集结果</h2>
        <p class="text-[13px] text-gray-500">查看和管理所有采集到的结构化数据</p>
      </div>
      <div class="flex items-center gap-2">
        <el-button v-if="pipelineableItemIds.length" type="success" size="small" plain @click="batchItemsAutoPipeline">
          <i class="fas fa-forward-step mr-1.5"></i>一键自动执行后续流程 ({{ pipelineableItemIds.length }})
        </el-button>
        <el-button v-if="crawlableItemIds.length" type="primary" size="small" plain @click="batchCrawlItems">
          <i class="fas fa-play mr-1.5"></i>批量采集 ({{ crawlableItemIds.length }})
        </el-button>
        <el-button v-if="recrawlableItemIds.length" size="small" plain @click="batchRecrawlItems">
          <i class="fas fa-rotate-right mr-1.5"></i>批量重采 ({{ recrawlableItemIds.length }})
        </el-button>
        <el-button v-if="importableItemIds.length" type="success" size="small" plain @click="batchImportDownload">
          <i class="fas fa-download mr-1.5"></i>批量带入下载 ({{ importableItemIds.length }})
        </el-button>
        <el-button v-if="reimportableItemIds.length" type="warning" size="small" plain @click="batchReimportDownload">
          <i class="fas fa-repeat mr-1.5"></i>批量重新带入 ({{ reimportableItemIds.length }})
        </el-button>
        <el-button v-if="deletableItemIds.length" type="danger" size="small" plain @click="batchDeleteItems">
          <i class="fas fa-trash-can mr-1.5"></i>批量删除 ({{ deletableItemIds.length }})
        </el-button>
        <el-button v-if="selectedIds.length" type="info" size="small" plain @click="openExportDialog">
          <i class="fas fa-download mr-1.5"></i>导出 ({{ selectedIds.length }})
        </el-button>
      </div>
    </div>

    <!-- Task info bar -->
    <div v-if="currentTask" class="card-static mb-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <span class="text-sm font-semibold text-gray-200">
            {{ currentTask.payload?.name || currentTask.payload?.url || currentTask.id.slice(0, 12) }}
          </span>
          <span class="badge" :class="{
            'badge-completed': currentTask.status === 'completed',
            'badge-running': currentTask.status === 'running',
            'badge-failed': currentTask.status === 'failed',
            'badge-paused': currentTask.status === 'paused',
            'badge-pending': currentTask.status === 'pending',
            'badge-cancelled': currentTask.status === 'cancelled',
          }">{{ statusLabel(currentTask.status) }}</span>
          <el-progress :percentage="currentTask.progress" :stroke-width="5" class="!w-32"
            :status="currentTask.status === 'failed' ? 'exception' : currentTask.status === 'completed' ? 'success' : undefined" />
        </div>
        <div class="flex items-center gap-1">
          <el-button v-if="canStart(currentTask.status)" size="small" type="primary" plain @click="startTask(currentTask.id)">
            {{ currentTask.status === 'paused' ? '继续' : '开始' }}
          </el-button>
          <el-button v-if="canPause(currentTask.status)" size="small" type="warning" plain @click="pauseTask(currentTask.id)">暂停</el-button>
          <el-button v-if="canStop(currentTask.status)" size="small" type="danger" plain @click="stopTask(currentTask.id)">终止</el-button>
          <el-button v-if="canRetry(currentTask.status)" size="small" type="warning" plain @click="retryTask(currentTask.id)">重试</el-button>
          <el-button v-if="canReRun(currentTask.status)" size="small" plain @click="reRunTask(currentTask.id)">重新执行</el-button>
          <el-button v-if="canDelete(currentTask.status)" size="small" type="danger" plain @click="deleteTask(currentTask.id)">删除</el-button>
          <el-button v-if="canDelete(currentTask.status)" size="small" plain @click="clearItems(currentTask.id)">清空采集项</el-button>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center justify-between mb-4 card-static">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">搜索：</span>
          <el-input v-model="keyword" size="small" placeholder="搜索标题/媒体URL/源URL/字段内容" clearable @keyup.enter="page=1;fetchItems()" @clear="page=1;fetchItems()" class="!w-56" />
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">任务：</span>
          <el-select v-model="selectedTaskId" placeholder="全部任务" size="small" class="!w-52" clearable>
            <el-option
              v-for="t in tasks" :key="t.id"
              :label="`${t.payload?.name || t.payload?.url || t.id.slice(0, 8)}`"
              :value="t.id"
            />
          </el-select>
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">类型：</span>
          <el-select v-model="typeFilter" size="small" class="!w-20">
            <el-option label="全部" value="all" />
            <el-option label="视频" value="video" />
            <el-option label="音频" value="audio" />
            <el-option label="图片" value="image" />
            <el-option label="链接" value="link" />
            <el-option label="文本" value="text" />
          </el-select>
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">来源：</span>
          <el-select v-model="sourceFilter" size="small" class="!w-24">
            <el-option label="全部" value="all" />
            <el-option v-for="s in sourceOptions" :key="s" :label="s" :value="s" />
          </el-select>
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">状态：</span>
          <el-select v-model="statusFilter" size="small" class="!w-24">
            <el-option label="全部" value="all" />
            <el-option label="待采集" value="pending" />
            <el-option label="采集中" value="processing" />
            <el-option label="已采集" value="crawled" />
            <el-option label="采集失败" value="error" />
            <el-option label="未带入" value="not_imported" />
            <el-option label="已带入" value="imported" />
          </el-select>
        </span>
        <span class="inline-flex items-center gap-1">
          <el-button size="small" plain @click="page=1;fetchItems()"><i class="fas fa-search mr-1"></i>搜索</el-button>
          <el-button size="small" plain @click="resetFilters"><i class="fas fa-undo mr-1"></i>重置</el-button>
          <el-button size="small" plain @click="fetchItems()"><i class="fas fa-sync-alt mr-1"></i>刷新</el-button>
          <el-button v-if="selectedIds.length" size="small" plain type="warning" @click="clearAllSelections"><i class="fas fa-times-circle mr-1"></i>清空选择 ({{ selectedIds.length }})</el-button>
        </span>
      </div>
    </div>

    <!-- Items Table -->
    <div class="card-static">
      <el-table
        v-if="items.length"
        ref="tableRef"
        :data="items"
        size="small"
        max-height="500"
        @selection-change="handleSelectionChange"
        row-key="id"
      >
        <el-table-column type="selection" width="40" fixed="left" :reserve-selection="true" />
        <el-table-column type="index" label="序号" width="55" align="center" fixed="left" />
        <el-table-column label="所属任务" width="130" show-overflow-tooltip fixed="left">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ taskNameMap[row.task_id] || row.task_id?.slice(0, 8) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="标题" show-overflow-tooltip min-width="160" fixed="left">
          <template #default="{ row }">
            <span class="text-xs text-gray-300">{{ row.title || pickDisplayField(row) || '(无标题)' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <span class="text-xs" :class="row.media_type === 'video' ? 'text-blue-400' : row.media_type === 'audio' ? 'text-emerald-400' : 'text-gray-500'">
              {{ row.media_type || '-' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="90">
          <template #default="{ row }">
            <span class="text-xs text-gray-400">{{ row.media_source || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="采集状态" width="110">
          <template #default="{ row }">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs" :class="{
                'text-emerald-400': row.status === 'crawled',
                'text-yellow-400': row.status === 'pending',
                'text-blue-400': row.status === 'processing',
                'text-red-400': row.status === 'error',
                'text-gray-500': !row.status,
              }">{{ itemStatusLabel(row.status) }}</span>
              <span class="text-[10px]" :class="{
                'text-gray-500': !row.download_status || row.status !== 'crawled',
                'text-emerald-400': row.download_status === 'imported' && row.status === 'crawled',
              }">{{ row.status === 'crawled' ? downloadStatusLabel(row.download_status) : '' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="数据字段" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ extraFields(row).map(([k]) => k).join(' / ') || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="采集时间" width="150">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="200" align="center" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <el-button size="small" type="primary" plain @click="showDetail(row)">查看</el-button>
              <!-- 待采集 -->
              <el-button v-if="canCrawl(row.status)" size="small" plain @click="retrySingleItem(row.id)">采集</el-button>
              <!-- 采集中 -->
              <el-button v-if="canCancelCrawl(row.status)" size="small" type="warning" plain @click="cancelCrawlItem(row.id)">取消采集</el-button>
              <!-- 已采集：重采、带入下载/重新带入、删除 -->
              <template v-if="row.status === 'crawled'">
                <el-button size="small" plain @click="recrawlSingleItem(row.id)">重采</el-button>
                <el-button v-if="!row.download_status" size="small" type="success" plain @click="importToDownload(row.id)">带入下载</el-button>
                <el-button v-else size="small" type="warning" plain @click="importToDownload(row.id, true)">重新带入</el-button>
              </template>
              <!-- 采集失败：重采、删除 -->
              <el-button v-if="canRecrawl(row.status) && row.status === 'error'" size="small" type="warning" plain @click="retrySingleItem(row.id)">重采</el-button>
              <el-button size="small" type="danger" plain @click="deleteItem(row.id)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="total > 0" class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizes"
          :total="total"
          layout="total, sizes, prev, pager, next"
          size="small"
          background
          @size-change="onPageSizeChange"
          @current-change="onPageChange"
        />
      </div>
      <div v-if="!items.length && !loading" class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-table text-3xl mb-3 block opacity-30"></i>
        {{ selectedTaskId ? '该任务暂无采集结果' : '暂无采集数据，请先在任务列表中创建并运行采集任务' }}
      </div>
    </div>

    <!-- Detail Dialog -->
    <el-dialog v-model="detailVisible" title="采集结果详情" width="700px" destroy-on-close :close-on-click-modal="false">
      <div v-if="detailItem" class="space-y-4">
        <!-- Toolbar -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <el-button size="small" :type="detailViewMode === 'table' ? 'primary' : 'default'" plain @click="detailViewMode = 'table'">
              <i class="fas fa-table mr-1"></i>字段视图
            </el-button>
            <el-button size="small" :type="detailViewMode === 'json' ? 'primary' : 'default'" plain @click="detailViewMode = 'json'">
              <i class="fas fa-code mr-1"></i>JSON
            </el-button>
          </div>
          <el-button size="small" plain @click="copyJson">
            <i class="fas fa-copy mr-1"></i>复制
          </el-button>
        </div>

        <!-- Table View -->
        <div v-if="detailViewMode === 'table'">
          <!-- Basic info -->
          <div class="text-[11px] text-gray-500 mb-2 font-medium uppercase tracking-wider">基本信息</div>
          <div class="rounded-lg bg-gray-900/60 border border-gray-700/40 overflow-hidden mb-4">
            <table class="w-full text-xs">
              <tbody>
                <tr class="border-b border-gray-700/30">
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">title</td>
                  <td class="px-4 py-2.5 text-gray-200">{{ detailItem.title || '(空)' }}</td>
                </tr>
                <tr class="border-b border-gray-700/30">
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">media_url</td>
                  <td class="px-4 py-2.5 text-gray-200 break-all">{{ detailItem.media_url || '(空)' }}</td>
                </tr>
                <tr class="border-b border-gray-700/30">
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">media_type</td>
                  <td class="px-4 py-2.5 text-gray-200">{{ detailItem.media_type || '(空)' }}</td>
                </tr>
                <tr class="border-b border-gray-700/30">
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">media_source</td>
                  <td class="px-4 py-2.5 text-gray-200">{{ detailItem.media_source || '(空)' }}</td>
                </tr>
                <tr>
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">source_url</td>
                  <td class="px-4 py-2.5 text-gray-300 break-all text-[11px]">{{ detailItem.source_url || '(空)' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Extracted data -->
          <div class="text-[11px] text-gray-500 mb-2 font-medium uppercase tracking-wider">
            提取数据
            <span class="text-gray-600 normal-case ml-1">
              (规则字段: {{ expectedFields(detailItem).join(', ') || '无' }})
            </span>
          </div>
          <div v-if="Object.keys(detailItem.extra).length" class="rounded-lg bg-gray-900/60 border border-gray-700/40 overflow-hidden">
            <table class="w-full text-xs">
              <tbody>
                <tr v-for="(val, key) in detailItem.extra" :key="key" class="border-b border-gray-700/30 last:border-0">
                  <td class="px-4 py-2.5 text-gray-400 w-32 font-mono align-top">{{ key }}</td>
                  <td class="px-4 py-2.5 align-top">
                    <span v-if="isEmpty(val)" class="text-gray-600 italic">(空)</span>
                    <span v-else class="text-gray-200 whitespace-pre-wrap break-all">{{ formatValue(val) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="text-xs text-gray-500 text-center py-6 bg-gray-900/30 rounded-lg border border-gray-700/20">
            <i class="fas fa-circle-exclamation mr-1 text-gray-600"></i>无额外提取数据 — 请检查采集规则配置
          </div>
        </div>

        <!-- JSON View -->
        <pre v-else class="text-xs text-gray-300 bg-gray-900/80 border border-gray-700/40 rounded-lg p-5 overflow-x-auto max-h-[500px] overflow-y-auto font-mono leading-relaxed">{{ (() => {
          const obj: Record<string, any> = {
            title: detailItem.title,
            media_url: detailItem.media_url,
            media_type: detailItem.media_type,
            media_source: detailItem.media_source,
            source_url: detailItem.source_url,
            ...detailItem.extra,
          }
          return JSON.stringify(obj, null, 2)
        })() }}</pre>

        <div class="text-[11px] text-gray-600 flex items-center justify-between">
          <span>采集时间: {{ detailItem.created_at }}</span>
          <span class="font-mono text-gray-700">ID: {{ detailItem.id }}</span>
        </div>
      </div>
    </el-dialog>

    <!-- Export Dialog -->
    <el-dialog v-model="exportDialogVisible" title="导出采集数据" width="650px" destroy-on-close top="5vh">
      <div class="space-y-4">
        <div>
          <div class="text-xs text-gray-400 mb-2">导出格式</div>
          <el-radio-group v-model="exportFormat" size="small">
            <el-radio-button value="excel">Excel (.xlsx)</el-radio-button>
            <el-radio-button value="csv">CSV</el-radio-button>
            <el-radio-button value="json">JSON</el-radio-button>
            <el-radio-button value="yaml">YAML</el-radio-button>
          </el-radio-group>
        </div>

        <div class="flex items-center gap-6">
          <el-checkbox v-model="exportIncludeTranscriptions" size="small" @change="loadExportFields">包含识别文本</el-checkbox>
          <el-checkbox v-model="exportIncludeAIResults" size="small" @change="loadExportFields">包含AI分析结果</el-checkbox>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-gray-400">导出字段 <span class="text-gray-600">（勾选要导出的字段，可自定义别名）</span></span>
            <div class="flex gap-2">
              <el-button size="small" text @click="toggleAllExportFields(true)">全选</el-button>
              <el-button size="small" text @click="toggleAllExportFields(false)">全不选</el-button>
            </div>
          </div>
          <div class="max-h-60 overflow-y-auto space-y-1 border border-gray-700/30 rounded-lg p-3">
            <div v-if="exportFieldGroups.dbFields.length" class="text-[11px] text-gray-500 font-semibold mb-1.5 mt-0.5">数据库字段</div>
            <div v-for="f in exportFields.filter(x => exportFieldGroups.dbFields.some(d => d.key === x.key))" :key="f.key" class="flex items-center gap-2 py-0.5">
              <el-checkbox v-model="f.selected" size="small" />
              <span class="text-xs text-gray-400 w-32 flex-shrink-0 font-mono">{{ exportFieldGroups.dbFields.find(d => d.key === f.key)?.label || f.key }}</span>
              <el-input v-model="f.alias" size="small" :placeholder="f.key" class="flex-1" />
            </div>
            <div v-if="exportFields.filter(x => exportFieldGroups.extraFields?.some(d => d.key === x.key)).length" class="text-[11px] text-gray-500 font-semibold mb-1.5 mt-2">提取规则字段</div>
            <div v-for="f in exportFields.filter(x => exportFieldGroups.extraFields?.some(d => d.key === x.key))" :key="f.key" class="flex items-center gap-2 py-0.5">
              <el-checkbox v-model="f.selected" size="small" />
              <span class="text-xs text-gray-400 w-32 flex-shrink-0 font-mono">{{ exportFieldGroups.extraFields?.find(d => d.key === f.key)?.label || f.key }}</span>
              <el-input v-model="f.alias" size="small" :placeholder="f.key" class="flex-1" />
            </div>
            <div v-if="exportIncludeTranscriptions && exportFields.filter(x => exportFieldGroups.transcriptionFields?.some(d => d.key === x.key)).length" class="text-[11px] text-gray-500 font-semibold mb-1.5 mt-2">识别结果字段</div>
            <div v-for="f in exportFields.filter(x => exportIncludeTranscriptions && exportFieldGroups.transcriptionFields?.some(d => d.key === x.key))" :key="f.key" class="flex items-center gap-2 py-0.5">
              <el-checkbox v-model="f.selected" size="small" />
              <span class="text-xs text-gray-400 w-32 flex-shrink-0 font-mono">{{ exportFieldGroups.transcriptionFields?.find(d => d.key === f.key)?.label || f.key }}</span>
              <el-input v-model="f.alias" size="small" :placeholder="f.key" class="flex-1" />
            </div>
            <div v-if="exportIncludeAIResults && exportFields.filter(x => exportFieldGroups.aiFields?.some(d => d.key === x.key)).length" class="text-[11px] text-gray-500 font-semibold mb-1.5 mt-2">AI分析字段</div>
            <div v-for="f in exportFields.filter(x => exportIncludeAIResults && exportFieldGroups.aiFields?.some(d => d.key === x.key))" :key="f.key" class="flex items-center gap-2 py-0.5">
              <el-checkbox v-model="f.selected" size="small" />
              <span class="text-xs text-gray-400 w-32 flex-shrink-0 font-mono">{{ exportFieldGroups.aiFields?.find(d => d.key === f.key)?.label || f.key }}</span>
              <el-input v-model="f.alias" size="small" :placeholder="f.key" class="flex-1" />
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="exportDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="exportLoading" @click="doExport">
          <i class="fas fa-download mr-1.5"></i>导出
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
