<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
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

// --- Filters ---
const sourceFilter = ref('all')   // all | download | upload
const statusFilter = ref('all')
const keyword = ref('')

// --- Pagination ---
const { page, pageSize, total, pageSizes, onPageChange, onPageSizeChange } = usePagination({
  defaultPageSize: 20,
  onFetch: () => fetchTasks(),
})

// --- SSE ---
let sseConnection: EventSource | null = null

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

const statusLabels: Record<string, string> = {
  pending: '待转码',
  running: '转码中',
  completed: '已转码',
  failed: '转码失败',
  cancelled: '已取消',
  paused: '已暂停',
}

// --- Actions ---
async function checkFfmpeg() {
  try {
    const { data } = await transcoderAPI.checkFfmpeg()
    ffmpegStatus.value = data
  } catch { ffmpegStatus.value = null }
}

async function fetchTasks() {
  const params: Record<string, any> = {
    type: 'transcode',
    page: page.value,
    pageSize: pageSize.value,
  }
  if (sourceFilter.value !== 'all') params.source = sourceFilter.value
  if (statusFilter.value !== 'all') params.status = statusFilter.value
  if (keyword.value) params.keyword = keyword.value

  const { data } = await api.get('/tasks', { params })
  tasks.value = data.items || data
  total.value = data.total || (Array.isArray(data) ? data.length : 0)
}

async function refresh() {
  await checkFfmpeg()
  await fetchTasks()
}

// Debounced keyword filter
let keywordTimer: any
watch([sourceFilter, statusFilter], () => {
  page.value = 1
  fetchTasks()
})
watch(keyword, () => {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => {
    page.value = 1
    fetchTasks()
  }, 300)
})

// --- Upload ---
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

function removePendingFile(index: number) {
  pendingFiles.value.splice(index, 1)
}

function openUploadDialog() {
  pendingFiles.value = []
  uploadDialog.value = true
}

async function confirmUpload() {
  if (!pendingFiles.value.length) { ElMessage.warning('请先选择文件'); return }
  uploading.value = true
  try {
    const fd = new FormData()
    for (const pf of pendingFiles.value) {
      fd.append('files', pf.file)
    }
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

// --- Task Operations ---
async function startTask(id: string) {
  try { await transcoderAPI.startTask(id); ElMessage.success('转码任务已开始'); fetchTasks() }
  catch { ElMessage.error('操作失败') }
}

async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要停止此转码任务吗？', '确认停止', { type: 'warning' })
    await transcoderAPI.stopTask(id); ElMessage.success('任务已停止'); fetchTasks()
  } catch { /* cancelled */ }
}

async function retryTask(id: string) {
  try { await transcoderAPI.retryTask(id); ElMessage.success('已重新加入队列'); fetchTasks() }
  catch { ElMessage.error('操作失败') }
}

async function reRunTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要重新转码吗？将覆盖原有输出。', '确认', { type: 'warning' })
    await transcoderAPI.reRunTask(id); ElMessage.success('任务已重新运行'); fetchTasks()
  } catch { /* cancelled */ }
}

async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此转码任务吗？', '确认删除', { type: 'warning' })
    await transcoderAPI.deleteTask(id); ElMessage.success('任务已删除'); fetchTasks()
  } catch { /* cancelled */ }
}

// --- View Command ---
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
  cmdTitle.value = '转码命令详情'
  cmdDetails.value = [
    { label: '输入文件', value: task.payload?.fileName || task.payload?.file?.split(/[\\/]/).pop() || '-' },
    { label: '文件大小', value: task.result?.inputSize || '-' },
    { label: '目标参数', value: '16kHz · mono · 16-bit PCM WAV' },
    { label: '输出文件', value: task.result?.outputPath?.split(/[\\/]/).pop() || '-' },
    { label: '状态', value: statusLabels[task.status] || task.status },
  ]
  cmdCommands.value = [
    { label: '等效命令', content: getFfmpegCommand(task) },
  ]
  cmdLoading.value = false
  cmdDialog.value = true
}

// --- Selection ---
function handleSelectionChange(rows: any[]) {
  selectedIds.value = rows.map((r: any) => r.id)
}

