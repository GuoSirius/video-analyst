<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, reactive } from 'vue'
import { whisperAPI } from '../api'
import api from '../api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { copyWithFeedback } from '../utils/clipboard'
import { usePagination } from '../composables/usePagination'
import StatusBadge from '../components/StatusBadge.vue'
import CommandDialog from '../components/CommandDialog.vue'

// --- Whisper Status ---
const whisperStatus = ref<any>(null)
const statusLoading = ref(false)

// --- Data ---
const tasks = ref<any[]>([])
const results = ref<any[]>([])
const selectedIds = ref<string[]>([])
const selectedItemsMeta = reactive<Record<string, any>>({})
const tableRef = ref<any>(null)
let syncingSelection = false
const loading = ref(false)

// --- Filters ---
const statusFilter = ref('all')
const keyword = ref('')

// --- Pagination ---
const { page, pageSize, total, pageSizes, onPageChange, onPageSizeChange } = usePagination({
  defaultPageSize: 20,
  onFetch: () => fetchTasks(),
})

// --- Whisper Config ---
const whispModel = ref('base')
const whispFormat = ref('json')
const whispTemp = ref(0.0)
const whispTempInc = ref(0.2)

// --- Command Dialog ---
const cmdDialog = ref(false)
const cmdTitle = ref('')
const cmdCommands = ref<{ label: string; content: string }[]>([])
const cmdDetails = ref<{ label: string; value: string }[]>([])
const cmdLoading = ref(false)

// --- Result Dialog ---
const resultDialog = ref(false)
const resultTitle = ref('')
const resultContent = ref('')
const resultMeta = ref<{ label: string; value: string }[]>([])

// --- SSE ---
let sseConnection: EventSource | null = null

const statusLabels: Record<string, string> = {
  pending: '待识别',
  running: '识别中',
  completed: '已识别',
  failed: '识别失败',
  cancelled: '已取消',
  paused: '已暂停',
}

// --- Actions ---
async function checkStatus() {
  statusLoading.value = true
  try {
    const { data } = await whisperAPI.getStatus()
    whisperStatus.value = data
  } catch { whisperStatus.value = null }
  statusLoading.value = false
}

async function fetchTasks() {
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize: pageSize.value }
    if (statusFilter.value !== 'all') params.status = statusFilter.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()

    const { data } = await api.get('/tasks', { params: { ...params, type: 'whisper' } })
    tasks.value = data.items || data
    total.value = data.total || (Array.isArray(data) ? data.length : 0)
    await nextTick()
    syncTableSelection()
  } catch {
    ElMessage.error('获取任务列表失败')
  }
  loading.value = false
}

async function fetchResults() {
  const { data } = await whisperAPI.getResults()
  results.value = data
}

// --- Filters watch ---
watch([statusFilter, keyword], () => {
  page.value = 1
  fetchTasks()
})

function resetFilters() {
  keyword.value = ''
  statusFilter.value = 'all'
  page.value = 1
  fetchTasks()
}

// --- Selection ---
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
  } catch { /* cancelled */ }
}

// --- Task Operations ---
async function startTask(id: string) {
  try { await whisperAPI.startTask(id); ElMessage.success('识别任务已开始'); fetchTasks() }
  catch { ElMessage.error('操作失败') }
}

async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要停止此识别任务吗？', '确认停止', { type: 'warning' })
    await whisperAPI.stopTask(id); ElMessage.success('任务已停止'); fetchTasks()
  } catch { /* cancelled */ }
}

async function retryTask(id: string) {
  try { await whisperAPI.retryTask(id); ElMessage.success('已重新加入队列'); fetchTasks() }
  catch { ElMessage.error('操作失败') }
}

async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此识别任务吗？', '确认删除', { type: 'warning' })
    await whisperAPI.deleteTask(id); ElMessage.success('任务已删除'); fetchTasks()
  } catch { /* cancelled */ }
}

