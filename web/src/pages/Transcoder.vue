<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { transcoderAPI } from '../api'
import { ElMessage } from 'element-plus'

const ffmpegStatus = ref<any>(null)
const dirPath = ref('')
const tasks = ref<any[]>([])
const uploading = ref(false)
const uploadedFiles = ref<string[]>([])
const activeTab = ref('upload')

async function checkFfmpeg() { const { data } = await transcoderAPI.checkFfmpeg(); ffmpegStatus.value = data }
async function refreshTasks() { const { data } = await transcoderAPI.getTasks(); tasks.value = data }

async function handleUpload(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  uploading.value = true
  const fd = new FormData()
  for (const f of Array.from(input.files)) fd.append('files', f)
  try {
    const { data } = await transcoderAPI.upload(fd)
    uploadedFiles.value.push(...data.files)
    ElMessage.success(`已上传 ${data.files.length} 个文件`)
  } catch { ElMessage.error('上传失败') }
  uploading.value = false; input.value = ''
}

async function startConvert() {
  const { data } = await transcoderAPI.startConvert({
    dir: dirPath.value || undefined,
    files: uploadedFiles.value.length ? uploadedFiles.value : undefined,
  })
  if (data.error) { ElMessage.error(data.error); return }
  ElMessage.success(`已创建 ${data.tasks.length} 个转码任务`)
  activeTab.value = 'tasks'; refreshTasks()
}

async function cancelTask(id: string) { await transcoderAPI.cancelTask(id); refreshTasks() }

const runningCount = computed(() => tasks.value.filter((t: any) => t.status === 'running').length)
const completedCount = computed(() => tasks.value.filter((t: any) => t.status === 'completed').length)

onMounted(() => { checkFfmpeg(); refreshTasks() })
</script>

