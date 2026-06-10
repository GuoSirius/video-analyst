<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, reactive, computed } from 'vue'
import { transcoderAPI } from '../api'
import api from '../api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePagination } from '../composables/usePagination'
import StatusBadge from '../components/StatusBadge.vue'
import CommandDialog from '../components/CommandDialog.vue'

// --- FFmpeg Status ---
const ffmpegStatus = ref<any>(null)

// --- Data ---
const tasks = ref<any[]>([])
const selectedIds = ref<string[]>([])
const selectedItemsMeta = reactive<Record<string, any>>({})
const tableRef = ref<any>(null)
let syncingSelection = false
const loading = ref(false)

// --- Filters ---
const sourceFilter = ref('all')
const statusFilter = ref('all')
const keyword = ref('')

// --- Pagination ---
const { page, pageSize, total, pageSizes, onPageChange, onPageSizeChange } = usePagination({
  defaultPageSize: 20,
  onFetch: () => fetchTasks(),
})

// --- Command Dialog ---
const cmdDialog = ref(false)
const cmdTitle = ref('')
const cmdCommands = ref<{ label: string; content: string }[]>([])
const cmdDetails = ref<{ label: string; value: string }[]>([])
const cmdLoading = ref(false)

// --- Upload Dialog ---
const uploadDialog = ref(false)
const pendingFiles = ref<{ name: string; file: File }[]>([])
const uploading = ref(false)

// --- SSE ---
let sseConnection: EventSource | null = null

const statusLabels: Record<string, string> = {
  pending: '待转码',
  running: '转码中',
  completed: '已转码',
  failed: '转码失败',
  cancelled: '已取消',
  paused: '已暂停',
}

// ════════════════════════════════════════════════════════════════
// Actions
// ════════════════════════════════════════════════════════════════

async function checkFfmpeg() {
  try {
    const { data } = await transcoderAPI.checkFfmpeg()
    ffmpegStatus.value = data
  } catch { ffmpegStatus.value = null }
}

async function fetchTasks() {
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize: pageSize.value }
    if (sourceFilter.value !== 'all') params.source = sourceFilter.value
    if (statusFilter.value !== 'all') params.status = statusFilter.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()

    const { data } = await api.get('/tasks', { params: { ...params, type: 'transcode' } })
    tasks.value = data.items || data
    total.value = data.total || (Array.isArray(data) ? data.length : 0)
    await nextTick()
    syncTableSelection()
  } catch {
    ElMessage.error('获取任务列表失败')
  }
  loading.value = false
}

watch([sourceFilter, statusFilter, keyword], () => {
  page.value = 1
  fetchTasks()
})

function resetFilters() {
  keyword.value = ''
  sourceFilter.value = 'all'
  statusFilter.value = 'all'
  page.value = 1
  fetchTasks()
}

// ════════════════════════════════════════════════════════════════
// Selection
// ════════════════════════════════════════════════════════════════

function handleSelectionChange(rows: any[]) {
  if (syncingSelection) return
  const visibleIds = new Set(tasks.value.map((t: any) => t.id))
  const newSelected = new Map(rows.map((r: any) => [r.id, r]))
  for (const id of visibleIds) {
    if (!newSelected.has(id)) {
      selectedIds.value = selectedIds.value.filter(x => x !== id)
      delete selectedItemsMeta[id]
    }
  }
  for (const [id, row] of newSelected) {
    if (!selectedIds.value.includes(id)) selectedIds.value.push(id)
    selectedItemsMeta[id] = { id, status: row.status }
  }
}

function syncTableSelection() {
  if (!tableRef.value) return
  syncingSelection = true
  tasks.value.forEach((row: any) => {
    if (selectedIds.value.includes(row.id)) tableRef.value.toggleRowSelection(row, true)
  })
  syncingSelection = false
}

async function clearAllSelections() {
  try {
    await ElMessageBox.confirm(
      `确定要清空全部 ${selectedIds.value.length} 个选择吗？`, '清空选择',
      { type: 'warning', confirmButtonText: '确定清空', cancelButtonText: '取消' },
    )
    for (const id of selectedIds.value) delete selectedItemsMeta[id]
    selectedIds.value = []
    tableRef.value?.clearSelection()
    fetchTasks()
  } catch { /* cancelled */ }
}

