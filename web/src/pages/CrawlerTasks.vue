<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { crawlerAPI } from '../api'
import { usePagination } from '../composables/usePagination'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'

const router = useRouter()

// --- Task list state ---
const tasks = ref<any[]>([])
const statusFilter = ref('all')
const keyword = ref('')
const loading = ref(false)
const selectedIds = ref<string[]>([])
const selectedItemsMeta = reactive<Record<string, any>>({})
const tableRef = ref<any>(null)
let syncingSelection = false
let sseConnection: EventSource | null = null

// --- Dialog state ---
const dialogVisible = ref(false)
const dialogTitle = ref('新建任务')
const editingTaskId = ref<string | null>(null)

// Step 1: 采集模式
const formMode = ref<'single' | 'list'>('single')

// Step 2: 基本配置
const formName = ref('')
const formUrl = ref('')

// Step 3: 执行选项
const formErrorMode = ref<'lenient' | 'standard' | 'strict'>('standard')
const formAutoStart = ref(false)

// Step 4: 列表配置
const formItemSelector = ref('')
const formPaginationMode = ref<'none' | 'page' | 'count'>('none')
const formNextPageSelector = ref('')
const formMaxPages = ref(0)
const formMaxItems = ref(20)
const formLoadMoreSelector = ref('')
const formUrlPattern = ref('')
const formPageStart = ref(1)

// Step 5: 提取规则
const formRules = ref([
  { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '', regex: '' },
  { name: 'content', selector: '.content,.article-body,[class*="content"]', attr: '', regex: '' },
])
const formDetailRules = ref<{ name: string; selector: string; attr: string; regex: string }[]>([])

// Step 6: 字段指定
const formTitleField = ref<string[]>([])
const formDetailLinkField = ref<string[]>([])
const formMediaUrlField = ref<string[]>([])
const formIdField = ref<string[]>([])
const formTitleFieldAll = ref(false)
const formDetailLinkFieldAll = ref(false)
const formMediaUrlFieldAll = ref(true)
const formIdFieldAll = ref(false)

// --- Pagination ---
const { page, pageSize, total, pageSizes, onPageChange, onPageSizeChange } = usePagination({
  defaultPageSize: 20,
  onFetch: () => refresh(),
})
const itemCounts = ref<Record<string, number>>({})

// Dynamic duration timer
const durationTick = ref(0)
let durationTimer: ReturnType<typeof setInterval> | null = null

// Preset rule templates
const presetRules: Record<string, { name: string; selector: string; attr: string; regex: string }[]> = {
  article: [
    { name: 'title', selector: 'h1,.title,.article-title,[class*="headline"]', attr: '', regex: '' },
    { name: 'content', selector: '.content,.article-body,.post-body,[class*="content"]', attr: '', regex: '' },
    { name: 'date', selector: '.date,.time,.pub-date,time', attr: '', regex: '' },
    { name: 'author', selector: '.author,.byline,[class*="author"]', attr: '', regex: '' },
  ],
  media: [
    { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '', regex: '' },
    { name: 'media_url', selector: 'video,audio,source,a[href$=".mp4"]', attr: 'src', regex: '' },
  ],
  product: [
    { name: 'title', selector: 'h2 a,.title a,h3 a,.name a', attr: '', regex: '' },
    { name: 'price', selector: '.price,.amount,[class*="price"]', attr: '', regex: '' },
    { name: 'image', selector: 'img,.thumb img', attr: 'src', regex: '' },
    { name: 'link', selector: 'a', attr: 'href', regex: '' },
  ],
  listBasic: [
    { name: 'title', selector: 'h2 a,.title a,h3 a', attr: '', regex: '' },
    { name: 'date', selector: '.date,time', attr: '', regex: '' },
    { name: 'author', selector: '.author,.byline', attr: '', regex: '' },
  ],
}

const availableFieldNames = computed(() => {
  const fields = new Set<string>()
  formRules.value.forEach((r: any) => { if (r.name) fields.add(r.name) })
  formDetailRules.value.forEach((r: any) => { if (r.name) fields.add(r.name) })
  return Array.from(fields)
})

// --- Actions ---
async function refresh() {
  const params: any = { page: page.value, pageSize: pageSize.value }
  if (statusFilter.value !== 'all') params.status = statusFilter.value
  if (keyword.value.trim()) params.keyword = keyword.value.trim()
  const { data } = await crawlerAPI.getTasksWithPagination(params)
  tasks.value = data.tasks
  total.value = data.total
  await nextTick()
  syncTableSelection()
  refreshItemCounts()
}

const SSE_URL = `${import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api'}/crawler/events`

async function refreshItemCounts() {
  try {
    const { data: itemsResp } = await crawlerAPI.getItems({ pageSize: 10000 })
    const items = itemsResp.data || itemsResp
    const counts: Record<string, number> = {}
    items.forEach((i: any) => { counts[i.task_id] = (counts[i.task_id] || 0) + 1 })
    itemCounts.value = counts
  } catch { /* ignore */ }
}

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
            selectedIds.value = selectedIds.value.filter(id => id !== evt.taskId)
            delete selectedItemsMeta[evt.taskId]
          } else {
            Object.assign(tasks.value[idx], {
              status: evt.status,
              progress: evt.progress,
              result: evt.result,
              error: evt.error,
              started_at: evt.started_at || tasks.value[idx].started_at,
              updated_at: evt.updated_at || dayjs().format('YYYY-MM-DD HH:mm:ss'),
            })
            if (['completed', 'failed', 'cancelled', 'paused'].includes(evt.status)) {
              refreshItemCounts()
            }
          }
        } else if (evt.status !== 'deleted') {
          refresh()
        }
      }
    } catch { /* ignore */ }
  }
  sseConnection.onerror = () => {
    sseConnection?.close()
    setTimeout(setupSSE, 3000)
  }
}

