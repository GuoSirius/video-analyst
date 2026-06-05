<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { whisperAPI, crawlerAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

// --- State ---
const crawlItems = ref<any[]>([])
const tasks = ref<any[]>([])
const results = ref<any[]>([])
const selectedItemIds = ref<string[]>([])
const statusFilter = ref('all')

// Whisper options
const whispModel = ref('base')
const whispTemp = ref(0.0)
const whispTempInc = ref(0.2)
const whispFormat = ref('json')

// --- Actions ---
async function refresh() {
  const [items, t, r] = await Promise.all([
    crawlerAPI.getItems(),
    whisperAPI.getTasks(),
    whisperAPI.getResults(),
  ])
  crawlItems.value = items.data
  tasks.value = t.data
  results.value = r.data
}

async function startTranscribe() {
  if (!selectedItemIds.value.length) { ElMessage.warning('请先选择媒体项'); return }
  const { data } = await whisperAPI.transcribe({
    itemIds: selectedItemIds.value,
    options: {
      model: whispModel.value,
      temperature: whispTemp.value,
      temperature_inc: whispTempInc.value,
      response_format: whispFormat.value,
    },
  })
  if (data.error) { ElMessage.error(data.error); return }
  ElMessage.success(`已创建 ${data.tasks.length} 个识别任务`)
  selectedItemIds.value = []
  refresh()
}

// Task operations
async function startTask(id: string) {
  try { await whisperAPI.startTask(id); ElMessage.success('任务已开始'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function pauseTask(id: string) {
  try { await whisperAPI.pauseTask(id); ElMessage.success('任务已暂停'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要终止此任务吗？', '确认', { type: 'warning' })
    await whisperAPI.stopTask(id); ElMessage.success('任务已终止'); refresh()
  } catch { /* cancelled */ }
}
async function retryTask(id: string) {
  try { await whisperAPI.retryTask(id); ElMessage.success('已重新加入队列'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function reRunTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要重新运行吗？', '确认', { type: 'warning' })
    await whisperAPI.reRunTask(id); ElMessage.success('任务已重新运行'); refresh()
  } catch { /* cancelled */ }
}
async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此任务吗？', '确认删除', { type: 'warning' })
    await whisperAPI.deleteTask(id); ElMessage.success('任务已删除'); refresh()
  } catch { /* cancelled */ }
}

// --- Helpers ---
const filteredTasks = computed(() => {
  if (statusFilter.value === 'all') return tasks.value
  return tasks.value.filter((t: any) => t.status === statusFilter.value)
})

function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: '等待中', running: '进行中', completed: '已完成',
    failed: '失败', cancelled: '已取消', paused: '已暂停',
  }
  return map[s] || s
}

function statusClass(s: string) {
  const map: Record<string, string> = {
    completed: 'badge-completed', running: 'badge-running',
    failed: 'badge-failed', cancelled: 'badge-cancelled',
    paused: 'badge-paused', pending: 'badge-pending',
  }
  return map[s] || ''
}

function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canPause(s: string) { return s === 'running' }
function canStop(s: string) { return s === 'running' || s === 'paused' }
function canRetry(s: string) { return s === 'failed' }
function canReRun(s: string) { return s === 'completed' || s === 'failed' || s === 'cancelled' }
function canDelete(s: string) { return s !== 'running' }

onMounted(refresh)
</script>

<template>
  <div class="px-7 py-6">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">文字提取</h2>
        <p class="text-[13px] text-gray-500">Whisper 语音识别，将音频转为文字</p>
      </div>
    </div>

    <!-- Source items -->
    <div class="card-static mb-5">
      <h3 class="text-sm font-semibold mb-4 flex items-center gap-2">
        <i class="fas fa-microphone text-violet-400"></i>选择媒体项进行识别
      </h3>
      <el-table
        v-if="crawlItems.length"
        :data="crawlItems"
        size="small"
        row-key="id"
        max-height="250"
        @selection-change="(rows: any) => selectedItemIds = rows.map((r: any) => r.id)"
      >
        <el-table-column type="selection" width="40" />
        <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200" />
        <el-table-column label="来源" width="140">
          <template #default="{ row }">
            <span class="text-xs text-gray-400">{{ row.media_source || '-' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-xs text-gray-500 py-4">暂无采集数据，请先去爬虫页面采集内容</div>

      <div class="mt-4 space-y-3">
        <el-button type="primary" :disabled="!selectedItemIds.length" @click="startTranscribe">
          <i class="fas fa-play mr-1.5"></i>开始识别 ({{ selectedItemIds.length }})
        </el-button>

        <details class="text-xs text-gray-500">
          <summary class="cursor-pointer text-gray-400">识别参数</summary>
          <div class="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 ml-4">
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500 w-20">模型</span>
              <el-select v-model="whispModel" size="small" class="!w-28">
                <el-option v-for="m in ['tiny', 'base', 'small', 'medium', 'large']" :key="m" :label="m" :value="m" />
              </el-select>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500 w-20">输出格式</span>
              <el-select v-model="whispFormat" size="small" class="!w-28">
                <el-option v-for="f in ['json', 'text', 'srt', 'vtt']" :key="f" :label="f" :value="f" />
              </el-select>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500 w-20">Temperature</span>
              <el-input-number v-model="whispTemp" :min="0" :max="1" :step="0.1" :precision="1" size="small" class="!w-28" />
              <span class="text-[10px] text-gray-600">仅API</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500 w-20">Temp Inc</span>
              <el-input-number v-model="whispTempInc" :min="0" :max="1" :step="0.1" :precision="1" size="small" class="!w-28" />
              <span class="text-[10px] text-gray-600">仅API</span>
            </div>
          </div>
        </details>
      </div>
    </div>

    <!-- Task list -->
    <div class="card-static mb-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold flex items-center gap-2">
          <i class="fas fa-list-check text-blue-400"></i>识别任务
        </h3>
        <div class="flex gap-2">
          <el-button
            v-for="f in [{ k: 'all', l: '全部' }, { k: 'running', l: '进行中' }, { k: 'completed', l: '已完成' }, { k: 'failed', l: '失败' }]"
            :key="f.k" size="small"
            :type="statusFilter === f.k ? 'primary' : 'default'"
            :plain="statusFilter !== f.k"
            @click="statusFilter = f.k"
          >{{ f.l }}</el-button>
        </div>
      </div>

      <el-table v-if="filteredTasks.length" :data="filteredTasks" size="small" row-key="id">
        <el-table-column label="文件" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-300">{{ row.payload?.filePath?.split(/[\\/]/).pop() || row.id.slice(0, 12) + '...' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <span class="badge" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="140">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :stroke-width="6"
              :status="row.status === 'failed' ? 'exception' : row.status === 'completed' ? 'success' : undefined" />
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="260" align="center">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <el-button v-if="canStart(row.status)" size="small" type="primary" plain @click="startTask(row.id)">
                {{ row.status === 'paused' ? '继续' : '开始' }}
              </el-button>
              <el-button v-if="canPause(row.status)" size="small" type="warning" plain @click="pauseTask(row.id)">暂停</el-button>
              <el-button v-if="canStop(row.status)" size="small" type="danger" plain @click="stopTask(row.id)">终止</el-button>
              <el-button v-if="canRetry(row.status)" size="small" type="warning" plain @click="retryTask(row.id)">重试</el-button>
              <el-button v-if="canReRun(row.status)" size="small" plain @click="reRunTask(row.id)">重新运行</el-button>
              <el-button v-if="canDelete(row.status)" size="small" type="danger" plain @click="deleteTask(row.id)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-8 text-gray-500 text-xs">暂无识别任务</div>
    </div>

    <!-- Results -->
    <div v-if="results.length" class="card-static">
      <h3 class="text-sm font-semibold mb-4">识别结果 ({{ results.length }})</h3>
      <div class="space-y-3 max-h-[500px] overflow-y-auto">
        <div v-for="r in results" :key="r.id" class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/30">
          <div class="flex items-center justify-between mb-2">
            <span class="badge" :class="r.status === 'completed' ? 'badge-completed' : 'badge-pending'">
              {{ r.status === 'completed' ? '完成' : '处理中' }}
            </span>
            <span class="text-[11px] text-gray-600">{{ r.created_at }}</span>
          </div>
          <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
            {{ r.content?.slice(0, 500) }}{{ r.content?.length > 500 ? '...' : '' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