// --- View Command ---
function getWhisperCommand(task: any): string {
  const p = task.payload || {}
  const filePath = p.filePath || 'audio.wav'
  const model = p.options?.model || 'base'
  if (whisperStatus.value?.mode === 'api') {
    const baseUrl = whisperStatus.value.detail?.match(/远端服务: (.+)/)?.[1] || 'MEMO_AI_BASE_URL'
    return [
      `curl -X POST "${baseUrl}/inference" \\`,
      `  -F "file=@${filePath}" \\`,
      `  -F "temperature=${whispTemp.value}" \\`,
      `  -F "temperature_inc=${whispTempInc.value}" \\`,
      `  -F "response_format=${whispFormat.value}"`,
    ].join('\n')
  }
  return [
    'whisper \\',
    `  "${filePath}" \\`,
    `  --model ${model} \\`,
    `  --output_format ${whispFormat.value === 'vtt' ? 'vtt' : whispFormat.value === 'srt' ? 'srt' : 'txt'} \\`,
    '  --output_dir /tmp/video-analyst-whisper',
  ].join('\n')
}

function viewCommand(task: any) {
  cmdLoading.value = true
  cmdTitle.value = '识别命令详情'
  cmdDetails.value = [
    { label: '输入文件', value: (task.payload?.filePath || '').split(/[\\/]/).pop() || '-' },
    { label: '模型', value: task.payload?.options?.model || 'base' },
    { label: '模式', value: whisperStatus.value?.mode === 'api' ? 'API 远端' : '本地 CLI' },
    { label: '输出格式', value: task.payload?.options?.response_format || 'json' },
  ]
  cmdCommands.value = [{ label: '等效命令', content: getWhisperCommand(task) }]
  cmdLoading.value = false
  cmdDialog.value = true
}

// --- View Result ---
function viewResult(transcription: any) {
  resultTitle.value = '识别结果'
  resultContent.value = transcription.content || transcription.text || '暂无文本'
  resultMeta.value = [
    { label: '语言', value: transcription.language || 'auto' },
    { label: '时长', value: transcription.duration ? `${transcription.duration}s` : '-' },
    { label: '状态', value: transcription.status || '-' },
    { label: '创建时间', value: transcription.created_at || '-' },
  ]
  resultDialog.value = true
}

function copyResultText() {
  copyWithFeedback(resultContent.value)
}