function teardownSSE() { sseConnection?.close(); sseConnection = null }

// ── Dialog helpers ──

function resetForm() {
  formMode.value = 'single'
  formName.value = ''
  formUrl.value = ''
  formErrorMode.value = 'standard'
  formAutoStart.value = false
  formItemSelector.value = ''
  formPaginationMode.value = 'none'
  formNextPageSelector.value = ''
  formMaxPages.value = 0
  formMaxItems.value = 20
  formLoadMoreSelector.value = ''
  formUrlPattern.value = ''
  formPageStart.value = 1
  formRules.value = [
    { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '', regex: '' },
    { name: 'content', selector: '.content,.article-body,[class*="content"]', attr: '', regex: '' },
  ]
  formDetailRules.value = []
  formTitleField.value = []
  formDetailLinkField.value = []
  formMediaUrlField.value = []
  formIdField.value = []
  formTitleFieldAll.value = false
  formDetailLinkFieldAll.value = false
  formMediaUrlFieldAll.value = true
  formIdFieldAll.value = false
}

function openCreateDialog() {
  dialogTitle.value = '新建任务'
  editingTaskId.value = null
  resetForm()
  dialogVisible.value = true
}

function openEditDialog(task: any) {
  const p = task.payload
  dialogTitle.value = '编辑任务'
  editingTaskId.value = task.id

  formMode.value = p.mode || (p.itemSelector ? 'list' : 'single')
  formName.value = p.name || ''
  formUrl.value = p.url || ''
  formErrorMode.value = p.errorMode || 'standard'
  formAutoStart.value = p.autoStart ?? false

  formItemSelector.value = p.itemSelector || ''
  formPaginationMode.value = p.paginationMode || (p.nextPageSelector ? 'page' : 'none')
  formNextPageSelector.value = p.nextPageSelector || ''
  formMaxPages.value = p.maxPages ?? 0
  formMaxItems.value = p.maxItems ?? 20
  formLoadMoreSelector.value = p.loadMoreSelector || ''
  formUrlPattern.value = p.urlPattern || ''
  formPageStart.value = p.pageStart ?? 1

  formRules.value = p.rules?.length ? [...p.rules] : [
    { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '' },
    { name: 'content', selector: '.content,.article-body,[class*="content"]', attr: '' },
  ]
  formDetailRules.value = p.detailRules?.length ? [...p.detailRules] : []

  formTitleField.value = p.titleField?.fields || []
  formDetailLinkField.value = p.detailLinkField?.fields || []
  formMediaUrlField.value = p.mediaUrlField?.fields || []
  formIdField.value = p.idField?.fields || []
  formTitleFieldAll.value = p.titleField?.mode === 'all'
  formDetailLinkFieldAll.value = p.detailLinkField?.mode === 'all'
  formMediaUrlFieldAll.value = p.mediaUrlField?.mode !== 'first'
  formIdFieldAll.value = p.idField?.mode === 'all'

  dialogVisible.value = true
}

function setMode(mode: 'single' | 'list') {
  formMode.value = mode
  if (mode === 'single') {
    if (formRules.value.length <= 2 && formRules.value[0]?.name === 'title') {
      formRules.value = [...presetRules.article]
    }
    formItemSelector.value = ''
    formPaginationMode.value = 'none'
    formNextPageSelector.value = ''
    formLoadMoreSelector.value = ''
    formDetailRules.value = []
  } else {
    if (formRules.value.length <= 2 && formRules.value[0]?.name === 'title') {
      formRules.value = [...presetRules.listBasic]
    }
    formItemSelector.value = ''
  }
}

function addRule(target: 'list' | 'detail') {
  if (target === 'list') {
    formRules.value.push({ name: '', selector: '', attr: '', regex: '' })
  } else {
    formDetailRules.value.push({ name: '', selector: '', attr: '', regex: '' })
  }
}

function removeRule(target: 'list' | 'detail', i: number) {
  if (target === 'list' && formRules.value.length > 1) {
    formRules.value.splice(i, 1)
  } else if (target === 'detail') {
    formDetailRules.value.splice(i, 1)
  }
}

function applyPreset(n: string) {
  if (presetRules[n]) formRules.value = [...presetRules[n]]
}

async function submitForm() {
  if (!formUrl.value) { ElMessage.warning('请输入页面地址'); return }
  if (formMode.value === 'list' && !formItemSelector.value) { ElMessage.warning('列表模式需要填写列表项选择器'); return }

  const payload: any = {
    name: formName.value || formUrl.value.slice(0, 60),
    url: formUrl.value,
    mode: formMode.value,
    rules: formRules.value.filter(r => r.name),
    itemSelector: formMode.value === 'list' ? (formItemSelector.value || undefined) : undefined,
    paginationMode: formMode.value === 'list' ? formPaginationMode.value : 'none',
    nextPageSelector: formNextPageSelector.value || undefined,
    maxPages: formPaginationMode.value === 'page' ? formMaxPages.value : undefined,
    maxItems: formPaginationMode.value === 'count' ? formMaxItems.value : undefined,
    loadMoreSelector: formLoadMoreSelector.value || undefined,
    urlPattern: formUrlPattern.value || undefined,
    pageStart: formUrlPattern.value ? formPageStart.value : undefined,
    detailRules: formDetailRules.value.filter(r => r.name).length
      ? formDetailRules.value.filter(r => r.name) : undefined,

    autoStart: editingTaskId.value ? undefined : formAutoStart.value,
    errorMode: formErrorMode.value,

    titleField: formTitleField.value.length
      ? { fields: formTitleField.value, mode: formTitleFieldAll.value ? 'all' : 'first' }
      : undefined,
    detailLinkField: formDetailLinkField.value.length
      ? { fields: formDetailLinkField.value, mode: formDetailLinkFieldAll.value ? 'all' : 'first' }
      : undefined,
    mediaUrlField: formMediaUrlField.value.length
      ? { fields: formMediaUrlField.value, mode: formMediaUrlFieldAll.value ? 'all' : 'first' }
      : undefined,
    idField: formIdField.value.length
      ? { fields: formIdField.value, mode: formIdFieldAll.value ? 'all' : 'first' }
      : undefined,
  }

  loading.value = true
  try {
    if (editingTaskId.value) {
      await crawlerAPI.updateTask(editingTaskId.value, payload)
      ElMessage.success('任务已更新')
    } else {
      await crawlerAPI.start(payload)
      ElMessage.success(formAutoStart.value ? '任务已创建并开始执行' : '任务已创建，可手动开始执行')
    }
    dialogVisible.value = false
    await refresh()
  } catch { ElMessage.error('操作失败') }
  loading.value = false
}

