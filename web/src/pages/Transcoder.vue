<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { transcoderAPI } from '../api'
import { ElMessage } from 'element-plus'

const ffmpegStatus = ref<any>(null)
const dirPath = ref('')
const tasks = ref<any[]>([])
const uploadedFiles = ref<string[]>([])
const uploading = ref(false)
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
  if (!dirPath.value && !uploadedFiles.value.length) { ElMessage.warning('请先上传文件或指定目录'); return }
  const { data } = await transcoderAPI.startConvert({
    dir: dirPath.value || undefined,
    files: uploadedFiles.value.length ? uploadedFiles.value : undefined,
  })
  if (data.error) { ElMessage.error(data.error); return }
  ElMessage.success(`已创建 ${data.tasks.length} 个转码任务`)
  activeTab.value = 'tasks'; refreshTasks()
}

async function cancelTask(id: string) { await transcoderAPI.cancelTask(id); refreshTasks() }

onMounted(() => { checkFfmpeg(); refreshTasks() })
</script>

<template>
  <div class="p-6 max-w-[1200px]">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">转码处理</h2>
        <p class="text-sm text-gray-500">FFmpeg 将音视频转换为 16kHz 单声道 WAV</p>
      </div>
      <div class="text-xs">
        <span v-if="ffmpegStatus?.found" class="text-emerald-400"><i class="fas fa-circle text-[6px] mr-1"></i>FFmpeg {{ ffmpegStatus.version?.split('-')[0] }}</span>
        <span v-else class="text-red-400"><i class="fas fa-circle text-[6px] mr-1"></i>FFmpeg 未检测到</span>
      </div>
    </div>

    <div class="flex gap-2 mb-5">
      <button v-for="tab in [{ key: 'upload', label: '上传文件', icon: 'fa-upload' },{ key: 'tasks', label: '转码任务', icon: 'fa-list' }]"
        :key="tab.key" @click="activeTab = tab.key"
        class="px-4 py-2 text-sm rounded-lg transition-colors flex items-center gap-2"
        :class="activeTab === tab.key ? 'bg-gray-800 text-gray-100 border border-gray-600' : 'text-gray-400 hover:text-gray-200'">
        <i :class="'fas '+tab.icon+' text-xs'"></i>{{ tab.label }}<span v-if="tab.key==='tasks'" class="text-xs text-gray-500 ml-1">({{tasks.length}})</span>
      </button>
    </div>

    <div v-show="activeTab==='upload'" class="space-y-5">
      <div class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-upload text-emerald-400"></i>上传文件</h3>
        <label class="block border-2 border-dashed border-gray-600/50 rounded-xl p-10 text-center cursor-pointer hover:border-blue-500/50 hover:bg-gray-700/30 transition-colors">
          <i class="fas fa-cloud-arrow-up text-3xl text-gray-500 mb-3 block"></i>
          <div class="text-sm text-gray-400 mb-1">{{ uploading ? '上传中...' : '点击或拖拽文件到此处' }}</div>
          <div class="text-xs text-gray-600">支持 mp3/wav/flac/aac/ogg/mp4/mkv/webm/mov/avi</div>
          <input type="file" multiple accept="audio/*,video/*" class="hidden" :disabled="uploading" @change="handleUpload" />
        </label>
        <div v-if="uploadedFiles.length" class="mt-4 space-y-1">
          <div class="text-xs text-gray-500 mb-2">已上传 {{ uploadedFiles.length }} 个文件</div>
          <div v-for="f in uploadedFiles.slice(0,6)" :key="f" class="text-xs text-gray-400 py-1.5 px-3 bg-gray-900/40 rounded-lg truncate font-mono"><i class="fas fa-file-lines mr-2 text-gray-600"></i>{{ f }}</div>
        </div>
      </div>

      <div class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-folder-open text-amber-400"></i>或扫描本地目录</h3>
        <div class="flex gap-3">
          <input v-model="dirPath" class="flex-1 px-3 py-2.5 bg-gray-900/70 border border-gray-600/50 rounded-lg text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500/50" placeholder="D:\media 或 /home/user/media" />
          <button class="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 flex items-center gap-2 flex-shrink-0" @click="startConvert"><i class="fas fa-play text-xs"></i>开始转换</button>
        </div>
      </div>

      <div class="p-4 rounded-xl bg-blue-500/5 border border-blue-500/15 flex items-start gap-3">
        <i class="fas fa-bolt text-blue-400 mt-0.5"></i>
        <div><div class="text-sm text-blue-300 font-medium mb-0.5">输出规格</div><div class="text-xs text-blue-400/70">16kHz · 单声道 · 16-bit PCM WAV</div></div>
      </div>
    </div>

    <div v-show="activeTab==='tasks'" class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
      <el-table v-if="tasks.length" :data="tasks" size="small">
        <el-table-column label="任务 ID" min-width="160"><template #default="{row}"><span class="text-xs font-mono text-gray-400">{{row.id.slice(0,12)}}...</span></template></el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              :class="row.status==='completed'?'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25':row.status==='running'?'bg-blue-500/15 text-blue-300 border border-blue-500/25':row.status==='failed'?'bg-red-500/15 text-red-300 border border-red-500/25':'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25'">
              {{row.status==='completed'?'完成':row.status==='running'?'转换中':row.status==='failed'?'失败':'等待'}}</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="180"><template #default="{row}"><el-progress :percentage="row.progress" :stroke-width="6" :status="row.status==='failed'?'exception':row.status==='completed'?'success':undefined"/></template></el-table-column>
        <el-table-column prop="retries" label="重试" width="60" align="center"/>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{row}"><button v-if="row.status==='running'||row.status==='pending'" class="text-xs text-red-400 hover:text-red-300" @click="cancelTask(row.id)">取消</button><span v-else class="text-xs text-gray-600">-</span></template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-16 text-gray-500 text-sm"><i class="fas fa-wand-magic-sparkles text-3xl mb-3 block opacity-30"></i>暂无转码任务</div>
    </div>
  </div>
</template>