// ════════════════════════════════════════════════════════════════
// Upload
// ════════════════════════════════════════════════════════════════

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  for (const f of Array.from(input.files)) {
    if (!pendingFiles.value.some(p => p.name === f.name && p.file.size === f.size)) {
      pendingFiles.value.push({ name: f.name, file: f })
    }
  }
  input.value = ''
}

function removePendingFile(index: number) { pendingFiles.value.splice(index, 1) }

async function confirmUpload() {
  if (!pendingFiles.value.length) { ElMessage.warning('请先选择文件'); return }
  uploading.value = true
  try {
    const fd = new FormData()
    for (const pf of pendingFiles.value) fd.append('files', pf.file)
    const { data: upData } = await transcoderAPI.upload(fd)
    const { data: convData } = await transcoderAPI.startConvert({
      files: upData.files,
      fileNames: pendingFiles.value.map(p => p.name),
    })
    if (convData.error) { ElMessage.error(convData.error); return }
    ElMessage.success(`已创建 ${convData.tasks.length} 个转码任务`)
    uploadDialog.value = false
    pendingFiles.value = []
    await fetchTasks()
  } catch { ElMessage.error('操作失败') }
  uploading.value = false
}

// ════════════════════════════════════════════════════════════════
// Single Task Operations
// ════════════════════════════════════════════════════════════════

async function startTask(id: string) {
  try { await transcoderAPI.startTask(id); ElMessage.success('转码任务已开始'); fetchTasks() }
  catch { ElMessage.error('操作失败') }
}

async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要停止此转码任务吗？已处理的部分将丢失。', '确认停止', { type: 'warning' })
    await transcoderAPI.stopTask(id); ElMessage.success('任务已停止'); fetchTasks()
  } catch { /* cancelled */ }
}

async function retryTask(id: string) {
  try { await transcoderAPI.retryTask(id); ElMessage.success('已重新加入队列'); fetchTasks() }
  catch { ElMessage.error('操作失败') }
}

async function reRunTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要重新转码吗？将覆盖原有输出文件。', '确认重新转码', { type: 'warning' })
    await transcoderAPI.reRunTask(id); ElMessage.success('任务已重新运行'); fetchTasks()
  } catch { /* cancelled */ }
}

async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此转码任务吗？输出文件不会被删除。', '确认删除', { type: 'warning' })
    await transcoderAPI.deleteTask(id); ElMessage.success('任务已删除'); fetchTasks()
  } catch { /* cancelled */ }
}

// ════════════════════════════════════════════════════════════════
// View Command
// ════════════════════════════════════════════════════════════════

function getFfmpegCommand(task: any): string {
  const p = task.payload || {}
  const input = p.file || p.fileName || 'input'
  const output = task.result?.outputPath || 'output.wav'
  return [
    'ffmpeg \\',
    `  -i "${input}" \\`,
    '  -ar 16000 \\',
    '  -ac 1 \\',
    '  -c:a pcm_s16le \\',
    '  -y \\',
    `  "${output}"`,
  ].join('\n')
}

function viewCommand(task: any) {
  cmdLoading.value = true
  cmdTitle.value = task.status === 'failed' ? '转码失败·等效命令' : '转码成功·等效命令'
  cmdDetails.value = [
    { label: '输入文件', value: task.payload?.fileName || task.payload?.file?.split(/[\\/]/).pop() || '-' },
    { label: '目标参数', value: '16kHz · mono · 16-bit PCM WAV' },
    { label: '输出文件', value: task.result?.outputPath?.split(/[\\/]/).pop() || '-' },
    { label: '状态', value: statusLabels[task.status] || task.status },
    { label: '转码日志', value: task.error || task.result?.outputPath ? '成功' : '-' },
  ]
  cmdCommands.value = [{ label: '等效命令', content: getFfmpegCommand(task) }]
  cmdLoading.value = false
  cmdDialog.value = true
}

