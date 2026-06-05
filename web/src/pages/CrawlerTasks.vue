<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { crawlerAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()

// --- Task list state ---
const tasks = ref<any[]>([])
const statusFilter = ref('all')
const keyword = ref('')
const loading = ref(false)
const selectedIds = ref<string[]>([])
let sseConnection: EventSource | null = null

// --- Dialog state ---
const dialogVisible = ref(false)
const dialogTitle = ref('新建任务')
const editingTaskId = ref<string | null>(null)
const formName = ref('')
const formUrl = ref('')
const formMode = ref<'single' | 'list'>('single')
const formItemSelector = ref('')
const formPaginationMode = ref<'none' | 'page' | 'count'>('none')
const formNextPageSelector = ref('')
const formMaxPages = ref(0)
const formMaxItems = ref(20)
const formLoadMoreSelector = ref('')
const formUrlPattern = ref('')
const formPageStart = ref(1)
const formAutoStart = ref(false)
const formTitleField = ref<string[]>([])
const formDetailLinkField = ref<string[]>([])
const formMediaUrlField = ref<string[]>([])
const formIdField = ref<string[]>([])
const formErrorMode = ref<'lenient' | 'standard' | 'strict'>('standard')
const formAutoDownload = ref(false)
const formRules = ref([
  { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '', regex: '' },
  { name: 'content', selector: '.content,.article-body,[class*="content"]', attr: '', regex: '' },
])
const formDetailLinkSelector = ref('')
const formDetailRules = ref<{ name: string; selector: string; attr: string; regex: string }[]>([])

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

// --- Step tracking for dialog ---
const activeStep = ref(0)

// --- Pagination ---
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)

const itemCounts = ref<Record<string, number>>({})

// 从提取规则获取可选字段名（仅从已建规则中获取）
const availableFieldNames = computed(() => {
  const fields = new Set<string>()
  formRules.value.forEach((r: any) => {
    if (r.name) fields.add(r.name)
  })
  formDetailRules.value.forEach((r: any) => {
    if (r.name) fields.add(r.name)
  })
  return Array.from(fields)
})

// Pagination handlers
function onPageChange(p: number) {
  page.value = p
  refresh()
}

function onPageSizeChange(s: number) {
  pageSize.value = s
  page.value = 1
  refresh()
}

// Tasks eligible for batch delete
const deletableSelected = computed(() => {
  return selectedIds.value.filter(id => {
    const t = tasks.value.find((x: any) => x.id === id)
    return t && canDelete(t.status)
  })
})

// --- Actions ---
async function refresh() {
  const params: any = {}
  if (statusFilter.value !== 'all') params.status = statusFilter.value
  if (keyword.value.trim()) params.keyword = keyword.value.trim()
  const { data } = await crawlerAPI.getTasksWithPagination(params)
  tasks.value = data.tasks
  total.value = data.total
  // Load item counts
  const { data: itemsResp } = await crawlerAPI.getItems({ pageSize: 10000 })
  const items = itemsResp.data || itemsResp
  const counts: Record<string, number> = {}
  items.forEach((i: any) => {
    counts[i.task_id] = (counts[i.task_id] || 0) + 1
  })
  itemCounts.value = counts
}

// SSE real-time updates — must use full backend URL (EventSource doesn't go through axios)
const SSE_URL = `${import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api'}/crawler/events`

async function refreshItemCounts() {
  const { data: itemsResp } = await crawlerAPI.getItems({ pageSize: 10000 })
  const items = itemsResp.data || itemsResp
  const counts: Record<string, number> = {}
  items.forEach((i: any) => {
    counts[i.task_id] = (counts[i.task_id] || 0) + 1
  })
  itemCounts.value = counts
}

function setupSSE() {
  if (sseConnection) sseConnection.close()
  sseConnection = new EventSource(SSE_URL)
  sseConnection.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data)
      if (evt.type === 'crawl') {
        // Patch the matching task in-place for instant UI update
        const idx = tasks.value.findIndex((t: any) => t.id === evt.taskId)
        if (idx !== -1) {
          if (evt.status === 'deleted') {
            tasks.value.splice(idx, 1)
            selectedIds.value = selectedIds.value.filter(id => id !== evt.taskId)
          } else {
            // Merge new fields into the existing task object
            Object.assign(tasks.value[idx], {
              status: evt.status,
              progress: evt.progress,
              result: evt.result,
              error: evt.error,
              started_at: evt.started_at || tasks.value[idx].started_at,
              updated_at: evt.updated_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
            })
            // Refresh item counts when task reaches a state that has data
            if (['completed', 'failed', 'cancelled', 'paused'].includes(evt.status)) {
              refreshItemCounts()
            }
          }
        } else if (evt.status !== 'deleted') {
          // New task created — refresh full list
          refresh()
        }
      }
    } catch { /* ignore parse errors */ }
  }
  sseConnection.onerror = () => {
    // Reconnect after 3s on error
    sseConnection?.close()
    setTimeout(setupSSE, 3000)
  }
}