// ── Task actions ──
async function startTask(id: string) { try { await crawlerAPI.startTask(id); ElMessage.success('任务已开始'); refresh() } catch { ElMessage.error('操作失败') } }
async function pauseTask(id: string) { try { await crawlerAPI.pauseTask(id); ElMessage.success('任务已暂停'); refresh() } catch { ElMessage.error('操作失败') } }
async function stopTask(id: string) { try { await ElMessageBox.confirm('确定要终止此任务吗？已采集的数据会保留。', '确认', { type: 'warning' }); await crawlerAPI.stopTask(id); ElMessage.success('任务已终止'); refresh() } catch { /* cancelled */ } }
async function retryTask(id: string) { try { await crawlerAPI.retryTask(id); ElMessage.success('已重新加入队列'); refresh() } catch { ElMessage.error('操作失败') } }
async function reRunTask(id: string) { try { await ElMessageBox.confirm('重新运行将清除已有的采集数据并从头开始，确定继续？', '确认', { type: 'warning' }); await crawlerAPI.reRunTask(id); ElMessage.success('任务已重新运行'); refresh() } catch { /* cancelled */ } }
async function deleteTask(id: string) { try { await ElMessageBox.confirm('确定要删除此任务吗？相关的采集数据也会被删除。', '确认删除', { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' }); await crawlerAPI.deleteTask(id); ElMessage.success('任务已删除'); selectedIds.value = selectedIds.value.filter(sid => sid !== id); delete selectedItemsMeta[id]; refresh() } catch { /* cancelled */ } }
async function clearItems(id: string) { try { const task = tasks.value.find((t: any) => t.id === id); const name = task?.payload?.name || task?.payload?.url || id.slice(0, 8); await ElMessageBox.confirm(`确定要清空任务「${name}」下的所有采集项吗？采集任务本身不会被删除。`, '清空采集项', { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }); await crawlerAPI.clearItems(id); ElMessage.success('已清空所有采集项'); refresh() } catch { /* cancelled */ } }
async function batchDelete() { const ids = deletableSelected.value; if (!ids.length) { ElMessage.warning('所选任务中没有可删除的（只能删除已完成/失败/已终止/未开始的任务）'); return; } try { await ElMessageBox.confirm(`确定要删除选中的 ${ids.length} 个任务吗？相关的采集数据也会被删除。`, '批量删除确认', { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' }); const res = await crawlerAPI.batchDeleteTasks(ids); const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0; const failCount = res.data?.filter?.((r: any) => !r.ok)?.length ?? 0; if (failCount) { ElMessage.warning(`成功删除 ${okCount} 个，${failCount} 个失败`); } else { ElMessage.success(`已删除 ${okCount} 个任务`); } for (const id of selectedIds.value) delete selectedItemsMeta[id]; selectedIds.value = []; refresh() } catch { /* cancelled */ } }

// Batch operations — use selectedItemsMeta as fallback for items not in current view
function findSelected(id: string) { return tasks.value.find((x: any) => x.id === id) || selectedItemsMeta[id] }
const startableSelected = computed(() => selectedIds.value.filter(id => { const t = findSelected(id); return t && canStart(t.status) }))
const retryableSelected = computed(() => selectedIds.value.filter(id => { const t = findSelected(id); return t && canRetry(t.status) }))
const rerunnableSelected = computed(() => selectedIds.value.filter(id => { const t = findSelected(id); return t && canReRun(t.status) }))
const clearableSelected = computed(() => selectedIds.value.filter(id => { const t = findSelected(id); return t && canDelete(t.status) }))

// ── Batch operations ──
async function batchStart() {
  const ids = startableSelected.value
  if (!ids.length) { ElMessage.warning('所选任务中没有可执行的（只能执行未开始/已暂停的任务）'); return }
  try {
    await ElMessageBox.confirm(`确定要执行选中的 ${ids.length} 个任务吗？`, '批量执行确认', { type: 'info', confirmButtonText: '确定执行', cancelButtonText: '取消' })
    const res = await crawlerAPI.batchStartTasks(ids)
    const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0
    ElMessage.success(`已启动 ${okCount} 个任务`)
    refresh()
  } catch { /* cancelled */ }
}

async function batchRetry() {
  const ids = retryableSelected.value
  if (!ids.length) { ElMessage.warning('所选任务中没有可重试的（只能重试失败状态的任务）'); return }
  try {
    await ElMessageBox.confirm(`确定要重试选中的 ${ids.length} 个任务吗？`, '批量重试确认', { type: 'info', confirmButtonText: '确定重试', cancelButtonText: '取消' })
    const res = await crawlerAPI.batchRetryTasks(ids)
    const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0
    ElMessage.success(`已重试 ${okCount} 个任务`)
    refresh()
  } catch { /* cancelled */ }
}

async function batchReRun() {
  const ids = rerunnableSelected.value
  if (!ids.length) { ElMessage.warning('所选任务中没有可重新执行的（只能重新执行已完成/已取消/失败状态的任务）'); return }
  try {
    await ElMessageBox.confirm(
      `确定要重新执行选中的 ${ids.length} 个任务吗？已有的采集数据将被清除并从头开始。`,
      '批量重新执行确认',
      { type: 'warning', confirmButtonText: '确定重新执行', cancelButtonText: '取消' },
    )
    const res = await crawlerAPI.batchRerunTasks(ids)
    const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0
    const failCount = res.data?.filter?.((r: any) => !r.ok)?.length ?? 0
    if (failCount) { ElMessage.warning(`成功启动 ${okCount} 个，${failCount} 个失败`) }
    else { ElMessage.success(`已重新执行 ${okCount} 个任务`) }
    refresh()
  } catch { /* cancelled */ }
}

async function batchClear() {
  const ids = clearableSelected.value
  if (!ids.length) { ElMessage.warning('所选任务中没有可清空的'); return }
  try {
    await ElMessageBox.confirm(`确定要清空选中的 ${ids.length} 个任务下的所有采集项吗？采集任务本身不会被删除。`, '批量清空确认', { type: 'warning', confirmButtonText: '确定清空', cancelButtonText: '取消' })
    await crawlerAPI.batchClearItems(ids)
    ElMessage.success(`已清空 ${ids.length} 个任务的采集项`)
    refresh()
  } catch { /* cancelled */ }
}

// --- Export ---
const exportDialogVisible = ref(false)
const exportFormat = ref<'json' | 'yaml' | 'csv' | 'excel'>('excel')
const exportMultiFile = ref(false)
const exportFields = ref<{ key: string; alias: string; selected: boolean }[]>([])
const exportFieldGroups = ref<{ dbFields: any[]; extraFields: any[] }>({ dbFields: [], extraFields: [] })
const exportLoading = ref(false)

function openExportDialog() {
  const ids = selectedIds.value
  if (!ids.length) { ElMessage.warning('请先勾选要导出的任务'); return }
  exportDialogVisible.value = true
  exportFormat.value = 'excel'
  exportMultiFile.value = false
  loadExportFields(ids)
}

async function loadExportFields(taskIds: string[]) {
  try {
    const { data } = await crawlerAPI.getExportFields(taskIds)
    exportFieldGroups.value = data
    // Build field list: select all by default
    const all: { key: string; alias: string; selected: boolean }[] = []
    for (const g of [data.dbFields, data.extraFields]) {
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
  const taskIds = selectedIds.value
  exportLoading.value = true
  try {
    const res = await crawlerAPI.exportData({
      taskIds,
      format: exportFormat.value,
      fields: selectedFields.map(f => ({ key: f.key, alias: f.alias || f.key })),
      multiFile: exportMultiFile.value,
    })
    // Handle blob download
    const blob = res.data
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const extMap: Record<string, string> = { json: 'json', yaml: 'yaml', csv: 'csv', excel: 'xlsx' }
    a.download = `export_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.${extMap[exportFormat.value]}`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
    exportDialogVisible.value = false
  } catch { ElMessage.error('导出失败') }
  exportLoading.value = false
}

function viewResults(task: any) { router.push({ path: '/crawler/items', query: { taskId: task.id } }) }

// --- Status helpers ---
function statusLabel(s: string) {
  const map: Record<string, string> = { pending: '未开始', running: '进行中', completed: '已完成', failed: '执行失败', cancelled: '用户终止', paused: '已暂停' }
  return map[s] || s
}
function statusClass(s: string) {
  const map: Record<string, string> = { completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25', running: 'bg-blue-500/15 text-blue-300 border-blue-500/25', failed: 'bg-red-500/15 text-red-300 border-red-500/25', cancelled: 'bg-gray-500/15 text-gray-400 border-gray-500/25', paused: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/25', pending: 'bg-purple-500/15 text-purple-300 border-purple-500/25' }
  return map[s] || ''
}
function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canPause(s: string) { return s === 'running' }
function canStop(s: string) { return s === 'running' || s === 'paused' }
function canRetry(s: string) { return s === 'failed' }
function canReRun(s: string) { return s === 'completed' || s === 'cancelled' }
function canEdit(s: string) { return s !== 'running' }
function canDelete(s: string) { return s === 'pending' || s === 'completed' || s === 'failed' || s === 'cancelled' }
function canViewResults(s: string) { return s === 'completed' }
function formatDuration(task: any): string {
  if (!task.started_at) return '-'
  void durationTick.value  // reactivity: re-compute every tick for running tasks
  const start = dayjs(task.started_at + 'Z').valueOf()
  const end = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled' ? dayjs(task.updated_at + 'Z').valueOf() : dayjs().valueOf()
  if (isNaN(start) || isNaN(end) || end <= start) return '-'
  const sec = Math.floor((end - start) / 1000)
  if (sec < 60) return `${sec}秒`
  if (sec < 3600) return `${Math.floor(sec / 60)}分${sec % 60}秒`
  return `${Math.floor(sec / 3600)}时${Math.floor((sec % 3600) / 60)}分`
}
function handleSelectionChange(rows: any[]) {
  if (syncingSelection) return
  const visibleIds = new Set(tasks.value.map((t: any) => t.id))
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
    selectedItemsMeta[id] = { id, status: row.status }
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
function syncTableSelection() {
  if (!tableRef.value) return
  syncingSelection = true
  tasks.value.forEach((row: any) => {
    if (selectedIds.value.includes(row.id)) {
      tableRef.value.toggleRowSelection(row, true)
    }
  })
  syncingSelection = false
}
function resetFilters() {
  keyword.value = ''
  statusFilter.value = 'all'
  page.value = 1
  refresh()
}
function isRowSelectable(_row: any) { return true }
const deletableSelected = computed(() => selectedIds.value.filter(id => { const t = findSelected(id); return t && canDelete(t.status) }))

onMounted(() => { refresh(); setupSSE(); durationTimer = setInterval(() => { durationTick.value++ }, 1000) })
onUnmounted(() => { teardownSSE(); if (durationTimer) { clearInterval(durationTimer); durationTimer = null } })
</script>

<template>
  <div class="px-7 py-6">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">爬虫任务</h2>
        <p class="text-[13px] text-gray-500">管理采集任务配置，查看任务执行状态与采集结果</p>
      </div>
      <div class="flex items-center gap-2">
        <el-dropdown v-if="selectedIds.length" trigger="click">
          <el-button size="small" plain>
            批量操作 <i class="fas fa-chevron-down ml-1 text-[10px]"></i>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-if="startableSelected.length" @click="batchStart">
                <i class="fas fa-play mr-1.5 text-blue-400"></i>批量执行 ({{ startableSelected.length }})
              </el-dropdown-item>
              <el-dropdown-item v-if="retryableSelected.length" @click="batchRetry">
                <i class="fas fa-rotate-right mr-1.5 text-amber-400"></i>批量重试 ({{ retryableSelected.length }})
              </el-dropdown-item>
              <el-dropdown-item v-if="rerunnableSelected.length" @click="batchReRun">
                <i class="fas fa-repeat mr-1.5"></i>批量重新执行 ({{ rerunnableSelected.length }})
              </el-dropdown-item>
              <el-dropdown-item v-if="clearableSelected.length" @click="batchClear">
                <i class="fas fa-eraser mr-1.5"></i>批量清空采集项 ({{ clearableSelected.length }})
              </el-dropdown-item>
              <el-dropdown-item v-if="selectedIds.length" @click="openExportDialog">
                <i class="fas fa-file-export mr-1.5 text-blue-400"></i>导出 ({{ selectedIds.length }})
              </el-dropdown-item>
              <el-dropdown-item v-if="deletableSelected.length" @click="batchDelete">
                <i class="fas fa-trash-can mr-1.5 text-red-400"></i><span class="text-red-400">批量删除 ({{ deletableSelected.length }})</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button type="primary" size="small" @click="openCreateDialog">
          <i class="fas fa-plus mr-1.5"></i>新建任务
        </el-button>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center justify-between mb-4 card-static">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">搜索：</span>
          <el-input v-model="keyword" size="small" placeholder="搜索任务名称/URL" clearable @keyup.enter="page=1;refresh()" @clear="page=1;refresh()" class="!w-52" />
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">状态筛选：</span>
          <el-select v-model="statusFilter" size="small" class="!w-28" @change="page=1;refresh()">
          <el-option label="全部" value="all" />
          <el-option label="未开始" value="pending" />
          <el-option label="进行中" value="running" />
          <el-option label="已暂停" value="paused" />
          <el-option label="已完成" value="completed" />
          <el-option label="执行失败" value="failed" />
          <el-option label="用户终止" value="cancelled" />
          </el-select>
        </span>
        <span class="inline-flex items-center gap-1">
          <el-button size="small" plain @click="page=1;refresh()"><i class="fas fa-search mr-1"></i>搜索</el-button>
          <el-button size="small" plain @click="resetFilters"><i class="fas fa-undo mr-1"></i>重置</el-button>
          <el-button size="small" plain @click="refresh()"><i class="fas fa-sync-alt mr-1"></i>刷新</el-button>
          <el-button v-if="selectedIds.length" size="small" plain type="warning" @click="clearAllSelections"><i class="fas fa-times-circle mr-1"></i>清空选择 ({{ selectedIds.length }})</el-button>
        </span>
      </div>
    </div>

    <!-- Task Table -->
    <div class="card-static">
      <el-table v-if="tasks.length" ref="tableRef" :data="tasks" size="small" row-key="id" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="40" :selectable="isRowSelectable" fixed="left" :reserve-selection="true" />
        <el-table-column type="index" label="序号" width="55" align="center" fixed="left" />
        <el-table-column label="任务名称" min-width="140" show-overflow-tooltip fixed="left">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <i v-if="(row.payload?.mode || (row.payload?.itemSelector ? 'list' : 'single')) === 'single'" class="fas fa-file-lines text-[11px] text-blue-400" title="单页采集"></i>
              <i v-else class="fas fa-list text-[11px] text-amber-400" title="列表采集"></i>
              <span class="text-xs text-gray-300">{{ row.payload?.name || row.payload?.url || row.id.slice(0, 12) + '...' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="页面地址" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.payload?.url }}</span>
          </template>
        </el-table-column>
        <el-table-column label="模式" width="80" align="center">
          <template #default="{ row }">
            <span class="text-[11px]" :class="(row.payload?.mode || (row.payload?.itemSelector ? 'list' : 'single')) === 'single' ? 'text-blue-400' : 'text-amber-400'">
              {{ (row.payload?.mode || (row.payload?.itemSelector ? 'list' : 'single')) === 'single' ? '单页' : '列表' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border" :class="statusClass(row.status)">
              {{ statusLabel(row.status) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="140">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :stroke-width="6" :status="row.status === 'failed' ? 'exception' : row.status === 'completed' ? 'success' : undefined" />
          </template>
        </el-table-column>
        <el-table-column label="采集数" width="80" align="center">
          <template #default="{ row }">
            <span class="text-xs text-gray-400">{{ itemCounts[row.id] || 0 }} 条</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="145">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="145">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.updated_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="执行时间" width="145">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.started_at || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="执行时长" width="90" align="center">
          <template #default="{ row }">
            <span class="text-xs" :class="row.status === 'running' ? 'text-blue-400' : 'text-gray-500'">{{ formatDuration(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="280" align="center" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <el-button v-if="canStart(row.status)" size="small" type="primary" plain @click="startTask(row.id)">{{ row.status === 'paused' ? '继续' : '开始' }}</el-button>
              <el-button v-if="canPause(row.status)" size="small" type="warning" plain @click="pauseTask(row.id)">暂停</el-button>
              <el-button v-if="canStop(row.status)" size="small" type="danger" plain @click="stopTask(row.id)">终止</el-button>
              <el-button v-if="canRetry(row.status)" size="small" type="warning" plain @click="retryTask(row.id)">重试</el-button>
              <el-button v-if="canReRun(row.status)" size="small" plain @click="reRunTask(row.id)">重新执行</el-button>
              <el-button v-if="canEdit(row.status)" size="small" plain @click="openEditDialog(row)">编辑</el-button>
              <el-button v-if="canViewResults(row.status)" size="small" type="success" plain @click="viewResults(row)">查看结果</el-button>
              <el-button v-if="canDelete(row.status)" size="small" type="danger" plain @click="deleteTask(row.id)">删除</el-button>
              <el-button v-if="canDelete(row.status)" size="small" plain @click="clearItems(row.id)">清空采集项</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="total > 0" class="flex justify-end mt-4">
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizes" :total="total" layout="total, sizes, prev, pager, next" size="small" background @size-change="onPageSizeChange" @current-change="onPageChange" />
      </div>
      <div v-if="!tasks.length" class="text-center py-12 text-gray-500 text-sm">
        <i class="fas fa-bug text-3xl mb-3 inline-block opacity-30"></i>暂无任务
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="860px" destroy-on-close top="3vh" :close-on-click-modal="false">
      <div class="flex flex-col gap-5">

        <!-- 1. 采集模式 -->
        <div class="section">
          <div class="text-[13px] font-semibold text-gray-300 mb-2.5">采集模式</div>
          <el-radio-group v-model="formMode" size="small" @change="setMode">
            <el-radio-button value="single">📄 单页采集</el-radio-button>
            <el-radio-button value="list">📋 列表采集</el-radio-button>
          </el-radio-group>
          <div class="text-[11px] text-gray-500 mt-1.5">
            {{ formMode === 'single' ? '抓取单个页面内容，如新闻详情页、文章页，结果为一个结构化对象。' : '抓取列表页面中的所有条目，如产品列表、文章列表，结果为一个数组。' }}
          </div>
        </div>

        <!-- 2. 基本配置 -->
        <div class="section">
          <div class="text-[13px] font-semibold text-gray-300 mb-2.5">基本配置</div>
          <div class="flex gap-4">
            <div class="flex-1">
              <div class="text-xs text-gray-400 mb-1">任务名称 <span class="text-gray-600">（可选）</span></div>
              <el-input v-model="formName" placeholder="留空则截取 URL 前60字符" size="small" />
            </div>
            <div class="flex-1">
              <div class="text-xs text-gray-400 mb-1">页面地址 <span class="text-red-400">*</span></div>
              <el-input v-model="formUrl" placeholder="https://example.com/articles/123" size="small" />
            </div>
          </div>
        </div>

        <!-- 3. 执行选项 -->
        <div class="section">
          <div class="text-[13px] font-semibold text-gray-300 mb-2.5">执行选项</div>

          <div class="flex items-center gap-4 mb-1">
            <span class="text-xs text-gray-400 flex-shrink-0">容错级别</span>
            <el-radio-group v-model="formErrorMode" size="small">
              <el-radio-button value="lenient">宽松</el-radio-button>
              <el-radio-button value="standard">标准</el-radio-button>
              <el-radio-button value="strict">严格</el-radio-button>
            </el-radio-group>
            <el-tooltip :content="formErrorMode === 'lenient' ? '列表页或详情页访问失败均跳过，尽可能多地采集数据' : formErrorMode === 'standard' ? '失败自动重试 1-2 次，仍失败则跳过该项继续（推荐）' : '任何页面或详情页访问失败立即终止任务'" placement="top">
              <i class="fas fa-circle-question text-gray-600 cursor-help text-[12px]"></i>
            </el-tooltip>
          </div>
          <div class="text-[11px] text-gray-500 mb-3 ml-14">
            {{ formErrorMode === 'lenient' ? '所有错误跳过不中断，适合对数据完整性要求不高的快速采集。' : formErrorMode === 'standard' ? '失败自动重试 1-2 次，仍失败则跳过该项继续。推荐日常使用。' : '任何错误立即终止任务，适合对数据质量要求极高的场景。' }}
          </div>

          <div class="flex items-center gap-2 mb-2">
            <el-checkbox v-model="formAutoStart" size="small">自动执行爬取
              <el-tooltip content="创建任务后立即开始采集，无需手动点击开始" placement="top">
                <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-0.5"></i>
              </el-tooltip>
            </el-checkbox>
          </div>
        </div>

        <!-- 4. 列表配置（仅列表模式） -->
        <div v-if="formMode === 'list'" class="section">
          <div class="text-[13px] font-semibold text-gray-300 mb-2.5">列表配置</div>

          <div class="mb-3">
            <div class="text-xs text-gray-400 mb-1">
              列表项选择器 <span class="text-red-400">*</span>
              <el-tooltip content="CSS 选择器，用于定位列表中的每一项。例如 .news-item、li.article、.product-card" placement="top">
                <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-1"></i>
              </el-tooltip>
            </div>
            <el-input v-model="formItemSelector" placeholder=".article-item, li.post, .product-card" size="small" />
          </div>

          <div class="mb-3">
            <div class="text-xs text-gray-400 mb-2">
              翻页方式
              <el-tooltip content="不翻页：仅抓取当前页。按页数：抓取指定数量页面。按条数：抓取指定数量的条目后停止。" placement="top">
                <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-1"></i>
              </el-tooltip>
            </div>
            <el-radio-group v-model="formPaginationMode" size="small">
              <el-radio-button value="none">不翻页</el-radio-button>
              <el-radio-button value="page">按页数</el-radio-button>
              <el-radio-button value="count">按条数</el-radio-button>
            </el-radio-group>
          </div>

          <div v-if="formPaginationMode === 'page'" class="ml-2 mb-3 space-y-2">
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-20">抓取页数</span>
              <el-input-number v-model="formMaxPages" :min="0" :max="9999" size="small" />
              <span class="text-[11px] text-gray-500">0 = 全部</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-20">下一页选择器</span>
              <el-input v-model="formNextPageSelector" placeholder=".pagination .next, a[rel='next']" size="small" class="flex-1" />
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-24">
                URL 模板
                <el-tooltip content="用 {page} 表示页码，程序会自动替换为实际数字。例如：?page={page} → ?page=1, ?page=2...；/page/{page}/ → /page/1/, /page/2/...。留空则用「下一页选择器」自动翻页。" placement="top">
                  <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-0.5"></i>
                </el-tooltip>
              </span>
              <el-input v-model="formUrlPattern" placeholder="https://example.com/list?page={page}" size="small" class="flex-1" />
              <span class="text-xs text-gray-400 flex-shrink-0">起始页</span>
              <el-input-number v-model="formPageStart" :min="1" :max="9999" size="small" />
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 flex-shrink-0 w-24">
                加载更多
                <el-tooltip content="实验性：点击加载更多按钮的选择器，用于无限滚动类页面" placement="top">
                  <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-0.5"></i>
                </el-tooltip>
              </span>
              <el-input v-model="formLoadMoreSelector" placeholder=".load-more, button.more" size="small" class="flex-1" />
            </div>
          </div>

          <div v-if="formPaginationMode === 'count'" class="ml-2 mb-3 space-y-2">
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-20">抓取条数</span>
              <el-input-number v-model="formMaxItems" :min="1" :max="99999" size="small" />
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-20">下一页选择器</span>
              <el-input v-model="formNextPageSelector" placeholder=".pagination .next, a[rel='next']" size="small" class="flex-1" />
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-24">
                URL 模板
                <el-tooltip content="用 {page} 表示页码，程序会自动替换为实际数字。例如：?page={page} → ?page=1, ?page=2...；/page/{page}/ → /page/1/, /page/2/...。留空则用「下一页选择器」自动翻页。" placement="top">
                  <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-0.5"></i>
                </el-tooltip>
              </span>
              <el-input v-model="formUrlPattern" placeholder="https://example.com/list?page={page}" size="small" class="flex-1" />
              <span class="text-xs text-gray-400 flex-shrink-0">起始页</span>
              <el-input-number v-model="formPageStart" :min="1" :max="9999" size="small" />
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 flex-shrink-0 w-24">
                加载更多
                <el-tooltip content="实验性：点击加载更多按钮的选择器，用于无限滚动类页面" placement="top">
                  <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-0.5"></i>
                </el-tooltip>
              </span>
              <el-input v-model="formLoadMoreSelector" placeholder=".load-more, button.more" size="small" class="flex-1" />
            </div>
          </div>
        </div>

        <!-- 5. 提取规则 -->
        <div class="section">
          <div class="flex items-center justify-between mb-3">
            <div class="text-[13px] font-semibold text-gray-300 !mb-0">提取规则</div>
            <div class="flex gap-1.5">
              <template v-if="formMode === 'single'">
                <el-button size="small" @click="applyPreset('article')">文章模板</el-button>
                <el-button size="small" @click="applyPreset('media')">媒体模板</el-button>
              </template>
              <template v-else>
                <el-button size="small" @click="applyPreset('product')">商品模板</el-button>
                <el-button size="small" @click="applyPreset('listBasic')">基础列表</el-button>
              </template>
              <el-button size="small" type="primary" plain @click="addRule('list')"><i class="fas fa-plus mr-1"></i>添加字段</el-button>
            </div>
          </div>

          <div class="space-y-1.5">
            <div v-for="(rule, i) in formRules" :key="i" class="flex items-center gap-2">
              <span class="text-[11px] text-gray-600 w-4 text-center flex-shrink-0">{{ i + 1 }}</span>
              <el-input v-model="rule.name" placeholder="字段名" size="small" class="!w-21" />
              <el-input v-model="rule.selector" placeholder="CSS 选择器（留空=元素自身）" size="small" class="flex-1" />
              <el-input v-model="rule.attr" placeholder="属性(可选)" size="small" class="!w-18" />
              <el-input v-model="rule.regex" placeholder="正则(可选)" size="small" class="!w-28" />
              <el-button v-if="formRules.length > 1" size="small" type="danger" circle plain @click="removeRule('list', i)"><i class="fas fa-xmark"></i></el-button>
            </div>
          </div>
          <div class="text-[11px] text-gray-500 mt-2">
            💡 <b>字段名</b>=存储的 key；<b>CSS 选择器</b>=定位元素（<b class="text-amber-400">留空 = 列表项元素本身</b>，配合属性提取 href/src 等）；
            <b>属性</b>=留空取文本/填属性名取值；<b>正则</b>=可选截取（如 <code class="text-amber-400 bg-amber-500/10 px-1 rounded">(\d+)</code>）
          </div>

          <!-- Detail rules (list mode) -->
          <div v-if="formMode === 'list'" class="mt-4">
            <div class="flex items-center justify-between mb-3">
              <div class="text-sm font-semibold text-gray-300">详情页提取 <span class="text-[11px] text-gray-500 font-normal">（可选）</span></div>
              <el-button size="small" type="primary" plain @click="addRule('detail')"><i class="fas fa-plus mr-1"></i>添加字段</el-button>
            </div>
            <div v-if="formDetailRules.length" class="space-y-1.5">
              <div v-for="(rule, i) in formDetailRules" :key="i" class="flex items-center gap-2">
                <span class="text-[11px] text-gray-600 w-4 text-center flex-shrink-0">{{ i + 1 }}</span>
                <el-input v-model="rule.name" placeholder="字段名" size="small" class="!w-21" />
                <el-input v-model="rule.selector" placeholder="CSS 选择器（留空=元素自身）" size="small" class="flex-1" />
                <el-input v-model="rule.attr" placeholder="属性" size="small" class="!w-18" />
                <el-input v-model="rule.regex" placeholder="正则" size="small" class="!w-28" />
                <el-button size="small" type="danger" circle plain @click="removeRule('detail', i)"><i class="fas fa-xmark"></i></el-button>
              </div>
            </div>
            <p v-if="formDetailRules.length" class="text-[11px] text-gray-500 mt-2">
              💡 详情页规则与列表规则语法相同。<b class="text-amber-400">选择器留空 = 页面根元素</b>，配合属性可提取 <code class="text-amber-400 bg-amber-500/10 px-1 rounded">&lt;title&gt;</code> 等顶层节点内容。
            </p>
          </div>
        </div>

        <!-- 6. 字段指定 -->
        <div class="section">
          <div class="text-[13px] font-semibold text-gray-300 mb-2.5">字段指定</div>

          <div class="space-y-2">
            <!-- 唯一标识 -->
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-24 flex-shrink-0">
                唯一标识
                <el-tooltip content="能唯一标识每条记录的字段名（如数据库 ID）。重试/重采时用于去重匹配，防止重复插入。" placement="top">
                  <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-0.5"></i>
                </el-tooltip>
              </span>
              <el-select v-model="formIdField" multiple filterable allow-create default-first-option placeholder="如: id" size="small" class="flex-1">
                <el-option v-for="f in availableFieldNames" :key="f" :label="f" :value="f" />
              </el-select>
              <el-checkbox v-model="formIdFieldAll" size="small" class="!mr-0 flex-shrink-0">取全部</el-checkbox>
            </div>

            <!-- 标题字段 -->
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-24 flex-shrink-0">
                标题字段
                <el-tooltip :content="formTitleFieldAll ? '当前：收集所有指定字段的值作为标题列表' : '当前：按顺序选第一个非空值。勾选「取全部」改为收集全部字段值'" placement="top">
                  <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-0.5"></i>
                </el-tooltip>
              </span>
              <el-select v-model="formTitleField" multiple filterable allow-create default-first-option placeholder="留空自动" size="small" class="flex-1">
                <el-option v-for="f in availableFieldNames" :key="f" :label="f" :value="f" />
              </el-select>
              <el-checkbox v-model="formTitleFieldAll" size="small" class="!mr-0 flex-shrink-0">取全部</el-checkbox>
            </div>

            <!-- 详情链接 -->
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-24 flex-shrink-0">
                详情链接
                <el-tooltip content="哪个字段的值是详情页 URL。列表模式下，程序用这个 URL 进入每个条目的详情页提取更多字段。多个字段时按顺序选第一个有效值。如需从链接元素的 href 属性提取，请在「提取规则」中添加一个 attr='href' 的规则。" placement="top">
                  <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-0.5"></i>
                </el-tooltip>
              </span>
              <el-select v-model="formDetailLinkField" multiple filterable allow-create default-first-option placeholder="如: link" size="small" class="flex-1">
                <el-option v-for="f in availableFieldNames" :key="f" :label="f" :value="f" />
              </el-select>
              <el-checkbox v-model="formDetailLinkFieldAll" size="small" class="!mr-0 flex-shrink-0">取全部</el-checkbox>
            </div>

            <!-- 媒体资源 -->
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400 w-24 flex-shrink-0">
                媒体资源
                <el-tooltip content="存放视频/音频/图片 URL 的字段名。默认「取全部」表示收集所有指定字段的值作为独立下载资源。取消勾选则只取第一个。" placement="top">
                  <i class="fas fa-circle-question text-gray-600 cursor-help text-[11px] ml-0.5"></i>
                </el-tooltip>
              </span>
              <el-select v-model="formMediaUrlField" multiple filterable allow-create default-first-option placeholder="如: videoUrl" size="small" class="flex-1">
                <el-option v-for="f in availableFieldNames" :key="f" :label="f" :value="f" />
              </el-select>
              <el-checkbox v-model="formMediaUrlFieldAll" size="small" class="!mr-0 flex-shrink-0">取全部</el-checkbox>
            </div>
          </div>


      </div>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!formUrl || loading" :loading="loading" @click="submitForm">
          {{ editingTaskId ? '保存修改' : (formAutoStart ? '创建并执行' : '创建任务') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Export Dialog -->
    <el-dialog v-model="exportDialogVisible" title="导出采集数据" width="650px" destroy-on-close top="5vh" :close-on-click-modal="false">
      <div class="space-y-4">
        <!-- Format selection -->
        <div>
          <div class="text-xs text-gray-400 mb-2">导出格式</div>
          <el-radio-group v-model="exportFormat" size="small">
            <el-radio-button value="excel">Excel (.xlsx)</el-radio-button>
            <el-radio-button value="csv">CSV</el-radio-button>
            <el-radio-button value="json">JSON</el-radio-button>
            <el-radio-button value="yaml">YAML</el-radio-button>
          </el-radio-group>
        </div>

        <!-- Single/Multi file (only when multiple tasks selected) -->
        <div v-if="selectedIds.length > 1 && exportFormat !== 'csv'">
          <div class="text-xs text-gray-400 mb-2">导出方式</div>
          <el-radio-group v-model="exportMultiFile" size="small">
            <el-radio-button :value="false">单文件 {{ exportFormat === 'excel' ? '(多Sheet)' : '(分组)' }}</el-radio-button>
            <el-radio-button :value="true">多文件 (ZIP压缩包)</el-radio-button>
          </el-radio-group>
        </div>
        <div v-if="selectedIds.length > 1 && exportFormat === 'csv'" class="text-[11px] text-gray-500 mt-1">
          CSV 多任务时将自动打包为 ZIP
        </div>


        <!-- Field selection -->
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