<template>
  <div class="page-container">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-lg font-bold text-gray-100 mb-1">转码处理</h2>
        <p class="text-sm text-gray-500">FFmpeg 将音视频转换为 16kHz 单声道 WAV，适配 Whisper 识别</p>
      </div>
      <div class="flex items-center gap-2 text-xs">
        <span v-if="ffmpegStatus?.found" class="flex items-center gap-1.5 text-emerald-400">
          <i class="fas fa-circle text-[6px]"></i> FFmpeg {{ ffmpegStatus.version?.split('-')[0] }}
        </span>
        <span v-else class="flex items-center gap-1.5 text-red-400">
          <i class="fas fa-circle text-[6px]"></i> FFmpeg 未检测到
        </span>
      </div>
    </div>

    <div class="flex gap-1 mb-6">
      <button
        v-for="tab in [
          { key: 'upload', label: '文件上传', icon: 'upload' },
          { key: 'tasks', label: `转码任务 (${tasks.length})`, icon: 'list' },
        ]"
        :key="tab.key"
        @click="activeTab = tab.key"
        class="px-4 py-2 text-sm rounded-lg transition-all duration-200 flex items-center gap-2"
        :class="activeTab === tab.key ? 'bg-gray-800 text-gray-100 font-medium border border-gray-600/50' : 'text-gray-500 hover:text-gray-300'"
      >
        <i :class="'fas fa-' + tab.icon + ' text-xs'"></i> {{ tab.label }}
      </button>
    </div>

    <div v-show="activeTab === 'upload'" class="space-y-5">
      <div class="card-static">
        <div class="flex items-center gap-2 mb-4">
          <i class="fas fa-upload text-emerald-400 text-sm"></i>
          <h3 class="text-sm font-semibold text-gray-200">上传文件</h3>
        </div>
        <label
          class="block border-2 border-dashed border-gray-600/50 rounded-xl p-10 text-center cursor-pointer hover:border-blue-500/50 hover:bg-gray-800/40 transition-all duration-200"
          :class="{ 'pointer-events-none opacity-50': uploading }"
        >
          <i class="fas fa-upload text-3xl mb-3 text-gray-500 block"></i>
          <div class="text-sm text-gray-400 mb-1">{{ uploading ? '上传中...' : '点击或拖拽文件到此处' }}</div>
          <div class="text-xs text-gray-600">支持音频 (mp3/wav/flac/aac/ogg) 和视频 (mp4/mkv/webm/mov/avi)</div>
          <input type="file" multiple accept="audio/*,video/*" class="hidden" @change="handleUpload" />
        </label>

        <div v-if="uploadedFiles.length" class="mt-4 space-y-1">
          <div class="text-xs text-gray-500 mb-2">已上传 {{ uploadedFiles.length }} 个文件</div>
          <div v-for="f in uploadedFiles.slice(0, 8)" :key="f" class="text-xs text-gray-400 py-1.5 px-3 bg-gray-900/40 rounded-lg truncate font-mono">
            <i class="fas fa-file-lines mr-2 text-gray-600"></i>{{ f }}
          </div>
          <div v-if="uploadedFiles.length > 8" class="text-xs text-gray-600 px-3">...还有 {{ uploadedFiles.length - 8 }} 个</div>
        </div>
      </div>

      <div class="card-static">
        <div class="flex items-center gap-2 mb-4">
          <i class="fas fa-folder-open text-amber-400 text-sm"></i>
          <h3 class="text-sm font-semibold text-gray-200">或扫描本地目录</h3>
        </div>
        <div class="flex gap-3">
          <input v-model="dirPath" class="input flex-1" placeholder="D:\media\videos 或 /home/user/recordings" />
          <button class="btn btn-primary" :disabled="!dirPath && !uploadedFiles.length" @click="startConvert">
            <i class="fas fa-play"></i> 开始转换
          </button>
        </div>
        <p class="text-[11px] text-gray-600 mt-2">自动递归扫描目录下所有支持的音视频文件</p>
      </div>

      <div class="rounded-xl bg-blue-500/5 border border-blue-500/15 p-4 flex items-start gap-3">
        <i class="fas fa-bolt text-blue-400 flex-shrink-0 mt-0.5"></i>
        <div>
          <div class="text-sm text-blue-300 font-medium mb-0.5">转换规格</div>
          <div class="text-xs text-blue-400/70">16kHz 采样率 · 单声道 · 16-bit PCM WAV — Whisper 最佳输入格式</div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'tasks'" class="card-static">
      <div v-if="runningCount" class="flex items-center gap-2 mb-4 text-xs text-emerald-400">
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        {{ runningCount }} 个进行中 · {{ completedCount }} 个已完成
      </div>
      <el-table v-if="tasks.length" :data="tasks" style="width: 100%" size="small" row-key="id">
        <el-table-column label="任务" min-width="180">
          <template #default="{ row }"><div class="text-xs text-gray-300 font-mono">{{ row.id.slice(0, 12) }}...</div></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span :class="`badge text-[11px] ${row.status === 'completed' ? 'badge-completed' : row.status === 'running' ? 'badge-running' : row.status === 'failed' ? 'badge-failed' : 'badge-pending'}`">
              <i v-if="row.status === 'completed'" class="fas fa-circle-check text-[10px]"></i>
              <i v-else-if="row.status === 'running'" class="fas fa-spinner text-[10px] animate-spin"></i>
              {{ row.status === 'completed' ? '完成' : row.status === 'running' ? '转换中' : row.status === 'failed' ? '失败' : '等待' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="180">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :stroke-width="6" :status="row.status === 'failed' ? 'exception' : row.status === 'completed' ? 'success' : undefined" />
          </template>
        </el-table-column>
        <el-table-column prop="retries" label="重试" width="60" align="center" />
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }">
            <button v-if="row.status === 'running' || row.status === 'pending'" class="text-xs text-red-400 hover:text-red-300" @click="cancelTask(row.id)">
              <i class="fas fa-stop"></i> 取消
            </button>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-wand-magic-sparkles text-3xl mb-3 block opacity-40"></i>
        暂无转码任务
      </div>
    </div>
  </div>
</template>
