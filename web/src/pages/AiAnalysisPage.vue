<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { aiAPI, whisperAPI, promptsAPI } from '../api'
import api from '../api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { copyWithFeedback } from '../utils/clipboard'
import { usePagination } from '../composables/usePagination'
import StatusBadge from '../components/StatusBadge.vue'

const router = useRouter()

// --- State ---
const providers = ref<any[]>([])
const prompts = ref<any[]>([])
const transcriptions = ref<any[]>([])
const downloadItems = ref<any[]>([])
const tasks = ref<any[]>([])
const results = ref<any[]>([])
const selectedTransIds = ref<string[]>([])
const selectedItemIds = ref<string[]>([])

// --- Filters ---
const statusFilter = ref('all')
const keyword = ref('')
const activeSourceTab = ref<'transcription' | 'direct'>('transcription')

// --- Pagination ---
const { page, pageSize, total, pageSizes, onPageChange, onPageSizeChange } = usePagination({
  defaultPageSize: 20,
  onFetch: () => fetchTasks(),
})

// --- AI Config ---
const selectedPromptId = ref('default')
const aiPrompt = ref('请对以下文本进行总结，提取关键信息和关键词，用中文回复。\n\n{{content}}')
const temperature = ref(0.7)

// --- Dialogs ---
const resultDialog = ref(false)
const resultTitle = ref('')
const resultContent = ref('')
const resultMeta = ref<{ label: string; value: string }[]>([])

// --- SSE ---
let sseConnection: EventSource | null = null

const statusLabels: Record<string, string> = {
  pending: '待分析',
  running: '分析中',
  completed: '已完成',
  failed: '分析失败',
  cancelled: '已取消',
  paused: '已暂停',
}

// --- Computed ---
const enabledProviders = computed(() => providers.value.filter((p: any) => p.enabled))

function ensureProviders(): boolean {
  if (!enabledProviders.value.length) {
    ElMessageBox.alert(
      '尚未配置 AI 供应商，请先在"供应商管理"页面添加并启用至少一个供应商。',
      '无可用供应商',
      { confirmButtonText: '去配置', type: 'warning', callback: () => router.push('/providers') },
    )
    return false
  }
  return true
}

// --- Actions ---
async function refresh() {
  const [pv, pr, tr, dq, air] = await Promise.all([
    aiAPI.getProviders(),
    promptsAPI.getAll(),
    whisperAPI.getResults(),
    api.get('/download/queue'),
    aiAPI.getResults(),
  ])
  providers.value = pv.data
  prompts.value = pr.data
  transcriptions.value = tr.data
  downloadItems.value = dq.data || []
  results.value = air.data

  const def = pr.data.find((p: any) => p.is_default)
  if (def) { selectedPromptId.value = def.id; aiPrompt.value = def.content }
}

async function fetchTasks() {
  const params: Record<string, any> = {
    type: 'ai',
    page: page.value,
    pageSize: pageSize.value,
  }
  if (statusFilter.value !== 'all') params.status = statusFilter.value
  if (keyword.value) params.keyword = keyword.value

  const { data } = await api.get('/tasks', { params })
  tasks.value = data.items || data
  total.value = data.total || (Array.isArray(data) ? data.length : 0)
}

// Debounced keyword
let keywordTimer: any
watch([statusFilter], () => {
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

function onPromptChange(id: string) {
  selectedPromptId.value = id
  const p = prompts.value.find((p: any) => p.id === id)
  if (p) aiPrompt.value = p.content
}

// --- Analyze from Transcriptions ---
async function startAnalyzeTranscriptions() {
  if (!selectedTransIds.value.length) { ElMessage.warning('请选择要分析的语音文本'); return }
  if (!ensureProviders()) return
  const { data } = await aiAPI.analyze({
    config: { prompt: aiPrompt.value, temperature: temperature.value },
    transcriptionIds: selectedTransIds.value,
  })
  if (data.error) { ElMessage.error(data.error); return }
  ElMessage.success(`已创建 ${data.tasks.length} 个分析任务`)
  selectedTransIds.value = []
  refresh()
  fetchTasks()
}

// --- Analyze Directly (images/docs) ---
async function startAnalyzeDirect() {
  if (!selectedItemIds.value.length) { ElMessage.warning('请选择要分析的文件'); return }
  if (!ensureProviders()) return
  // TODO: Call direct item analysis endpoint when available
  ElMessage.info('直接分析功能开发中，请先将文件转为文本后分析')
}

// --- Task Operations ---
async function startTask(id: string) {
  try { await aiAPI.startTask(id); ElMessage.success('分析任务已开始'); fetchTasks() }
  catch { ElMessage.error('操作失败') }
}

async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要停止此分析任务吗？', '确认停止', { type: 'warning' })
    await aiAPI.stopTask(id); ElMessage.success('任务已停止'); fetchTasks()
  } catch { /* cancelled */ }
}

