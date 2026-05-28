<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { aiAPI, whisperAPI, promptsAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()

// --- State ---
const providers = ref<any[]>([])
const prompts = ref<any[]>([])
const transcriptions = ref<any[]>([])
const tasks = ref<any[]>([])
const results = ref<any[]>([])
const selectedPromptId = ref('default')
const aiPrompt = ref('请对以下文本进行总结，提取关键信息和关键词，用中文回复。\n\n{{content}}')
const temperature = ref(0.7)
const selectedTransIds = ref<string[]>([])
const statusFilter = ref('all')

// --- Actions ---
async function refresh() {
  const [pv, pr, tr, t, r] = await Promise.all([
    aiAPI.getProviders(),
    promptsAPI.getAll(),
    whisperAPI.getResults(),
    aiAPI.getTasks(),
    aiAPI.getResults(),
  ])
  providers.value = pv.data
  prompts.value = pr.data
  transcriptions.value = tr.data
  tasks.value = t.data
  results.value = r.data

  const def = pr.data.find((p: any) => p.is_default)
  if (def) { selectedPromptId.value = def.id; aiPrompt.value = def.content }
}

function onPromptChange(id: string) {
  selectedPromptId.value = id
  const p = prompts.value.find((p: any) => p.id === id)
  if (p) aiPrompt.value = p.content
}

const enabledProviders = computed(() => providers.value.filter((p: any) => p.enabled))

function ensureProviders(): boolean {
  if (!enabledProviders.value.length) {
    ElMessageBox.alert(
      '尚未配置 AI 模型，请先在"模型管理"页面添加并启用至少一个模型。',
      '无可用模型',
      { confirmButtonText: '去配置', type: 'warning', callback: () => router.push('/models') },
    )
    return false
  }
  return true
}

async function startAnalyze() {
  if (!selectedTransIds.value.length) { ElMessage.warning('请选择要分析的文本'); return }
  if (!ensureProviders()) return
  const { data } = await aiAPI.analyze({
    config: { prompt: aiPrompt.value, temperature: temperature.value },
    transcriptionIds: selectedTransIds.value,
  })
  if (data.error) { ElMessage.error(data.error); return }
  ElMessage.success(`已创建 ${data.tasks.length} 个分析任务`)
  selectedTransIds.value = []
  refresh()
}

// Task operations
async function startTask(id: string) {
  try { await aiAPI.startTask(id); ElMessage.success('任务已开始'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function pauseTask(id: string) {
  try { await aiAPI.pauseTask(id); ElMessage.success('任务已暂停'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要终止此任务吗？', '确认', { type: 'warning' })
    await aiAPI.stopTask(id); ElMessage.success('任务已终止'); refresh()
  } catch { /* cancelled */ }
}
async function retryTask(id: string) {
  try { await aiAPI.retryTask(id); ElMessage.success('已重新加入队列'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function reRunTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要重新运行吗？', '确认', { type: 'warning' })
    await aiAPI.reRunTask(id); ElMessage.success('任务已重新运行'); refresh()
  } catch { /* cancelled */ }
}
async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此任务吗？', '确认删除', { type: 'warning' })
    await aiAPI.deleteTask(id); ElMessage.success('任务已删除'); refresh()
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
        <h2 class="text-lg font-bold mb-1">模型总结</h2>
        <p class="text-[13px] text-gray-500">使用大模型对识别文本进行智能分析和总结</p>
      </div>
    </div>

    <!-- Provider warning -->
    <div v-if="!enabledProviders.length" class="rounded-xl bg-amber-500/8 border border-amber-500/20 p-4 mb-5 flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm text-amber-300">
        <i class="fas fa-triangle-exclamation"></i> 尚未配置 AI 模型
      </div>
      <el-button size="small" type="warning" @click="router.push('/models')">去配置模型</el-button>
    </div>

    <!-- Config -->
    <div class="card-static mb-5">
      <h3 class="text-sm font-semibold mb-4 flex items-center gap-2">
        <i class="fas fa-sliders text-amber-400"></i>分析配置
      </h3>

      <!-- Provider priority -->
      <div class="mb-4 p-4 rounded-lg bg-gray-900/40 border border-gray-700/30">
        <div class="text-xs text-gray-400 mb-2">模型优先级（从上到下，失败后自动尝试下一个）</div>
        <div class="space-y-1">
          <div v-for="(p, i) in providers" :key="p.name"
            class="flex items-center gap-3 px-3 py-2 rounded-lg"
            :class="p.enabled ? 'bg-gray-800/60 border border-gray-700/40' : 'bg-gray-900/40 border border-gray-700/20 opacity-60'">
            <span class="text-[11px] text-gray-500 w-5 text-center">{{ i + 1 }}</span>
            <span class="text-sm flex-1" :class="p.enabled ? 'text-gray-200' : 'text-gray-500'">
              {{ p.name === 'deepseek' ? 'DeepSeek' : p.name === 'minimax' ? 'MiniMax' : p.name }}
              <span v-if="i === 0 && p.enabled" class="text-[11px] text-emerald-400 ml-2">首选</span>
            </span>
            <span v-if="!p.enabled" class="text-[11px] text-gray-500">未启用</span>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div class="text-xs text-gray-400 mb-1.5">提示词模板</div>
          <el-select v-model="selectedPromptId" @change="onPromptChange" class="!w-full">
            <el-option v-for="p in prompts" :key="p.id" :value="p.id"
              :label="(p.is_default ? '[默认] ' : '') + p.name" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">Temperature</div>
          <el-input-number v-model="temperature" :min="0" :max="2" :step="0.1" :precision="1" class="!w-full" />
        </div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs text-gray-400"><code v-pre class="text-gray-600">{{content}}</code> 会被替换为实际文本</span>
          <el-button size="small" type="primary" text @click="router.push('/prompts')">
            <i class="fas fa-edit mr-1"></i>管理提示词
          </el-button>
        </div>
        <el-input v-model="aiPrompt" type="textarea" :rows="4" placeholder="输入你的分析提示词..." />
      </div>
    </div>

    <!-- Select transcriptions -->
    <div class="card-static mb-5">
      <h3 class="text-sm font-semibold mb-4">选择待分析文本</h3>
      <el-table
        v-if="transcriptions.length"
        :data="transcriptions"
        size="small"
        max-height="250"
        @selection-change="(rows: any) => selectedTransIds = rows.map((r: any) => r.id)"
      >
        <el-table-column type="selection" width="40" />
        <el-table-column label="文本预览" show-overflow-tooltip min-width="350">
          <template #default="{ row }">{{ row.content?.slice(0, 120) }}{{ row.content?.length > 120 ? '...' : '' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <span class="badge" :class="row.status === 'completed' ? 'badge-completed' : 'badge-pending'">
              {{ row.status === 'completed' ? '就绪' : '处理中' }}
            </span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-xs text-gray-500 py-4">暂无识别文本，请先去文字提取页面进行语音识别</div>
      <el-button type="primary" class="mt-4" :disabled="!selectedTransIds.length" @click="startAnalyze">
        <i class="fas fa-play mr-1.5"></i>开始分析 ({{ selectedTransIds.length }})
      </el-button>
    </div>

    <!-- AI Tasks -->
    <div class="card-static mb-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold flex items-center gap-2">
          <i class="fas fa-list-check text-emerald-400"></i>分析任务
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
        <el-table-column label="模型" width="120">
          <template #default="{ row }">
            <span class="text-xs text-gray-300">{{ row.payload?.config?.provider || '-' }}</span>
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
              <el-button v-if="canPause(row.status)" size="small" type="warning" plain @click="pauseTask(row.id)">暂停</el-button>
              <el-button v-if="canStop(row.status)" size="small" type="danger" plain @click="stopTask(row.id)">终止</el-button>
              <el-button v-if="canRetry(row.status)" size="small" type="warning" plain @click="retryTask(row.id)">重试</el-button>
              <el-button v-if="canReRun(row.status)" size="small" plain @click="reRunTask(row.id)">重新运行</el-button>
              <el-button v-if="canDelete(row.status)" size="small" type="danger" plain @click="deleteTask(row.id)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-8 text-gray-500 text-xs">暂无分析任务</div>
    </div>

    <!-- AI Results -->
    <div v-if="results.length" class="card-static">
      <h3 class="text-sm font-semibold mb-4">分析结果 ({{ results.length }})</h3>
      <div class="space-y-3 max-h-[500px] overflow-y-auto">
        <div v-for="r in results" :key="r.id" class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/30">
          <div class="flex items-center gap-2 mb-2">
            <span class="badge" :class="r.status === 'completed' ? 'badge-completed' : 'badge-pending'">
              {{ r.status === 'completed' ? '完成' : '处理中' }}
            </span>
            <span class="text-[11px] text-gray-500">{{ r.model }}</span>
            <span class="text-[11px] text-gray-600">{{ r.created_at }}</span>
          </div>
          <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
            {{ r.result?.slice(0, 600) }}{{ r.result?.length > 600 ? '...' : '' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
