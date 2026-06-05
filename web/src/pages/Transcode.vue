<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { transcoderAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

// --- State ---
const ffmpegStatus = ref<any>(null)
const tasks = ref<any[]>([])
const selectedTasks = ref<any[]>([])
const sourceFilter = ref('all')
const statusFilter = ref('all')

// Upload dialog
const uploadDialog = ref(false)
const pendingFiles = ref<{ name: string; file: File }[]>([])
const uploading = ref(false)

// --- Actions ---
async function checkFfmpeg() {
  try {
    const { data } = await transcoderAPI.checkFfmpeg()
    ffmpegStatus.value = data
  } catch { ffmpegStatus.value = null }
}

async function refresh() {
  const { data } = await transcoderAPI.getTasks()
  tasks.value = data
}

// Upload dialog
function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  for (const f of Array.from(input.files)) {
    // Avoid duplicates
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
    ElMessage.success(`已上传 ${upData.files.length} 个文件`)

    // Start transcode
    const { data: convData } = await transcoderAPI.startConvert({
      files: upData.files,
      fileNames: pendingFiles.value.map(p => p.name),
    })
    if (convData.error) { ElMessage.error(convData.error); return }
    ElMessage.success(`已创建 ${convData.tasks.length} 个转码任务`)
    uploadDialog.value = false
    pendingFiles.value = []
    await refresh()
  } catch { ElMessage.error('操作失败') }
  uploading.value = false
}

// Task operations
async function startTask(id: string) {
  try { await transcoderAPI.startTask(id); ElMessage.success('任务已开始'); refresh() }
  catch { ElMessage.error('操作失败') }
}

async function pauseTask(id: string) {
  try { await transcoderAPI.pauseTask(id); ElMessage.success('任务已暂停'); refresh() }
  catch { ElMessage.error('操作失败') }
}

async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要终止此任务吗？', '确认', { type: 'warning' })
    await transcoderAPI.stopTask(id)
    ElMessage.success('任务已终止'); refresh()
  } catch { /* cancelled */ }
}

async function retryTask(id: string) {
  try { await transcoderAPI.retryTask(id); ElMessage.success('已重新加入队列'); refresh() }
  catch { ElMessage.error('操作失败') }
}

async function reRunTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要重新运行此转码任务吗？', '确认', { type: 'warning' })
    await transcoderAPI.reRunTask(id)
    ElMessage.success('任务已重新运行'); refresh()
  } catch { /* cancelled */ }
}

async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此转码任务吗？', '确认删除', { type: 'warning' })
    await transcoderAPI.deleteTask(id)
    ElMessage.success('任务已删除'); refresh()
  } catch { /* cancelled */ }
}

function handleSelectionChange(rows: any[]) {
  selectedTasks.value = rows
}