// ════════════════════════════════════════════════════════════════
// Batch Operations
// ════════════════════════════════════════════════════════════════

const pendingIds = computed(() => selectedIds.value.filter(id => selectedItemsMeta[id]?.status === 'pending' || selectedItemsMeta[id]?.status === 'paused'))
const failedIds = computed(() => selectedIds.value.filter(id => selectedItemsMeta[id]?.status === 'failed' || selectedItemsMeta[id]?.status === 'cancelled'))
const completedIds = computed(() => selectedIds.value.filter(id => selectedItemsMeta[id]?.status === 'completed'))
const runningIds = computed(() => selectedIds.value.filter(id => selectedItemsMeta[id]?.status === 'running'))

async function batchStart() {
  const ids = pendingIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有待转码的任务'); return }
  try {
    await ElMessageBox.confirm(
      `确定要启动选中的 ${ids.length} 个转码任务吗？`, '批量转码',
      { type: 'info', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
    for (const id of ids) await transcoderAPI.startTask(id).catch(() => {})
    ElMessage.success(`已启动 ${ids.length} 个转码任务`)
    fetchTasks()
  } catch { /* cancelled */ }
}

async function batchRetry() {
  const ids = failedIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有失败的任务'); return }
  try {
    await ElMessageBox.confirm(
      `确定要重试选中的 ${ids.length} 个转码任务吗？`, '批量重试',
      { type: 'info', confirmButtonText: '确定重试', cancelButtonText: '取消' },
    )
    for (const id of ids) await transcoderAPI.retryTask(id).catch(() => {})
    ElMessage.success(`已重试 ${ids.length} 个转码任务`)
    fetchTasks()
  } catch { /* cancelled */ }
}

async function batchReRun() {
  const ids = completedIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有已转码的任务'); return }
  try {
    await ElMessageBox.confirm(
      `确定要重新转码选中的 ${ids.length} 个任务吗？将覆盖原有输出。`, '批量重新转码',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
    for (const id of ids) await transcoderAPI.reRunTask(id).catch(() => {})
    ElMessage.success(`已重新转码 ${ids.length} 个任务`)
    fetchTasks()
  } catch { /* cancelled */ }
}

async function batchStop() {
  const ids = runningIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有转码中的任务'); return }
  try {
    await ElMessageBox.confirm(
      `确定要终止选中的 ${ids.length} 个转码任务吗？`, '批量终止',
      { type: 'warning', confirmButtonText: '确定终止', cancelButtonText: '取消' },
    )
    for (const id of ids) await transcoderAPI.stopTask(id).catch(() => {})
    ElMessage.success(`已终止 ${ids.length} 个转码任务`)
    fetchTasks()
  } catch { /* cancelled */ }
}

async function batchDelete() {
  if (!selectedIds.value.length) { ElMessage.warning('请先选择任务'); return }
  const running = runningIds.value
  if (running.length) { ElMessage.warning(`所选项目中有 ${running.length} 个转码中的任务，请先终止`); return }
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedIds.value.length} 个转码任务吗？`, '批量删除',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    )
    for (const id of selectedIds.value) await transcoderAPI.deleteTask(id).catch(() => {})
    ElMessage.success(`已删除 ${selectedIds.value.length} 个任务`)
    selectedIds.value = []
    fetchTasks()
  } catch { /* cancelled */ }
}

async function autoProcessAll() {
  const pending = tasks.value.filter((t: any) => t.status === 'pending')
  if (!pending.length) { ElMessage.info('没有待处理的转码任务'); return }
  try {
    await ElMessageBox.confirm(
      `当前有 ${pending.length} 个待转码任务，确认一键自动转码全部吗？`,
      '一键自动转码', { type: 'info', confirmButtonText: '开始' },
    )
    for (const t of pending) await transcoderAPI.startTask(t.id).catch(() => {})
    ElMessage.success(`已提交 ${pending.length} 个转码任务`)
    fetchTasks()
  } catch { /* cancelled */ }
}

// ════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════

function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canStop(s: string) { return s === 'running' }
function canRetry(s: string) { return s === 'failed' || s === 'cancelled' }

function fileName(t: any) {
  return t.payload?.fileName || t.payload?.file?.split(/[\\/]/).pop() || t.id.slice(0, 12) + '...'
}

function outputName(t: any) {
  return t.result?.outputPath?.split(/[\\/]/).pop() || '-'
}

function sourceLabel(t: any) {
  return t.payload?.source === 'download' ? '下载队列' : '本地上传'
}

function sourceClass(t: any) {
  return t.payload?.source === 'download' ? 'text-blue-400' : 'text-emerald-400'
}

// ════════════════════════════════════════════════════════════════
// SSE
// ════════════════════════════════════════════════════════════════

function connectSSE() {
  if (sseConnection) sseConnection.close()
  sseConnection = new EventSource('/api/transcoder/events')
  sseConnection.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data)
      if (evt.taskId) {
        const idx = tasks.value.findIndex((t: any) => t.id === evt.taskId)
        if (idx >= 0) {
          tasks.value[idx] = {
            ...tasks.value[idx],
            status: evt.status ?? tasks.value[idx].status,
            progress: evt.progress ?? tasks.value[idx].progress,
            error: evt.error ?? tasks.value[idx].error,
            result: evt.result ?? tasks.value[idx].result,
          }
        } else {
          fetchTasks()
        }
      }
    } catch { /* ignore */ }
  }
  sseConnection.onerror = () => {
    sseConnection?.close()
    setTimeout(connectSSE, 5000)
  }
}

onMounted(() => {
  checkFfmpeg()
  fetchTasks()
  connectSSE()
})

onUnmounted(() => {
  sseConnection?.close()
})
</script>

<template>
  <div class="px-7 py-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">转码处理</h2>
        <p class="text-[13px] text-gray-500">音视频文件 → FFmpeg 转码 → 16kHz mono WAV</p>
      </div>
      <div class="flex items-center gap-2">
        <el-button type="primary" size="small" @click="autoProcessAll" :disabled="!tasks.filter((t: any) => t.status === 'pending').length">
          <i class="fas fa-forward-step mr-1"></i>一键自动转码
        </el-button>
        <el-button type="primary" size="small" @click="pendingFiles=[];uploadDialog=true" :disabled="!ffmpegStatus?.found">
          <i class="fas fa-upload mr-1"></i>上传文件
        </el-button>
      </div>
    </div>

    <!-- FFmpeg Status Bar -->
    <div class="rounded-xl border p-3 mb-4 flex items-center justify-between"
      :class="ffmpegStatus?.found ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'"
    >
      <div class="flex items-center gap-4">
        <span class="text-sm font-semibold" :class="ffmpegStatus?.found ? 'text-emerald-400' : 'text-red-400'">
          <i :class="ffmpegStatus?.found ? 'fas fa-circle-check' : 'fas fa-circle-exclamation'" class="mr-1.5"></i>
          {{ ffmpegStatus?.found ? `FFmpeg ${(ffmpegStatus.version || '').split('-')[0]} 已就绪` : 'FFmpeg 未检测到' }}
        </span>
        <span class="text-[11px] text-gray-600">
          {{ ffmpegStatus?.found ? ffmpegStatus.version || '' : '请安装 FFmpeg 或设置 FFMPEG_PATH 环境变量' }}
        </span>
      </div>
      <el-button size="small" text @click="checkFfmpeg">
        <i class="fas fa-arrows-rotate mr-1"></i>重新检测
      </el-button>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-2 flex-wrap mb-4 card-static">
      <span class="inline-flex items-center gap-1">
        <span class="text-xs text-gray-400 flex-shrink-0">来源：</span>
        <el-select v-model="sourceFilter" size="small" class="!w-28">
          <el-option label="全部" value="all" />
          <el-option label="下载队列" value="download" />
          <el-option label="本地上传" value="upload" />
        </el-select>
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="text-xs text-gray-400 flex-shrink-0">状态：</span>
        <el-select v-model="statusFilter" size="small" class="!w-28">
          <el-option label="全部" value="all" />
          <el-option label="待转码" value="pending" />
          <el-option label="转码中" value="running" />
          <el-option label="已转码" value="completed" />
          <el-option label="转码失败" value="failed" />
        </el-select>
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="text-xs text-gray-400 flex-shrink-0">搜索：</span>
        <el-input
          v-model="keyword" size="small" placeholder="搜索文件名"
          clearable @keyup.enter="page=1;fetchTasks()" @clear="page=1;fetchTasks()"
          class="!w-52"
        />
      </span>
      <span class="inline-flex items-center gap-1">
        <el-button size="small" plain @click="page=1;fetchTasks()"><i class="fas fa-search mr-1"></i>搜索</el-button>
        <el-button size="small" plain @click="resetFilters"><i class="fas fa-undo mr-1"></i>重置</el-button>
        <el-button size="small" plain @click="fetchTasks()"><i class="fas fa-sync-alt mr-1"></i>刷新</el-button>
        <el-button
          v-if="selectedIds.length" size="small" plain type="warning"
          @click="clearAllSelections"
        >
          <i class="fas fa-times-circle mr-1"></i>清空选择 ({{ selectedIds.length }})
        </el-button>
      </span>
    </div>

    <!-- Batch bar -->
    <div v-if="selectedIds.length" class="flex items-center gap-2 mb-3 card-static">
      <span class="text-xs text-gray-400">已选 {{ selectedIds.length }} 项</span>
      <span class="text-xs text-gray-600 mx-1">|</span>
      <el-button size="small" type="primary" plain @click="batchStart" :disabled="!pendingIds.length">
        <i class="fas fa-play mr-1"></i>批量转码
      </el-button>
      <el-button size="small" type="danger" plain @click="batchStop" :disabled="!runningIds.length">
        <i class="fas fa-stop mr-1"></i>批量终止
      </el-button>
      <el-button size="small" type="warning" plain @click="batchRetry" :disabled="!failedIds.length">
        <i class="fas fa-redo mr-1"></i>批量重试
      </el-button>
      <el-button size="small" plain @click="batchReRun" :disabled="!completedIds.length">
        <i class="fas fa-rotate-right mr-1"></i>批量重新转码
      </el-button>
      <span class="text-xs text-gray-600 mx-1">|</span>
      <el-button size="small" type="danger" plain @click="batchDelete" :disabled="!selectedIds.length">
        <i class="fas fa-trash-can mr-1"></i>批量删除
      </el-button>
    </div>

    <!-- Task Table -->
    <div class="card-static">
      <el-table
        ref="tableRef"
        v-if="tasks.length"
        :data="tasks"
        size="small"
        row-key="id"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="40" fixed="left" :reserve-selection="true" />
        <el-table-column type="index" label="序号" width="55" align="center" fixed="left" />
        <el-table-column label="文件名" min-width="200" show-overflow-tooltip fixed="left">
          <template #default="{ row }">
            <span class="text-xs text-gray-300">{{ fileName(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="90">
          <template #default="{ row }">
            <span class="text-xs" :class="sourceClass(row)">{{ sourceLabel(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <StatusBadge :status="row.status" :labels="statusLabels" />
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
        <el-table-column label="输出文件" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="outputName(row) !== '-'" class="text-xs text-gray-300 font-mono">{{ outputName(row) }}</span>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
        <el-table-column label="错误信息" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.error" class="text-xs text-red-400">{{ row.error }}</span>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <!-- 操作列：固定右侧，按状态分段 -->
        <el-table-column label="操作" width="320" align="center" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <!-- 待转码/已暂停：转码、删除 -->
              <template v-if="canStart(row.status)">
                <el-button size="small" type="primary" plain @click="startTask(row.id)">
                  <i class="fas fa-play mr-1"></i>转码
                </el-button>
                <el-button size="small" type="danger" plain @click="deleteTask(row.id)">
                  <i class="fas fa-trash-can mr-1"></i>删除
                </el-button>
              </template>
              <!-- 转码中：停止 -->
              <template v-else-if="canStop(row.status)">
                <el-button size="small" type="danger" plain @click="stopTask(row.id)">
                  <i class="fas fa-stop mr-1"></i>停止
                </el-button>
              </template>
              <!-- 转码失败：查看命令、重试、删除 -->
              <template v-else-if="canRetry(row.status)">
                <el-button size="small" plain @click="viewCommand(row)">
                  <i class="fas fa-terminal mr-1"></i>查看命令
                </el-button>
                <el-button size="small" type="warning" plain @click="retryTask(row.id)">
                  <i class="fas fa-redo mr-1"></i>重试
                </el-button>
                <el-button size="small" type="danger" plain @click="deleteTask(row.id)">
                  <i class="fas fa-trash-can mr-1"></i>删除
                </el-button>
              </template>
              <!-- 已转码：查看命令、重新转码、删除 -->
              <template v-else-if="row.status === 'completed'">
                <el-button size="small" plain @click="viewCommand(row)">
                  <i class="fas fa-terminal mr-1"></i>查看命令
                </el-button>
                <el-button size="small" plain @click="reRunTask(row.id)">
                  <i class="fas fa-rotate-right mr-1"></i>重新转码
                </el-button>
                <el-button size="small" type="danger" plain @click="deleteTask(row.id)">
                  <i class="fas fa-trash-can mr-1"></i>删除
                </el-button>
              </template>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!tasks.length && !loading" class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-gear text-3xl mb-3 inline-block opacity-30"></i>
        <div>暂无转码任务</div>
        <div class="text-xs text-gray-600 mt-1">上传音视频文件或从下载队列导入以开始转码</div>
      </div>

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
    </div>

    <!-- Upload Dialog -->
    <el-dialog v-model="uploadDialog" title="上传音视频文件" width="600px" destroy-on-close :close-on-click-modal="false">
      <div class="space-y-4">
        <label class="block border-2 border-dashed border-gray-600/40 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500/40 hover:bg-gray-800/30 transition-all duration-200">
          <i class="fas fa-cloud-arrow-up text-2xl text-gray-500 mb-2 block"></i>
          <div class="text-sm text-gray-400">点击选择文件（可多选）</div>
          <div class="text-xs text-gray-600 mt-1">支持 mp3/wav/flac/aac/ogg/mp4/mkv/webm/mov/avi</div>
          <input type="file" multiple accept="audio/*,video/*" class="hidden" @change="handleFileSelect" />
        </label>

        <div v-if="pendingFiles.length" class="space-y-1">
          <div class="text-xs text-gray-400 mb-2">待上传文件 ({{ pendingFiles.length }})</div>
          <div
            v-for="(pf, i) in pendingFiles" :key="i"
            class="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-900/40 border border-gray-700/30"
          >
            <div class="flex items-center gap-2 min-w-0">
              <i class="fas fa-file-audio text-gray-500 text-xs flex-shrink-0"></i>
              <span class="text-xs text-gray-300 truncate">{{ pf.name }}</span>
              <span class="text-[11px] text-gray-600 flex-shrink-0">{{ (pf.file.size / 1024 / 1024).toFixed(1) }} MB</span>
            </div>
            <el-button size="small" type="danger" circle plain @click="removePendingFile(i)"><i class="fas fa-xmark"></i></el-button>
          </div>
        </div>
        <div v-else class="text-center py-4 text-xs text-gray-600">尚未选择文件</div>

        <div class="rounded-lg bg-blue-500/5 border border-blue-500/15 p-3 flex items-start gap-2">
          <i class="fas fa-info-circle text-blue-400 mt-0.5 text-xs"></i>
          <div class="text-xs text-blue-400/70">确认上传后将自动创建转码任务：16kHz · 单声道 · 16-bit PCM WAV</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="uploadDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!pendingFiles.length || uploading" :loading="uploading" @click="confirmUpload">
          <i class="fas fa-check mr-1.5"></i>确认上传并转码
        </el-button>
      </template>
    </el-dialog>

    <!-- Command Dialog -->
    <CommandDialog v-model="cmdDialog" :title="cmdTitle" :commands="cmdCommands" :details="cmdDetails" :loading="cmdLoading" />
  </div>
</template>