// --- Batch ---
async function batchDelete() {
  if (!selectedIds.value.length) { ElMessage.warning('请先选择任务'); return }
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedIds.value.length} 个任务吗？`, '批量删除', { type: 'warning' })
    for (const id of selectedIds.value) await whisperAPI.deleteTask(id).catch(() => {})
    ElMessage.success(`已删除 ${selectedIds.value.length} 个任务`)
    selectedIds.value = []
    fetchTasks()
  } catch { /* cancelled */ }
}

async function batchStart() {
  if (!selectedIds.value.length) { ElMessage.warning('请先选择任务'); return }
  try {
    await ElMessageBox.confirm(`将为选中的 ${selectedIds.value.length} 个任务启动识别`, '批量识别', { type: 'info' })
    for (const id of selectedIds.value) await whisperAPI.startTask(id).catch(() => {})
    ElMessage.success('批量识别已提交')
    selectedIds.value = []
    fetchTasks()
  } catch { /* cancelled */ }
}

async function autoProcessAll() {
  const pending = tasks.value.filter((t: any) => t.status === 'pending')
  if (!pending.length) { ElMessage.info('没有待处理的识别任务'); return }
  try {
    await ElMessageBox.confirm(
      `当前有 ${pending.length} 个待识别任务，确认一键自动识别全部吗？`,
      '一键自动识别', { type: 'info', confirmButtonText: '开始' },
    )
    for (const t of pending) await whisperAPI.startTask(t.id).catch(() => {})
    ElMessage.success(`已提交 ${pending.length} 个识别任务`)
    fetchTasks()
  } catch { /* cancelled */ }
}

// --- Helpers ---
function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canStop(s: string) { return s === 'running' }
function canRetry(s: string) { return s === 'failed' || s === 'cancelled' }
function canDelete(s: string) { return s !== 'running' }

function fileName(t: any) {
  return (t.payload?.filePath || '').split(/[\\/]/).pop() || t.id.slice(0, 12) + '...'
}

function resultText(t: any) {
  const text = t.result?.text || t.result?.transcriptionId || '-'
  return typeof text === 'string' ? text.slice(0, 80) + (text.length > 80 ? '...' : '') : text
}

// --- SSE ---
const SSE_URL = `${import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api'}/whisper/events`

function connectSSE() {
  sseConnection = new EventSource(SSE_URL)
  sseConnection.addEventListener('message', (e) => {
    try {
      const evt = JSON.parse(e.data)
      if (evt.type === 'whisper' || !evt.type) {
        const idx = tasks.value.findIndex((t: any) => t.id === evt.taskId)
        if (idx >= 0) {
          tasks.value[idx] = { ...tasks.value[idx], ...evt }
          if (evt.status === 'completed') fetchResults()
        } else { fetchTasks() }
      }
    } catch { /* ignore */ }
  })
  sseConnection.onerror = () => { /* reconnect */ }
}

onMounted(() => {
  checkStatus()
  fetchTasks()
  fetchResults()
  connectSSE()
})

onUnmounted(() => { sseConnection?.close() })
</script>

<template>
  <div class="px-7 py-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">语音识别</h2>
        <p class="text-[13px] text-gray-500">Whisper 语音识别，将音频转为文字</p>
      </div>
      <div class="flex items-center gap-2">
        <el-button type="primary" size="small" @click="autoProcessAll" :disabled="!tasks.filter((t: any) => t.status === 'pending').length">
          <i class="fas fa-forward-step mr-1"></i>一键自动识别
        </el-button>
      </div>
    </div>

    <!-- Whisper Status Bar -->
    <div class="rounded-xl border p-3 mb-4 flex items-center justify-between"
      :class="whisperStatus?.mode === 'unavailable' ? 'bg-red-500/5 border-red-500/20' : 'bg-blue-500/5 border-blue-500/20'"
    >
      <div class="flex items-center gap-4" v-if="whisperStatus">
        <span class="text-sm font-semibold" :class="whisperStatus.mode === 'unavailable' ? 'text-red-400' : 'text-blue-400'">
          <i :class="whisperStatus.mode === 'api' ? 'fas fa-globe' : whisperStatus.mode === 'local' ? 'fas fa-terminal' : 'fas fa-circle-exclamation'" class="mr-1.5"></i>
          {{ whisperStatus.mode === 'api' ? 'API 模式' : whisperStatus.mode === 'local' ? '本地 CLI 模式' : '不可用' }}
        </span>
        <span class="text-[11px] text-gray-600">{{ whisperStatus.detail }}</span>
      </div>
      <div v-else class="text-sm text-gray-500">检测中...</div>
      <el-button size="small" text @click="checkStatus" :loading="statusLoading">
        <i class="fas fa-arrows-rotate mr-1"></i>重新检测
      </el-button>
    </div>

    <!-- Whisper Config -->
    <div class="card-static mb-4">
      <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
        <i class="fas fa-sliders text-blue-400"></i>识别配置
      </h3>
      <div class="grid grid-cols-4 gap-4">
        <div>
          <div class="text-xs text-gray-400 mb-1.5">模型</div>
          <el-select v-model="whispModel" size="small" class="!w-full">
            <el-option v-for="m in ['tiny', 'base', 'small', 'medium', 'large']" :key="m" :label="m" :value="m" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">输出格式</div>
          <el-select v-model="whispFormat" size="small" class="!w-full">
            <el-option v-for="f in ['json', 'text', 'srt', 'vtt']" :key="f" :label="f" :value="f" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">Temperature <span class="text-[10px] text-gray-600">(仅API)</span></div>
          <el-input-number v-model="whispTemp" :min="0" :max="1" :step="0.1" :precision="1" size="small" class="!w-full" />
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">Temp Inc <span class="text-[10px] text-gray-600">(仅API)</span></div>
          <el-input-number v-model="whispTempInc" :min="0" :max="1" :step="0.1" :precision="1" size="small" class="!w-full" />
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-2 flex-wrap mb-4 card-static">
      <span class="inline-flex items-center gap-1">
        <span class="text-xs text-gray-400 flex-shrink-0">状态：</span>
        <el-select v-model="statusFilter" size="small" class="!w-28">
          <el-option label="全部" value="all" />
          <el-option label="待识别" value="pending" />
          <el-option label="识别中" value="running" />
          <el-option label="已识别" value="completed" />
          <el-option label="识别失败" value="failed" />
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
    <div v-if="selectedIds.length" class="flex items-center gap-2 mb-3">
      <span class="text-xs text-gray-400">已选 {{ selectedIds.length }} 项</span>
      <el-button type="primary" size="small" plain @click="batchStart">
        <i class="fas fa-play mr-1"></i>批量识别
      </el-button>
      <el-button type="danger" size="small" plain @click="batchDelete">
        <i class="fas fa-trash-can mr-1"></i>批量删除
      </el-button>
    </div>

    <!-- Task Table -->
    <div class="card-static mb-5">
      <h3 class="text-sm font-semibold mb-4 flex items-center gap-2">
        <i class="fas fa-list-check text-blue-400"></i>识别任务
      </h3>
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
        <el-table-column label="模型" width="90">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.payload?.options?.model || 'base' }}</span>
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
        <el-table-column label="结果预览" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-500 font-mono">{{ resultText(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="300" align="center">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <el-button v-if="canStart(row.status)" size="small" type="primary" plain @click="startTask(row.id)">
                <i class="fas fa-play mr-1"></i>识别
              </el-button>
              <el-button v-if="canStop(row.status)" size="small" type="danger" plain @click="stopTask(row.id)">
                <i class="fas fa-stop mr-1"></i>停止
              </el-button>
              <el-button v-if="row.status === 'completed' || row.status === 'failed'" size="small" plain @click="viewCommand(row)">
                <i class="fas fa-terminal mr-1"></i>查看命令
              </el-button>
              <el-button v-if="row.status === 'completed' && row.result?.text" size="small" plain @click="viewResult(row.result)">
                <i class="fas fa-eye mr-1"></i>查看结果
              </el-button>
              <el-button v-if="row.status === 'completed'" size="small" plain @click="retryTask(row.id)">
                <i class="fas fa-rotate-right mr-1"></i>重新识别
              </el-button>
              <el-button v-if="canRetry(row.status)" size="small" type="warning" plain @click="retryTask(row.id)">
                <i class="fas fa-redo mr-1"></i>重试
              </el-button>
              <el-button v-if="canDelete(row.status)" size="small" type="danger" plain @click="deleteTask(row.id)">
                <i class="fas fa-trash-can mr-1"></i>删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!tasks.length && !loading" class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-microphone text-3xl mb-3 inline-block opacity-30"></i>
        <div>暂无识别任务</div>
        <div class="text-xs text-gray-600 mt-1">转码完成后可在转码页面或自动化流水线中创建识别任务</div>
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

    <!-- Results -->
    <div v-if="results.length" class="card-static">
      <h3 class="text-sm font-semibold mb-4 flex items-center gap-2">
        <i class="fas fa-file-lines text-violet-400"></i>识别结果 ({{ results.length }})
      </h3>
      <div class="space-y-3 max-h-[500px] overflow-y-auto">
        <div
          v-for="r in results" :key="r.id"
          class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/30 hover:border-gray-600/40 cursor-pointer transition-colors"
          @click="viewResult(r)"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-gray-500 font-mono">{{ r.file_path?.split(/[\\/]/).pop() || '-' }}</span>
            <div class="flex items-center gap-2">
              <span v-if="r.language" class="text-[11px] text-gray-600">{{ r.language }}</span>
              <span v-if="r.duration" class="text-[11px] text-gray-600">{{ r.duration }}s</span>
              <span class="text-[11px] text-gray-600">{{ r.created_at }}</span>
            </div>
          </div>
          <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap line-clamp-3">
            {{ r.content?.slice(0, 500) }}{{ r.content?.length > 500 ? '...' : '' }}
          </div>
          <div v-if="!r.content" class="text-xs text-gray-600">暂无文本内容</div>
        </div>
      </div>
    </div>

    <!-- Command Dialog -->
    <CommandDialog v-model="cmdDialog" :title="cmdTitle" :commands="cmdCommands" :details="cmdDetails" :loading="cmdLoading" />

    <!-- Result Dialog -->
    <el-dialog v-model="resultDialog" :title="resultTitle" width="700px" destroy-on-close :close-on-click-modal="false">
      <div v-if="resultMeta.length" class="rounded-lg bg-gray-900/50 border border-gray-700/30 p-3 mb-4">
        <div class="flex items-center gap-4 flex-wrap">
          <div v-for="m in resultMeta" :key="m.label" class="flex items-baseline gap-1.5 text-xs">
            <span class="text-gray-500">{{ m.label }}:</span>
            <span class="text-gray-300">{{ m.value }}</span>
          </div>
        </div>
      </div>
      <div class="rounded-lg bg-[#0d1117] border border-gray-700/40 p-4 font-mono text-xs text-gray-300 leading-relaxed whitespace-pre-wrap max-h-[500px] overflow-y-auto">
        {{ resultContent || '暂无文本' }}
      </div>
      <template #footer>
        <el-button @click="copyResultText()"><i class="fas fa-copy mr-1"></i>复制文本</el-button>
        <el-button @click="resultDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>