async function batchDelete() {
  if (!selectedTasks.value.length) { ElMessage.warning('请先选择要删除的任务'); return }
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedTasks.value.length} 个转码任务吗？`, '批量删除确认', { type: 'warning' })
    for (const task of selectedTasks.value) {
      await transcoderAPI.deleteTask(task.id)
    }
    ElMessage.success(`已删除 ${selectedTasks.value.length} 个任务`)
    selectedTasks.value = []
    refresh()
  } catch { /* cancelled */ }
}

// --- Computed ---
const filteredTasks = computed(() => {
  let result = tasks.value
  if (sourceFilter.value !== 'all') {
    result = result.filter((t: any) => (t.payload?.source || 'upload') === sourceFilter.value)
  }
  if (statusFilter.value !== 'all') {
    result = result.filter((t: any) => t.status === statusFilter.value)
  }
  return result
})

// --- Helpers ---
function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: '等待中', running: '进行中', completed: '已完成',
    failed: '失败', cancelled: '已取消', paused: '已暂停',
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

function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canPause(s: string) { return s === 'running' }
function canStop(s: string) { return s === 'running' || s === 'paused' }
function canRetry(s: string) { return s === 'failed' }
function canReRun(s: string) { return s === 'completed' || s === 'failed' || s === 'cancelled' }
function canDelete(s: string) { return s !== 'running' }

onMounted(() => { checkFfmpeg(); refresh() })
</script>

<template>
  <div class="px-7 py-6">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">转码处理</h2>
        <p class="text-[13px] text-gray-500">本地音视频文件 → FFmpeg 转码 → 16kHz mono WAV</p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="selectedTasks.length" class="text-xs text-gray-400">已选 {{ selectedTasks.length }} 项</span>
        <el-button
          v-if="selectedTasks.length"
          type="danger" size="small" plain
          @click="batchDelete"
        >
          <i class="fas fa-trash-can mr-1.5"></i>批量删除 ({{ selectedTasks.length }})
        </el-button>
        <span v-if="ffmpegStatus?.found" class="text-xs text-emerald-400">
          <i class="fas fa-circle text-[5px] mr-1"></i>FFmpeg {{ ffmpegStatus.version?.split('-')[0] }}
        </span>
        <span v-else class="text-xs text-red-400">
          <i class="fas fa-circle text-[5px] mr-1"></i>FFmpeg 未检测到
        </span>
        <el-button type="primary" size="small" @click="openUploadDialog" :disabled="!ffmpegStatus?.found">
          <i class="fas fa-upload mr-1.5"></i>上传文件
        </el-button>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center justify-between mb-4 card-static">
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500">来源:</span>
          <el-button
            v-for="f in [{ k: 'all', l: '全部' }, { k: 'upload', l: '文件上传' }, { k: 'crawl', l: '爬虫采集' }]"
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
              { k: 'all', l: '全部' }, { k: 'running', l: '进行中' },
              { k: 'completed', l: '已完成' }, { k: 'failed', l: '失败' },
            ]"
            :key="f.k" size="small"
            :type="statusFilter === f.k ? 'primary' : 'default'"
            :plain="statusFilter !== f.k"
            @click="statusFilter = f.k"
          >{{ f.l }}</el-button>
        </div>
      </div>
    </div>

    <!-- Task Table -->
    <div class="card-static">
      <el-table
        v-if="filteredTasks.length"
        :data="filteredTasks"
        size="small"
        row-key="id"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="40" fixed="left" :reserve-selection="true" />
        <el-table-column type="index" label="序号" width="55" align="center" fixed="left" />
        <el-table-column label="文件名" min-width="180" show-overflow-tooltip fixed="left">
          <template #default="{ row }">
            <span class="text-xs text-gray-300">
              {{ row.payload?.fileName || row.payload?.file?.split(/[\\/]/).pop() || row.id.slice(0, 12) + '...' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="90">
          <template #default="{ row }">
            <span class="text-xs" :class="(row.payload?.source || 'upload') === 'crawl' ? 'text-blue-400' : 'text-emerald-400'">
              {{ (row.payload?.source || 'upload') === 'crawl' ? '爬虫' : '上传' }}
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
        <el-table-column label="输出" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.result?.outputPath" class="text-xs text-gray-500 font-mono">
              {{ row.result.outputPath.split(/[\\/]/).pop() }}
            </span>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="260" align="center">
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
                重新转码
              </el-button>
              <el-button v-if="canDelete(row.status)" size="small" type="danger" plain @click="deleteTask(row.id)">
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-12 text-gray-500 text-sm">
        <i class="fas fa-gear text-3xl mb-3 block opacity-30"></i>暂无转码任务
      </div>
    </div>

    <!-- Upload Dialog -->
    <el-dialog v-model="uploadDialog" title="上传音视频文件" width="600px" destroy-on-close :close-on-click-modal="false">
      <div class="space-y-4">
        <!-- File selector -->
        <label class="block border-2 border-dashed border-gray-600/40 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500/40 hover:bg-gray-800/30 transition-all duration-200">
          <i class="fas fa-cloud-arrow-up text-2xl text-gray-500 mb-2 block"></i>
          <div class="text-sm text-gray-400">点击选择文件（可多选）</div>
          <div class="text-xs text-gray-600 mt-1">支持 mp3/wav/flac/aac/ogg/mp4/mkv/webm/mov/avi</div>
          <input type="file" multiple accept="audio/*,video/*" class="hidden" @change="handleFileSelect" />
        </label>

        <!-- Pending files list -->
        <div v-if="pendingFiles.length" class="space-y-1">
          <div class="text-xs text-gray-400 mb-2">待上传文件 ({{ pendingFiles.length }})</div>
          <div
            v-for="(pf, i) in pendingFiles" :key="i"
            class="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-900/40 border border-gray-700/30"
          >
            <div class="flex items-center gap-2 min-w-0">
              <i class="fas fa-file-audio text-gray-500 text-xs flex-shrink-0"></i>
              <span class="text-xs text-gray-300 truncate">{{ pf.name }}</span>
              <span class="text-[11px] text-gray-600 flex-shrink-0">
                {{ (pf.file.size / 1024 / 1024).toFixed(1) }} MB
              </span>
            </div>
            <el-button size="small" type="danger" circle plain @click="removePendingFile(i)">
              <i class="fas fa-xmark"></i>
            </el-button>
          </div>
        </div>
        <div v-else class="text-center py-4 text-xs text-gray-600">
          尚未选择文件
        </div>

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
  </div>
</template>