async function retryTask(id: string) {
  try { await aiAPI.retryTask(id); ElMessage.success('已重新加入队列'); fetchTasks() }
  catch { ElMessage.error('操作失败') }
}

function copyAnalysisResult() {
  copyWithFeedback(resultContent.value)
}

async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此分析任务吗？', '确认删除', { type: 'warning' })
    await aiAPI.deleteTask(id); ElMessage.success('任务已删除'); fetchTasks()
  } catch { /* cancelled */ }
}

// --- View Result ---
function viewResult(r: any) {
  resultTitle.value = 'AI 分析结果'
  resultContent.value = r.result || r.text || '暂无内容'
  resultMeta.value = [
    { label: '模型', value: r.model || '-' },
    { label: '状态', value: r.status || '-' },
    { label: '创建时间', value: r.created_at || '-' },
  ]
  resultDialog.value = true
}

// --- Selection ---
function handleTaskSelectionChange(_rows: any[]) {
  // placeholder for table selection
}

async function autoProcessAll() {
  if (activeSourceTab.value === 'transcription') {
    const pending = transcriptions.value.filter((t: any) => t.status === 'completed')
    if (!pending.length) { ElMessage.info('没有可分析的语音文本'); return }
    try {
      await ElMessageBox.confirm(
        `当前有 ${pending.length} 条可分析的语音文本，确认一键自动分析全部吗？`,
        '一键自动分析',
        { type: 'info', confirmButtonText: '开始' },
      )
      const { data } = await aiAPI.analyze({
        config: { prompt: aiPrompt.value, temperature: temperature.value },
        transcriptionIds: pending.map((t: any) => t.id),
      })
      ElMessage.success(`已创建 ${data.tasks?.length || 0} 个分析任务`)
      fetchTasks()
    } catch { /* cancelled */ }
  }
}

// --- Helpers ---
function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canStop(s: string) { return s === 'running' }
function canRetry(s: string) { return s === 'failed' || s === 'cancelled' }
function canDelete(s: string) { return s !== 'running' }

function promptPreview(t: any) {
  const p = t.payload?.config?.prompt || ''
  return p.replace(/\{\{content\}\}/g, '...')?.slice(0, 60) || '-'
}

// SSE
const SSE_URL = `${import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api'}/ai/events`

function connectSSE() {
  sseConnection = new EventSource(SSE_URL)
  sseConnection.addEventListener('message', (e) => {
    try {
      const evt = JSON.parse(e.data)
      if (evt.type === 'ai' || !evt.type) {
        const idx = tasks.value.findIndex((t: any) => t.id === evt.taskId)
        if (idx >= 0) {
          tasks.value[idx] = { ...tasks.value[idx], ...evt }
        } else {
          fetchTasks()
        }
      }
    } catch { /* ignore */ }
  })
  sseConnection.onerror = () => { /* reconnect */ }
}