function teardownSSE() {
  sseConnection?.close()
  sseConnection = null
}

function openCreateDialog() {
  dialogTitle.value = '新建任务'
  editingTaskId.value = null
  activeStep.value = 0
  formName.value = ''
  formUrl.value = ''
  formMode.value = 'single'
  formItemSelector.value = ''
  formPaginationMode.value = 'none'
  formNextPageSelector.value = ''
  formMaxPages.value = 0
  formMaxItems.value = 20
  formLoadMoreSelector.value = ''
  formUrlPattern.value = ''
  formPageStart.value = 1
  formAutoStart.value = false
  formTitleField.value = []
  formErrorMode.value = 'standard'
  formDetailLinkField.value = []
  formMediaUrlField.value = []
  formIdField.value = []
  formRules.value = [
    { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '', regex: '' },
    { name: 'content', selector: '.content,.article-body,[class*="content"]', attr: '', regex: '' },
  ]
  formDetailLinkSelector.value = ''
  formDetailRules.value = []
  formAutoDownload.value = false
  dialogVisible.value = true
}

function openEditDialog(task: any) {
  const p = task.payload
  dialogTitle.value = '编辑任务'
  editingTaskId.value = task.id
  activeStep.value = 0
  formName.value = p.name || ''
  formUrl.value = p.url || ''
  formMode.value = p.mode || (p.itemSelector ? 'list' : 'single')
  formItemSelector.value = p.itemSelector || ''
  formPaginationMode.value = p.paginationMode || (p.nextPageSelector ? 'page' : 'none')
  formNextPageSelector.value = p.nextPageSelector || ''
  formMaxPages.value = p.maxPages ?? 0
  formMaxItems.value = p.maxItems ?? 20
  formLoadMoreSelector.value = p.loadMoreSelector || ''
  formUrlPattern.value = p.urlPattern || ''
  formPageStart.value = p.pageStart ?? 1
  formTitleField.value = p.titleField ? p.titleField.split(',').map((s: string) => s.trim()).filter(Boolean) : []
  formErrorMode.value = p.errorMode || 'standard'
  formDetailLinkField.value = p.detailLinkField ? p.detailLinkField.split(',').map((s: string) => s.trim()).filter(Boolean) : []
  formMediaUrlField.value = p.mediaUrlField ? p.mediaUrlField.split(',').map((s: string) => s.trim()).filter(Boolean) : []
  formIdField.value = p.idField ? p.idField.split(',').map((s: string) => s.trim()).filter(Boolean) : []
  formAutoDownload.value = p.autoDownload ?? false
  formRules.value = p.rules?.length ? [...p.rules] : [
    { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '' },
    { name: 'content', selector: '.content,.article-body,[class*="content"]', attr: '' },
  ]
  formDetailLinkSelector.value = p.detailLinkSelector || ''
  formDetailRules.value = p.detailRules?.length ? [...p.detailRules] : []
  dialogVisible.value = true
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

function setMode(mode: 'single' | 'list') {
  formMode.value = mode
  if (mode === 'single') {
    // Default to article preset for single page
    if (formRules.value.length <= 2 && formRules.value[0]?.name === 'title') {
      formRules.value = [...presetRules.article]
    }
    formItemSelector.value = ''
    formPaginationMode.value = 'none'
    formNextPageSelector.value = ''
    formLoadMoreSelector.value = ''
    formDetailLinkSelector.value = ''
    formDetailRules.value = []
  } else {
    // Default to list preset
    if (formRules.value.length <= 2 && formRules.value[0]?.name === 'title') {
      formRules.value = [...presetRules.listBasic]
    }
    formItemSelector.value = ''
  }
}

async function submitForm() {
  if (!formUrl.value) { ElMessage.warning('请输入页面地址'); return }
  if (formMode.value === 'list' && !formItemSelector.value) { ElMessage.warning('列表模式需要填写列表项选择器'); return }

  const payload: any = {
    name: formName.value || formUrl.value.slice(0, 60),
    url: formUrl.value,
    mode: formMode.value,
    rules: formRules.value.filter(r => r.name && r.selector),
    itemSelector: formMode.value === 'list' ? (formItemSelector.value || undefined) : undefined,
    paginationMode: formMode.value === 'list' ? formPaginationMode.value : 'none',
    nextPageSelector: formNextPageSelector.value || undefined,
    maxPages: formPaginationMode.value === 'page' ? formMaxPages.value : undefined,
    maxItems: formPaginationMode.value === 'count' ? formMaxItems.value : undefined,
    loadMoreSelector: formLoadMoreSelector.value || undefined,
    urlPattern: formUrlPattern.value || undefined,
    pageStart: formUrlPattern.value ? formPageStart.value : undefined,
    detailLinkSelector: formDetailLinkSelector.value || undefined,
    detailRules: formDetailRules.value.filter(r => r.name && r.selector).length
      ? formDetailRules.value.filter(r => r.name && r.selector) : undefined,
    autoStart: editingTaskId.value ? undefined : formAutoStart.value,
    titleField: formTitleField.value.length ? formTitleField.value.join(',') : undefined,
    detailLinkField: formDetailLinkField.value.length ? formDetailLinkField.value.join(',') : undefined,
    mediaUrlField: formMediaUrlField.value.length ? formMediaUrlField.value.join(',') : undefined,
    idField: formIdField.value.length ? formIdField.value.join(',') : undefined,
    errorMode: formErrorMode.value,
    autoDownload: formAutoDownload.value || undefined,
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

async function startTask(id: string) {
  try {
    await crawlerAPI.startTask(id)
    ElMessage.success('任务已开始')
    refresh()
  } catch { ElMessage.error('操作失败') }
}

async function pauseTask(id: string) {
  try {
    await crawlerAPI.pauseTask(id)
    ElMessage.success('任务已暂停')
    refresh()
  } catch { ElMessage.error('操作失败') }
}

async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要终止此任务吗？已采集的数据会保留。', '确认', { type: 'warning' })
    await crawlerAPI.stopTask(id)
    ElMessage.success('任务已终止')
    refresh()
  } catch { /* cancelled */ }
}

async function retryTask(id: string) {
  try {
    await crawlerAPI.retryTask(id)
    ElMessage.success('已重新加入队列')
    refresh()
  } catch { ElMessage.error('操作失败') }
}

async function reRunTask(id: string) {
  try {
    await ElMessageBox.confirm('重新运行将清除已有的采集数据并从头开始，确定继续？', '确认', { type: 'warning' })
    await crawlerAPI.reRunTask(id)
    ElMessage.success('任务已重新运行')
    refresh()
  } catch { /* cancelled */ }
}

async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此任务吗？相关的采集数据也会被删除。', '确认删除', {
      type: 'warning',
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
    })
    await crawlerAPI.deleteTask(id)
    ElMessage.success('任务已删除')
    selectedIds.value = selectedIds.value.filter(sid => sid !== id)
    refresh()
  } catch { /* cancelled */ }
}