// Batch operations
async function batchDelete() {
  if (!selectedIds.value.length) { ElMessage.warning('请先选择任务'); return }
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedIds.value.length} 个任务吗？`, '批量删除', { type: 'warning' })
    for (const id of selectedIds.value) {
      await transcoderAPI.deleteTask(id).catch(() => {})
    }
    ElMessage.success(`已删除 ${selectedIds.value.length} 个任务`)
    selectedIds.value = []
    fetchTasks()
  } catch { /* cancelled */ }
}

async function batchStart() {
  if (!selectedIds.value.length) { ElMessage.warning('请先选择任务'); return }
  try {
    await ElMessageBox.confirm(`将为选中的 ${selectedIds.value.length} 个任务启动转码`, '批量转码', { type: 'info' })
    for (const id of selectedIds.value) {
      await transcoderAPI.startTask(id).catch(() => {})
    }
    ElMessage.success('批量转码已提交')
    selectedIds.value = []
    fetchTasks()
  } catch { /* cancelled */ }
}

async function autoProcessAll() {
  const pendingTasks = tasks.value.filter((t: any) => t.status === 'pending')
  if (!pendingTasks.length) { ElMessage.info('没有待处理的转码任务'); return }
  try {
    await ElMessageBox.confirm(
      `当前有 ${pendingTasks.length} 个待转码任务，确认一键自动转码全部吗？`,
      '一键自动转码',
      { type: 'info', confirmButtonText: '开始' },
    )
    for (const t of pendingTasks) {
      await transcoderAPI.startTask(t.id).catch(() => {})
    }
    ElMessage.success(`已提交 ${pendingTasks.length} 个转码任务`)
    fetchTasks()
  } catch { /* cancelled */ }
}

// --- Helpers ---
function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canStop(s: string) { return s === 'running' }
function canRetry(s: string) { return s === 'failed' || s === 'cancelled' }
function canDelete(s: string) { return s !== 'running' }

function fileName(t: any) {
  return t.payload?.fileName || t.payload?.file?.split(/[\\/]/).pop() || t.id.slice(0, 12) + '...'
}

function outputName(t: any) {
  return t.result?.outputPath?.split(/[\\/]/).pop() || '-'
}

// SSE
function connectSSE() {
  sseConnection = new EventSource('/api/transcoder/events')
  sseConnection.addEventListener('message', (e) => {
    try {
      const evt = JSON.parse(e.data)
      if (evt.type === 'transcode' || !evt.type) {
        const idx = tasks.value.findIndex((t: any) => t.id === evt.taskId)
        if (idx >= 0) {
          tasks.value[idx] = { ...tasks.value[idx], ...evt }
        } else {
          fetchTasks()
        }
      }
    } catch { /* ignore */ }
  })
  sseConnection.onerror = () => { /* reconnect handled by caller */ }
}

onMounted(() => {
  refresh()
  connectSSE()
})

onUnmounted(() => {
  sseConnection?.close()
  clearTimeout(keywordTimer)
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
        <span v-if="selectedIds.length" class="text-xs text-gray-400">已选 {{ selectedIds.length }} 项</span>

        <el-button v-if="selectedIds.length" type="primary" size="small" plain @click="batchStart">
          <i class="fas fa-play mr-1"></i>批量转码
        </el-button>
        <el-button v-if="selectedIds.length" type="danger" size="small" plain @click="batchDelete">
          <i class="fas fa-trash-can mr-1"></i>批量删除
        </el-button>

        <span class="text-gray-600 mx-1">|</span>

        <el-button type="primary" size="small" @click="autoProcessAll" :disabled="!tasks.filter((t: any) => t.status === 'pending').length">
          <i class="fas fa-forward-step mr-1"></i>一键自动转码
        </el-button>
        <el-button type="primary" size="small" @click="openUploadDialog" :disabled="!ffmpegStatus?.found">
          <i class="fas fa-upload mr-1"></i>上传文件
        </el-button>
      </div>
    </div>

    <!-- FFmpeg Status Bar -->
    <div class="rounded-xl border p-4 mb-4 flex items-center justify-between"
      :class="ffmpegStatus?.found ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'"
    >
      <div class="flex items-center gap-4">
        <span class="text-sm font-semibold" :class="ffmpegStatus?.found ? 'text-emerald-400' : 'text-red-400'">
          <i :class="ffmpegStatus?.found ? 'fas fa-circle-check' : 'fas fa-circle-exclamation'" class="mr-1.5"></i>
          {{ ffmpegStatus?.found ? `FFmpeg ${ffmpegStatus.version?.split('-')[0] || ''} 已就绪` : 'FFmpeg 未检测到' }}
        </span>
        <span class="text-[11px] text-gray-600">
          {{ ffmpegStatus?.found ? `路径: ${ffmpegStatus.version || '-'}` : '请安装 FFmpeg 或设置 FFMPEG_PATH 环境变量' }}
        </span>
      </div>
      <el-button size="small" text @click="checkFfmpeg">
        <i class="fas fa-arrows-rotate mr-1"></i>重新检测
      </el-button>
    </div>

    <!-- Filters -->
    <div class="flex items-center justify-between mb-4 card-static">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500">来源:</span>
          <el-button
            v-for="f in [{ k: 'all', l: '全部' }, { k: 'download', l: '下载队列' }, { k: 'upload', l: '本地上传' }]"
            :key="f.k" size="small"
            :type="sourceFilter === f.k ? 'primary' : 'default'"
            :plain="sourceFilter !== f.k"
            @click="sourceFilter = f.k"
          >{{ f.l }}</el-button>
        </div>
        <span class="text-gray-600 mx-1">|</span>
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500">状态:</span>
          <el-button
            v-for="f in [
              { k: 'all', l: '全部' }, { k: 'pending', l: '待转码' }, { k: 'running', l: '转码中' },
              { k: 'completed', l: '已转码' }, { k: 'failed', l: '失败' },
            ]"
            :key="f.k" size="small"
            :type="statusFilter === f.k ? 'primary' : 'default'"
            :plain="statusFilter !== f.k"
            @click="statusFilter = f.k"
          >{{ f.l }}</el-button>
        </div>
      </div>
      <el-input
        v-model="keyword"
        placeholder="搜索文件名..."
        size="small"
        class="!w-52"
        clearable
        :prefix-icon="undefined"
      >
        <template #prefix>
          <i class="fas fa-search text-gray-500 text-[11px]"></i>
        </template>
      </el-input>
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
        <el-table-column type="index" label="#" width="50" align="center" fixed="left" />
        <el-table-column label="文件名" min-width="200" show-overflow-tooltip fixed="left">
          <template #default="{ row }">
            <span class="text-xs text-gray-300">{{ fileName(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="100">
          <template #default="{ row }">
            <span
              class="text-xs"
              :class="(row.payload?.source || 'upload') === 'download' ? 'text-blue-400' : 'text-emerald-400'"
            >
              {{ row.payload?.source === 'download' ? '下载' : '上传' }}
            </span>
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
        <el-table-column label="输出" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="outputName(row) !== '-'" class="text-xs text-gray-500 font-mono">{{ outputName(row) }}</span>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="280" align="center">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <!-- pending / paused -->
              <el-button v-if="canStart(row.status)" size="small" type="primary" plain @click="startTask(row.id)">
                <i class="fas fa-play mr-1"></i>转码
              </el-button>
              <!-- running -->
              <el-button v-if="canStop(row.status)" size="small" type="danger" plain @click="stopTask(row.id)">
                <i class="fas fa-stop mr-1"></i>停止
              </el-button>
              <!-- completed -->
              <el-button v-if="row.status === 'completed'" size="small" plain @click="viewCommand(row)">
                <i class="fas fa-terminal mr-1"></i>查看命令
              </el-button>
              <el-button v-if="row.status === 'completed'" size="small" plain @click="reRunTask(row.id)">
                <i class="fas fa-rotate-right mr-1"></i>重新转码
              </el-button>
              <!-- failed -->
              <el-button v-if="row.status === 'failed'" size="small" plain @click="viewCommand(row)">
                <i class="fas fa-terminal mr-1"></i>查看命令
              </el-button>
              <el-button v-if="canRetry(row.status)" size="small" type="warning" plain @click="retryTask(row.id)">
                <i class="fas fa-redo mr-1"></i>重试
              </el-button>
              <!-- delete -->
              <el-button v-if="canDelete(row.status)" size="small" type="danger" plain @click="deleteTask(row.id)">
                <i class="fas fa-trash-can mr-1"></i>删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-else class="text-center py-12 text-gray-500 text-sm">
        <i class="fas fa-gear text-3xl mb-3 inline-block opacity-30"></i>
        <div>暂无转码任务</div>
        <div class="text-xs text-gray-600 mt-1">上传音视频文件或从下载队列导入以开始转码</div>
      </div>

      <!-- Pagination -->
      <div v-if="total > pageSize" class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizes"
          :total="total"
          layout="total, sizes, prev, pager, next"
          small
          background
          @current-change="onPageChange"
          @size-change="onPageSizeChange"
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
            <el-button size="small" type="danger" circle plain @click="removePendingFile(i)">
              <i class="fas fa-xmark"></i>
            </el-button>
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
    <CommandDialog
      v-model="cmdDialog"
      :title="cmdTitle"
      :commands="cmdCommands"
      :details="cmdDetails"
      :loading="cmdLoading"
    />
  </div>
</template>