onMounted(() => {
  refresh()
  fetchTasks()
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
        <h2 class="text-lg font-bold mb-1">AI 分析</h2>
        <p class="text-[13px] text-gray-500">使用大模型对文本/图片/文档进行智能分析和总结</p>
      </div>
      <div class="flex items-center gap-2">
        <el-button type="primary" size="small" @click="autoProcessAll">
          <i class="fas fa-forward-step mr-1"></i>一键自动分析
        </el-button>
      </div>
    </div>

    <!-- Provider Warning -->
    <div v-if="!enabledProviders.length" class="rounded-xl bg-amber-500/8 border border-amber-500/20 p-4 mb-5 flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm text-amber-300">
        <i class="fas fa-triangle-exclamation"></i> 尚未配置 AI 供应商
      </div>
      <el-button size="small" type="warning" @click="router.push('/providers')">去配置供应商</el-button>
    </div>

    <!-- Provider Priority -->
    <div v-if="enabledProviders.length" class="rounded-xl border bg-blue-500/5 border-blue-500/20 p-4 mb-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-xs text-blue-400 font-semibold">
            <i class="fas fa-layer-group mr-1"></i>模型优先级
          </span>
          <div class="flex items-center gap-1">
            <template v-for="(p, i) in enabledProviders" :key="p.name">
              <span v-if="i > 0" class="text-gray-600 text-[10px]">→</span>
              <span class="text-xs" :class="i === 0 ? 'text-emerald-400 font-semibold' : 'text-gray-400'">
                {{ p.name }}
              </span>
            </template>
          </div>
        </div>
        <el-button size="small" text @click="router.push('/providers')">
          <i class="fas fa-edit mr-1"></i>管理
        </el-button>
      </div>
    </div>

    <!-- AI Config -->
    <div class="card-static mb-5">
      <h3 class="text-sm font-semibold mb-4 flex items-center gap-2">
        <i class="fas fa-sliders text-amber-400"></i>分析配置
      </h3>
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
          <el-input-number v-model="temperature" :min="0" :max="2" :step="0.1" :precision="1" size="small" class="!w-full" />
        </div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs text-gray-400"><code class="text-gray-600">{<!-- -->{content}<!-- -->}</code> 会被替换为实际文本</span>
          <el-button size="small" type="primary" text @click="router.push('/prompts')">
            <i class="fas fa-edit mr-1"></i>管理提示词
          </el-button>
        </div>
        <el-input v-model="aiPrompt" type="textarea" :rows="4" placeholder="输入你的分析提示词..." />
      </div>
    </div>

    <!-- Source Selection -->
    <div class="card-static mb-5">
      <h3 class="text-sm font-semibold mb-4">选择分析源</h3>

      <div class="flex items-center gap-2 mb-4">
        <el-button
          :type="activeSourceTab === 'transcription' ? 'primary' : 'default'"
          :plain="activeSourceTab !== 'transcription'"
          size="small"
          @click="activeSourceTab = 'transcription'"
        >
          <i class="fas fa-microphone mr-1"></i>语音识别文本
        </el-button>
        <el-button
          :type="activeSourceTab === 'direct' ? 'primary' : 'default'"
          :plain="activeSourceTab !== 'direct'"
          size="small"
          @click="activeSourceTab = 'direct'"
        >
          <i class="fas fa-image mr-1"></i>图片 / 文档
        </el-button>
      </div>

      <!-- Tab: Transcriptions -->
      <div v-show="activeSourceTab === 'transcription'">
        <el-table
          v-if="transcriptions.length"
          :data="transcriptions"
          size="small"
          row-key="id"
          max-height="280"
          @selection-change="(rows: any) => selectedTransIds = rows.map((r: any) => r.id)"
        >
          <el-table-column type="selection" width="40" />
          <el-table-column label="文本预览" show-overflow-tooltip min-width="350">
            <template #default="{ row }">{{ row.content?.slice(0, 200) }}{{ row.content?.length > 200 ? '...' : '' }}</template>
          </el-table-column>
          <el-table-column label="文件" width="160">
            <template #default="{ row }">
              <span class="text-xs text-gray-500">{{ row.file_path?.split(/[\\/]/).pop() || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <StatusBadge :status="row.status" :labels="{ completed: '就绪', pending: '待处理', processing: '处理中', error: '失败' }" />
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="text-xs text-gray-500 py-6 text-center">暂无识别文本，请先进行语音识别</div>

        <el-button type="primary" class="mt-4" :disabled="!selectedTransIds.length || !enabledProviders.length" @click="startAnalyzeTranscriptions">
          <i class="fas fa-play mr-1.5"></i>开始分析 ({{ selectedTransIds.length }})
        </el-button>
      </div>

      <!-- Tab: Images/Docs -->
      <div v-show="activeSourceTab === 'direct'">
        <div class="rounded-lg bg-amber-500/5 border border-amber-500/15 p-4 mb-4 flex items-start gap-2">
          <i class="fas fa-info-circle text-amber-400 mt-0.5 text-xs"></i>
          <div class="text-xs text-amber-400/70">
            直接分析功能需要供应商支持多模态模型（如 GPT-4V、Claude 3.5 Sonnet）。
            当前版本尚未完全支持，请先将文档转为文本再分析。
          </div>
        </div>
        <el-table
          v-if="downloadItems.length"
          :data="downloadItems.filter((d: any) => ['image', 'document'].includes(d.file_type))"
          size="small"
          row-key="id"
          max-height="280"
          @selection-change="(rows: any) => selectedItemIds = rows.map((r: any) => r.id)"
        >
          <el-table-column type="selection" width="40" />
          <el-table-column label="文件名" show-overflow-tooltip min-width="250">
            <template #default="{ row }">
              <span class="text-xs text-gray-300">{{ row.filename || row.url?.split('/').pop() || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }">
              <span class="text-xs text-gray-400">{{ row.file_type || '-' }}</span>
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="text-xs text-gray-500 py-6 text-center">暂无下载的图片或文档文件</div>

        <el-button type="primary" class="mt-4" :disabled="!selectedItemIds.length" @click="startAnalyzeDirect">
          <i class="fas fa-play mr-1.5"></i>开始直接分析 ({{ selectedItemIds.length }})
        </el-button>
      </div>
    </div>

    <!-- AI Tasks -->
    <div class="card-static mb-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold flex items-center gap-2">
          <i class="fas fa-list-check text-emerald-400"></i>分析任务
        </h3>
        <div class="flex items-center gap-2">
          <div class="flex gap-1">
            <el-button
              v-for="f in [
                { k: 'all', l: '全部' }, { k: 'pending', l: '待分析' }, { k: 'running', l: '分析中' },
                { k: 'completed', l: '已完成' }, { k: 'failed', l: '失败' },
              ]"
              :key="f.k" size="small"
              :type="statusFilter === f.k ? 'primary' : 'default'"
              :plain="statusFilter !== f.k"
              @click="statusFilter = f.k"
            >{{ f.l }}</el-button>
          </div>
          <el-input
            v-model="keyword"
            placeholder="搜索..."
            size="small"
            class="!w-40"
            clearable
          >
            <template #prefix>
              <i class="fas fa-search text-gray-500 text-[11px]"></i>
            </template>
          </el-input>
        </div>
      </div>

      <el-table
        ref="tableRef"
        v-if="tasks.length"
        :data="tasks"
        size="small"
        row-key="id"
        @selection-change="handleTaskSelectionChange"
      >
        <el-table-column type="selection" width="40" fixed="left" :reserve-selection="true" />
        <el-table-column type="index" label="#" width="50" align="center" fixed="left" />
        <el-table-column label="模型" width="140">
          <template #default="{ row }">
            <span class="text-xs text-gray-300">{{ row.payload?.config?.provider || row.result?.provider || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="提示词" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ promptPreview(row) }}</span>
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
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="280" align="center">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <el-button v-if="canStart(row.status)" size="small" type="primary" plain @click="startTask(row.id)">
                <i class="fas fa-play mr-1"></i>分析
              </el-button>
              <el-button v-if="canStop(row.status)" size="small" type="danger" plain @click="stopTask(row.id)">
                <i class="fas fa-stop mr-1"></i>停止
              </el-button>
              <el-button v-if="row.status === 'completed'" size="small" plain @click="viewResult(row.result)">
                <i class="fas fa-eye mr-1"></i>查看结果
              </el-button>
              <el-button v-if="row.status === 'completed'" size="small" plain @click="viewResult(row.result)">
                <i class="fas fa-eye mr-1"></i>查看结果
              </el-button>
              <el-button v-if="row.status === 'failed'" size="small" plain @click="viewResult({ text: row.error, model: '', status: row.status, created_at: row.created_at })">
                <i class="fas fa-circle-exclamation mr-1"></i>查看错误
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

      <div v-else class="text-center py-12 text-gray-500 text-sm">
        <i class="fas fa-robot text-3xl mb-3 inline-block opacity-30"></i>
        <div>暂无分析任务</div>
        <div class="text-xs text-gray-600 mt-1">选择语音识别文本或图片/文档后点击「开始分析」</div>
      </div>

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

    <!-- AI Results -->
    <div v-if="results.length" class="card-static">
      <h3 class="text-sm font-semibold mb-4 flex items-center gap-2">
        <i class="fas fa-file-lines text-amber-400"></i>分析结果 ({{ results.length }})
      </h3>
      <div class="space-y-3 max-h-[500px] overflow-y-auto">
        <div
          v-for="r in results" :key="r.id"
          class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/30 hover:border-gray-600/40 cursor-pointer transition-colors"
          @click="viewResult(r)"
        >
          <div class="flex items-center gap-2 mb-2">
            <StatusBadge :status="r.status" :labels="{ completed: '完成', pending: '待处理', processing: '处理中', error: '失败' }" />
            <span class="text-[11px] text-gray-500">{{ r.model }}</span>
            <span class="text-[11px] text-gray-600">{{ r.created_at }}</span>
          </div>
          <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap line-clamp-3">
            {{ r.result?.slice(0, 600) }}{{ r.result?.length > 600 ? '...' : '' }}
          </div>
          <div v-if="!r.result" class="text-xs text-gray-600">暂无分析内容</div>
        </div>
      </div>
    </div>

    <!-- Result Dialog -->
    <el-dialog v-model="resultDialog" :title="resultTitle" width="750px" destroy-on-close :close-on-click-modal="false">
      <div v-if="resultMeta.length" class="rounded-lg bg-gray-900/50 border border-gray-700/30 p-3 mb-4">
        <div class="flex items-center gap-4 flex-wrap">
          <div v-for="m in resultMeta" :key="m.label" class="flex items-baseline gap-1.5 text-xs">
            <span class="text-gray-500">{{ m.label }}:</span>
            <span class="text-gray-300">{{ m.value }}</span>
          </div>
        </div>
      </div>
      <div class="rounded-lg bg-[#0d1117] border border-gray-700/40 p-4 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap max-h-[500px] overflow-y-auto">
        {{ resultContent || '暂无内容' }}
      </div>
      <template #footer>
        <el-button @click="copyAnalysisResult()">
          <i class="fas fa-copy mr-1"></i>复制文本
        </el-button>
        <el-button @click="resultDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>