async function clearItems(id: string) {
  try {
    const task = tasks.value.find((t: any) => t.id === id)
    const name = task?.payload?.name || task?.payload?.url || id.slice(0, 8)
    await ElMessageBox.confirm(`确定要清空任务「${name}」下的所有采集项吗？采集任务本身不会被删除。`, '清空采集项', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
    await crawlerAPI.clearItems(id)
    ElMessage.success('已清空所有采集项')
    refresh()
  } catch { /* cancelled */ }
}

async function batchDelete() {
  const ids = deletableSelected.value
  if (!ids.length) { ElMessage.warning('所选任务中没有可删除的（只能删除已完成/失败/已终止/未开始的任务）'); return }
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${ids.length} 个任务吗？相关的采集数据也会被删除。`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    )
    const res = await crawlerAPI.batchDeleteTasks(ids)
    const okCount = res.data?.filter?.((r: any) => r.ok)?.length ?? 0
    const failCount = res.data?.filter?.((r: any) => !r.ok)?.length ?? 0
    if (failCount) {
      ElMessage.warning(`成功删除 ${okCount} 个，${failCount} 个失败`)
    } else {
      ElMessage.success(`已删除 ${okCount} 个任务`)
    }
    selectedIds.value = []
    refresh()
  } catch { /* cancelled */ }
}

function viewResults(task: any) {
  router.push({ path: '/crawler/items', query: { taskId: task.id } })
}

// --- Status helpers ---
function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: '未开始', running: '进行中', completed: '已完成',
    failed: '执行失败', cancelled: '用户终止', paused: '已暂停',
  }
  return map[s] || s
}

function statusClass(s: string) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    running: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
    failed: 'bg-red-500/15 text-red-300 border-red-500/25',
    cancelled: 'bg-gray-500/15 text-gray-400 border-gray-500/25',
    paused: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
    pending: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  }
  return map[s] || ''
}

// Action visibility per status
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
  const start = new Date(task.started_at + 'Z').getTime()
  const end = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
    ? new Date(task.updated_at + 'Z').getTime()
    : Date.now()
  if (isNaN(start) || isNaN(end) || end <= start) return '-'
  const sec = Math.floor((end - start) / 1000)
  if (sec < 60) return `${sec}秒`
  if (sec < 3600) return `${Math.floor(sec / 60)}分${sec % 60}秒`
  return `${Math.floor(sec / 3600)}时${Math.floor((sec % 3600) / 60)}分`
}

function handleSelectionChange(rows: any[]) {
  selectedIds.value = rows.map((r: any) => r.id)
}

function isRowSelectable(row: any) {
  return canDelete(row.status)
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
        <h2 class="text-lg font-bold mb-1">爬虫任务</h2>
        <p class="text-[13px] text-gray-500">管理采集任务配置，查看任务执行状态与采集结果</p>
      </div>
      <div class="flex items-center gap-2">
        <el-button
          v-if="deletableSelected.length"
          type="danger" size="small" plain
          @click="batchDelete"
        >
          <i class="fas fa-trash-can mr-1.5"></i>批量删除 ({{ deletableSelected.length }})
        </el-button>
        <el-button type="primary" size="small" @click="openCreateDialog">
          <i class="fas fa-plus mr-1.5"></i>新建任务
        </el-button>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center justify-between mb-4 card-static">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs text-gray-400">状态筛选：</span>
        <el-select v-model="statusFilter" size="small" class="!w-28">
          <el-option label="全部" value="all" />
          <el-option label="未开始" value="pending" />
          <el-option label="进行中" value="running" />
          <el-option label="已暂停" value="paused" />
          <el-option label="已完成" value="completed" />
          <el-option label="执行失败" value="failed" />
          <el-option label="用户终止" value="cancelled" />
        </el-select>
        <div class="relative !w-48">
          <el-input
            v-model="keyword"
            size="small"
            placeholder="搜索任务名/URL"
            clearable
          >
            <template #prefix>
              <i class="fas fa-magnifying-glass text-gray-500 text-[12px]"></i>
            </template>
          </el-input>
        </div>
      </div>
    </div>

    <!-- Task Table -->
    <div class="card-static">
      <el-table
        v-if="tasks.length"
        :data="tasks"
        size="small"
        row-key="id"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="40" :selectable="isRowSelectable" fixed="left" :reserve-selection="true" />
        <el-table-column type="index" label="序号" width="55" align="center" fixed="left" />
        <el-table-column label="任务名称" min-width="140" show-overflow-tooltip fixed="left">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <i v-if="(row.payload?.mode || (row.payload?.itemSelector ? 'list' : 'single')) === 'single'"
                class="fas fa-file-lines text-[11px] text-blue-400" title="单页采集"></i>
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
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
              :class="statusClass(row.status)">
              {{ statusLabel(row.status) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="140">
          <template #default="{ row }">
            <el-progress
              :percentage="row.progress"
              :stroke-width="6"
              :status="row.status === 'failed' ? 'exception' : row.status === 'completed' ? 'success' : undefined"
            />
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
            <span class="text-xs" :class="row.status === 'running' ? 'text-blue-400' : 'text-gray-500'">
              {{ formatDuration(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="280" align="center" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <el-button v-if="canStart(row.status)" size="small" type="primary" plain @click="startTask(row.id)">
                {{ row.status === 'paused' ? '继续' : '开始' }}
              </el-button>
              <el-button v-if="canPause(row.status)" size="small" type="warning" plain @click="pauseTask(row.id)">
                暂停
              </el-button>
              <el-button v-if="canStop(row.status)" size="small" type="danger" plain @click="stopTask(row.id)">
                终止
              </el-button>
              <el-button v-if="canRetry(row.status)" size="small" type="warning" plain @click="retryTask(row.id)">
                重试
              </el-button>
              <el-button v-if="canReRun(row.status)" size="small" plain @click="reRunTask(row.id)">
                重新执行
              </el-button>
              <el-button v-if="canEdit(row.status)" size="small" plain @click="openEditDialog(row)">
                编辑
              </el-button>
              <el-button v-if="canViewResults(row.status)" size="small" type="success" plain @click="viewResults(row)">
                查看结果
              </el-button>
              <el-button v-if="canDelete(row.status)" size="small" type="danger" plain @click="deleteTask(row.id)">
                删除
              </el-button>
              <el-button v-if="canDelete(row.status)" size="small" plain @click="clearItems(row.id)">
                清空采集项
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="total > pageSize" class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next"
          size="small"
          background
          @size-change="onPageSizeChange"
          @current-change="onPageChange"
        />
      </div>
      <div v-if="!tasks.length" class="text-center py-12 text-gray-500 text-sm">
        <i class="fas fa-bug text-3xl mb-3 block opacity-30"></i>暂无任务
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="820px" destroy-on-close top="3vh" :close-on-click-modal="false">
      <!-- Step 1: Mode & Basic Info -->
      <div class="space-y-5">
        <!-- === Step 1: 采集模式 === -->
        <div>
          <h4 class="text-sm font-semibold mb-3 flex items-center gap-2">
            <span class="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[11px] font-bold">1</span>
            <span>采集模式</span>
          </h4>
          <div class="flex gap-3">
            <div
              class="flex-1 p-4 rounded-lg border cursor-pointer transition-all"
              :class="formMode === 'single'
                ? 'border-blue-500/50 bg-blue-500/8'
                : 'border-gray-700/40 bg-gray-900/30 hover:border-gray-600/50'"
              @click="setMode('single')"
            >
              <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-file-lines text-blue-400"></i>
                <span class="text-sm font-semibold">单页采集</span>
              </div>
              <p class="text-[11px] text-gray-500 leading-relaxed">
                抓取单个页面内容，如新闻详情页、文章页。<br />
                结果为一个结构化对象，包含标题、正文、日期等字段。
              </p>
            </div>
            <div
              class="flex-1 p-4 rounded-lg border cursor-pointer transition-all"
              :class="formMode === 'list'
                ? 'border-blue-500/50 bg-blue-500/8'
                : 'border-gray-700/40 bg-gray-900/30 hover:border-gray-600/50'"
              @click="setMode('list')"
            >
              <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-list text-amber-400"></i>
                <span class="text-sm font-semibold">列表采集</span>
              </div>
              <p class="text-[11px] text-gray-500 leading-relaxed">
                抓取列表页面中的所有条目，如产品列表、文章列表。<br />
                结果为一个数组，每项包含标题、价格、图片等字段。
              </p>
            </div>
          </div>
        </div>

        <!-- === Step 2: 基本配置 === -->
        <div>
          <h4 class="text-sm font-semibold mb-3 flex items-center gap-2">
            <span class="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[11px] font-bold">2</span>
            <span>基本配置</span>
          </h4>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <div class="text-xs text-gray-400 mb-1.5">
                任务名称
                <span class="text-gray-600">（可选）</span>
              </div>
              <el-input v-model="formName" placeholder="留空则截取 URL 前60字符" size="small" />
            </div>
            <div>
              <div class="text-xs text-gray-400 mb-1.5">
                页面地址
                <span class="text-red-400">*</span>
              </div>
              <el-input v-model="formUrl" placeholder="https://example.com/articles/123" size="small" />
            </div>
          </div>
          <div class="mt-4 space-y-3">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <div class="text-xs text-gray-400 mb-1.5">
                  标题字段
                  <el-tooltip placement="top" effect="dark" content="采集列表中每条数据显示的标题，填入提取规则中的字段名。留空自动智能查找；可添加多个字段，按顺序匹配">
                    <i class="fas fa-circle-question text-gray-600 cursor-help ml-1"></i>
                  </el-tooltip>
                </div>
                <el-select v-model="formTitleField" multiple filterable allow-create default-first-option placeholder="留空自动查找" size="small" class="!w-full">
                  <el-option v-for="f in availableFieldNames" :key="f" :label="f" :value="f" />
                </el-select>
              </div>
              <div>
                <div class="text-xs text-gray-400 mb-1.5">
                  详情链接字段
                  <el-tooltip placement="top" effect="dark" content="提取规则中哪个字段的值是详情页 URL；可添加多个字段，按顺序匹配">
                    <i class="fas fa-circle-question text-gray-600 cursor-help ml-1"></i>
                  </el-tooltip>
                </div>
                <el-select v-model="formDetailLinkField" multiple filterable allow-create default-first-option placeholder="如: link" size="small" class="!w-full">
                  <el-option v-for="f in availableFieldNames" :key="f" :label="f" :value="f" />
                </el-select>
              </div>
              <div>
                <div class="text-xs text-gray-400 mb-1.5">
                  媒体资源字段
                  <el-tooltip placement="top" effect="dark" content="存放视频/音频/图片 URL 的字段名；可添加多个字段，按顺序匹配，留空自动查找">
                    <i class="fas fa-circle-question text-gray-600 cursor-help ml-1"></i>
                  </el-tooltip>
                </div>
                <el-select v-model="formMediaUrlField" multiple filterable allow-create default-first-option placeholder="如: videoUrl" size="small" class="!w-full">
                  <el-option v-for="f in availableFieldNames" :key="f" :label="f" :value="f" />
                </el-select>
              </div>
              <div>
                <div class="text-xs text-gray-400 mb-1.5">
                  唯一标识字段
                  <el-tooltip placement="top" effect="dark" content="能唯一标识每一项的字段名（如 id）；可添加多个字段，按顺序匹配。重试/重采时优先用该字段匹配">
                    <i class="fas fa-circle-question text-gray-600 cursor-help ml-1"></i>
                  </el-tooltip>
                </div>
                <el-select v-model="formIdField" multiple filterable allow-create default-first-option placeholder="如: id" size="small" class="!w-full">
                  <el-option v-for="f in availableFieldNames" :key="f" :label="f" :value="f" />
                </el-select>
              </div>
            </div>
          </div>

          <div class="mt-4">
            <div class="text-xs text-gray-400 mb-1.5">容错级别</div>
            <div class="flex gap-2">
              <el-button
                v-for="opt in [
                  { k: 'lenient', l: '宽松', icon: 'fa-circle-check', desc: '所有错误跳过不中断' },
                  { k: 'standard', l: '标准', icon: 'fa-circle-half-stroke', desc: '重试后跳过（推荐）' },
                  { k: 'strict', l: '严格', icon: 'fa-circle-xmark', desc: '任何错误立即终止' },
                ]" :key="opt.k"
                size="small"
                :type="formErrorMode === opt.k ? 'primary' : 'default'"
                :plain="formErrorMode !== opt.k"
                @click="formErrorMode = opt.k as any"
              >
                <i :class="'fas ' + opt.icon + ' mr-1'"></i>{{ opt.l }}
              </el-button>
            </div>
            <div class="text-[11px] text-gray-600 mt-1">
              {{ formErrorMode === 'lenient' ? '列表页或详情页访问失败均跳过，尽可能多地采集数据。404 视为翻页结束。' :
                 formErrorMode === 'standard' ? '失败自动重试 1-2 次，仍失败则跳过该项继续；404 视为翻页结束。' :
                 '任何页面或详情页访问失败立即终止任务，适合对数据完整性要求高的场景。' }}
            </div>
          </div>

          <!-- 自动下载配置 -->
          <div class="mt-4">
            <el-checkbox v-model="formAutoDownload">
              <span class="text-xs text-gray-300">自动下载媒体资源</span>
              <el-tooltip placement="top" effect="dark" content="开启后，采集完成会自动将媒体资源字段中的 URL 加入下载队列。下载范围由上方'媒体资源字段'决定，留空则扫描所有 URL 字段" class="ml-1">
                <i class="fas fa-circle-question text-gray-600 cursor-help"></i>
              </el-tooltip>
            </el-checkbox>
            <div v-if="formAutoDownload" class="mt-3 ml-6">
              <div class="text-[11px] text-gray-500">
                下载范围由上方 <strong class="text-gray-400">媒体资源字段</strong> 决定。
                <template v-if="formMediaUrlField.length">
                  已配置: {{ formMediaUrlField.join('、') }}
                </template>
                <template v-else>
                  未指定，将自动扫描所有包含 URL 的字段进行下载。
                </template>
              </div>
            </div>
          </div>

          <!-- List mode: item selector + pagination -->
          <template v-if="formMode === 'list'">
            <div class="mt-4 p-4 rounded-lg bg-gray-900/30 border border-gray-700/30 space-y-4">
              <div class="flex items-center gap-2 text-xs text-gray-400 mb-2">
                <i class="fas fa-list-check text-amber-400"></i>
                <span class="font-medium">列表配置</span>
              </div>

              <div>
                <div class="text-xs text-gray-400 mb-1.5">
                  列表项选择器
                  <span class="text-red-400">*</span>
                </div>
                <el-input v-model="formItemSelector" placeholder=".article-item, li.post, .product-card" size="small" />
                <div class="text-[11px] text-gray-600 mt-1">
                  CSS 选择器，用于定位列表中的每一项。例如 <code class="text-gray-500">.news-item</code>、<code class="text-gray-500">li.article</code>
                </div>
              </div>

              <!-- Pagination config -->
              <div>
                <div class="text-xs text-gray-400 mb-2">翻页 / 加载方式</div>
                <div class="flex gap-2 mb-3">
                  <el-button
                    v-for="opt in [
                      { k: 'none', l: '不翻页', icon: 'fa-ban' },
                      { k: 'page', l: '按页数', icon: 'fa-file' },
                      { k: 'count', l: '按条数', icon: 'fa-hashtag' },
                    ]" :key="opt.k"
                    size="small"
                    :type="formPaginationMode === opt.k ? 'primary' : 'default'"
                    :plain="formPaginationMode !== opt.k"
                    @click="formPaginationMode = opt.k as any"
                  >
                    <i :class="'fas ' + opt.icon + ' mr-1'"></i>{{ opt.l }}
                  </el-button>
                </div>

                <!-- Page-based -->
                <div v-if="formPaginationMode === 'page'" class="space-y-4">
                  <div class="flex items-center gap-3">
                    <div class="text-xs text-gray-400">抓取页数</div>
                    <el-input-number v-model="formMaxPages" :min="0" :max="9999" size="small" />
                    <span class="text-[11px]" :class="formMaxPages === 0 ? 'text-emerald-400' : 'text-gray-600'">
                      {{ formMaxPages === 0 ? '抓取全部页面' : '页' }}
                    </span>
                  </div>
                  <!-- Method 1: CSS selector -->
                  <div class="p-3 rounded-lg bg-gray-900/40 border border-gray-700/20">
                    <div class="text-[11px] text-gray-500 mb-2 font-medium">方式一：CSS 选择器翻页</div>
                    <div>
                      <div class="text-xs text-gray-400 mb-1.5">下一页选择器</div>
                      <el-input v-model="formNextPageSelector" placeholder=".pagination .next, a[rel='next']" size="small" />
                    </div>
                    <div class="text-[11px] text-gray-600 mt-2">在页面中找到"下一页"链接并跟随，适用于有独立 .next 按钮的站点</div>
                  </div>
                  <!-- Method 2: URL pattern -->
                  <div class="p-3 rounded-lg bg-gray-900/40 border border-gray-700/20">
                    <div class="text-[11px] text-gray-500 mb-2 font-medium">方式二：URL 模式翻页（推荐）</div>
                    <div class="grid grid-cols-3 gap-3">
                      <div class="col-span-2">
                        <div class="text-xs text-gray-400 mb-1.5">URL 模板</div>
                        <el-input v-model="formUrlPattern" placeholder="https://example.com/list?page={page}" size="small" />
                      </div>
                      <div>
                        <div class="text-xs text-gray-400 mb-1.5">起始页码</div>
                        <el-input-number v-model="formPageStart" :min="1" :max="9999" size="small" class="!w-full" />
                      </div>
                    </div>
                    <div class="text-[11px] text-gray-600 mt-2">
                      用 <code class="text-gray-400">{page}</code> 表示页码。起始页码配合上方"抓取页数"可指定从第几页开始抓多少页
                    </div>
                  </div>
                </div>

                <!-- Count-based -->
                <div v-if="formPaginationMode === 'count'" class="space-y-4">
                  <div class="flex items-center gap-3">
                    <div class="text-xs text-gray-400">抓取条数</div>
                    <el-input-number v-model="formMaxItems" :min="1" :max="99999" size="small" />
                    <span class="text-[11px] text-gray-600">条</span>
                  </div>
                  <!-- Method 1: CSS selector -->
                  <div class="p-3 rounded-lg bg-gray-900/40 border border-gray-700/20">
                    <div class="text-[11px] text-gray-500 mb-2 font-medium">方式一：CSS 选择器翻页</div>
                    <div>
                      <div class="text-xs text-gray-400 mb-1.5">下一页选择器</div>
                      <el-input v-model="formNextPageSelector" placeholder=".pagination .next, a[rel='next']" size="small" />
                    </div>
                  </div>
                  <!-- Method 2: URL pattern -->
                  <div class="p-3 rounded-lg bg-gray-900/40 border border-gray-700/20">
                    <div class="text-[11px] text-gray-500 mb-2 font-medium">方式二：URL 模式翻页（推荐）</div>
                    <div class="grid grid-cols-3 gap-3">
                      <div class="col-span-2">
                        <div class="text-xs text-gray-400 mb-1.5">URL 模板</div>
                        <el-input v-model="formUrlPattern" placeholder="https://example.com/list?page={page}" size="small" />
                      </div>
                      <div>
                        <div class="text-xs text-gray-400 mb-1.5">起始页码</div>
                        <el-input-number v-model="formPageStart" :min="1" :max="9999" size="small" class="!w-full" />
                      </div>
                    </div>
                  </div>
                </div>

                <!-- No pagination -->
                <div v-if="formPaginationMode === 'none'" class="text-[11px] text-gray-600">
                  仅抓取当前页面内容，不进行翻页
                </div>
              </div>

              <!-- Load more selector (experimental) -->
              <div>
                <div class="text-xs text-gray-400 mb-1.5">
                  加载更多选择器
                  <span class="text-gray-600">（实验性，适用于链接型"加载更多"）</span>
                </div>
                <el-input v-model="formLoadMoreSelector" placeholder=".load-more, button.more, a.more-btn" size="small" />
                <div class="text-[11px] text-gray-600 mt-1">
                  部分站点使用"加载更多"按钮而非分页，填写按钮/链接的 CSS 选择器可尝试抓取。
                  纯 JS 滚动加载的站点暂不支持。
                </div>
              </div>
            </div>
            </template>
          </div>

        <!-- === Step 3: 提取规则 === -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-semibold flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[11px] font-bold">3</span>
              <span>提取规则</span>
            </h4>
            <div class="flex gap-1.5">
              <template v-if="formMode === 'single'">
                <el-button size="small" @click="applyPreset('article')">文章模板</el-button>
                <el-button size="small" @click="applyPreset('media')">媒体模板</el-button>
              </template>
              <template v-else>
                <el-button size="small" @click="applyPreset('product')">商品模板</el-button>
                <el-button size="small" @click="applyPreset('listBasic')">基础列表</el-button>
              </template>
              <el-button size="small" @click="addRule('list')"><i class="fas fa-plus mr-1"></i>添加字段</el-button>
            </div>
          </div>

          <div class="p-3 rounded-lg bg-gray-900/30 border border-gray-700/30">
            <div class="space-y-2">
              <div v-for="(rule, i) in formRules" :key="i"
                class="flex items-center gap-3 p-2.5 rounded-lg bg-gray-900/60 border border-gray-700/30">
                <span class="text-[11px] text-gray-600 w-5 text-center font-mono">{{ i + 1 }}</span>
                <div class="w-28">
                  <div class="text-[10px] text-gray-500 mb-0.5">字段名</div>
                  <el-input v-model="rule.name" placeholder="如: title" size="small" />
                </div>
                <div class="flex-1">
                  <div class="text-[10px] text-gray-500 mb-0.5">CSS 选择器</div>
                  <el-input v-model="rule.selector" placeholder="如: h1, .title, [class*='headline']" size="small" />
                </div>
                <div class="w-28">
                  <div class="text-[10px] text-gray-500 mb-0.5">
                    提取方式
                    <el-tooltip placement="top" effect="dark" content="留空 = 提取标签内文本；填写 = 提取标签属性值（如 src、href、data-url）">
                      <i class="fas fa-circle-question text-gray-600 cursor-help ml-0.5"></i>
                    </el-tooltip>
                  </div>
                  <el-input v-model="rule.attr" placeholder="属性名(可选)" size="small" />
                </div>
                <div class="w-32">
                  <div class="text-[10px] text-gray-500 mb-0.5">
                    正则截取
                    <el-tooltip placement="top" effect="dark" content="用正则捕获组截取部分内容，如从 URL 提取 ID：/product/(\d+) — 留空取完整值">
                      <i class="fas fa-circle-question text-gray-600 cursor-help ml-0.5"></i>
                    </el-tooltip>
                  </div>
                  <el-input v-model="rule.regex" placeholder="如: (\d+)" size="small" />
                </div>
                <el-button v-if="formRules.length > 1" size="small" type="danger" circle plain @click="removeRule('list', i)">
                  <i class="fas fa-xmark"></i>
                </el-button>
              </div>
            </div>

            <div class="mt-3 p-2.5 rounded-lg bg-gray-800/40 border border-gray-700/20">
              <div class="text-[11px] text-gray-500 leading-relaxed">
                <strong class="text-gray-400">💡 提取说明：</strong>
                每条规则包含四个部分 ——
                <span class="text-gray-400">字段名</span>（存储时的 key）、
                <span class="text-gray-400">CSS 选择器</span>（定位目标元素）、
                <span class="text-gray-400">提取方式</span>（留空取<strong>文本</strong>，填写属性名取<strong>属性值</strong>）、
                <span class="text-gray-400">正则截取</span>（可选，用捕获组截取部分内容。如链接 <code>/product/12345</code> 用正则 <code>/product/(\d+)</code> 只提取出 <code>12345</code>）
              </div>
            </div>
          </div>
        </div>

        <!-- === Step 4: 详情页配置（列表模式可选）=== -->
        <div v-if="formMode === 'list'">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-semibold flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-gray-500/20 text-gray-400 flex items-center justify-center text-[11px] font-bold">4</span>
              <span>详情页提取 <span class="text-[11px] text-gray-600 font-normal">（可选）</span></span>
            </h4>
            <el-button size="small" @click="addRule('detail')"><i class="fas fa-plus mr-1"></i>添加字段</el-button>
          </div>

          <div class="mb-3">
            <div class="text-xs text-gray-400 mb-1.5">详情页链接选择器</div>
            <el-input v-model="formDetailLinkSelector" placeholder="从列表项中提取详情页链接，如: a.title, h2 a" size="small" class="!w-96" />
            <div class="text-[11px] text-gray-600 mt-1">
              填写后，程序会进入每个列表项的详情页，按下方规则提取更多字段（如正文、标签等）
            </div>
          </div>

          <div v-if="formDetailRules.length" class="space-y-2 p-3 rounded-lg bg-gray-900/30 border border-gray-700/30">
            <div v-for="(rule, i) in formDetailRules" :key="i"
              class="flex items-center gap-3 p-2.5 rounded-lg bg-gray-900/60 border border-gray-700/30">
              <span class="text-[11px] text-gray-600 w-5 text-center font-mono">{{ i + 1 }}</span>
              <div class="w-28">
                <div class="text-[10px] text-gray-500 mb-0.5">字段名</div>
                <el-input v-model="rule.name" placeholder="字段名" size="small" />
              </div>
              <div class="flex-1">
                <div class="text-[10px] text-gray-500 mb-0.5">CSS 选择器</div>
                <el-input v-model="rule.selector" placeholder="CSS 选择器" size="small" />
              </div>
              <div class="w-28">
                <div class="text-[10px] text-gray-500 mb-0.5">提取方式</div>
                <el-input v-model="rule.attr" placeholder="属性(可选)" size="small" />
              </div>
              <div class="w-32">
                <div class="text-[10px] text-gray-500 mb-0.5">正则截取</div>
                <el-input v-model="rule.regex" placeholder="如: (\d+)" size="small" />
              </div>
              <el-button size="small" type="danger" circle plain @click="removeRule('detail', i)">
                <i class="fas fa-xmark"></i>
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-between">
          <el-checkbox v-if="!editingTaskId" v-model="formAutoStart" size="small">
            <span class="text-xs text-gray-400">创建后自动执行</span>
          </el-checkbox>
          <span v-else></span>
          <div class="flex gap-2">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" :disabled="!formUrl || loading" :loading="loading" @click="submitForm">
              {{ editingTaskId ? '保存修改' : (formAutoStart ? '创建并执行' : '创建任务') }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
