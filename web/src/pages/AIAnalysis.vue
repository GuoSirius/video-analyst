<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { whisperAPI, aiAPI, crawlerAPI } from '../api'
import { ElMessage } from 'element-plus'

const activeTab = ref('whisper')

// Whisper
const whisperItems = ref<any[]>([])
const selectedWhisperIds = ref<string[]>([])
const whisperTasks = ref<any[]>([])
const transcriptions = ref<any[]>([])

// AI
const providers = ref<any[]>([])
const aiTasks = ref<any[]>([])
const aiResults = ref<any[]>([])
const allTranscriptions = ref<any[]>([])
const selectedModel = ref('deepseek')
const aiPrompt = ref('请对以下文本进行总结，提取关键信息和关键词，用中文回复。')
const temperature = ref(0.7)
const selectedTransIds = ref<string[]>([])

async function refreshAll() {
  const [items, wt, tr, pv, at, ar] = await Promise.all([
    crawlerAPI.getItems(),
    whisperAPI.getTasks(),
    whisperAPI.getResults(),
    aiAPI.getProviders(),
    aiAPI.getTasks(),
    aiAPI.getResults(),
  ])
  whisperItems.value = items.data
  whisperTasks.value = wt.data
  transcriptions.value = tr.data
  providers.value = pv.data
  aiTasks.value = at.data
  aiResults.value = ar.data
  allTranscriptions.value = tr.data
}

async function startTranscribe() {
  if (!selectedWhisperIds.value.length) { ElMessage.warning('请先选择媒体项'); return }
  const { data } = await whisperAPI.transcribe({ itemIds: selectedWhisperIds.value })
  if (data.error) { ElMessage.error(data.error); return }
  ElMessage.success(`已创建 ${data.tasks.length} 个识别任务`)
  refreshAll()
}

async function startAnalyze() {
  if (!selectedTransIds.value.length) { ElMessage.warning('请选择要分析的文本'); return }
  const { data } = await aiAPI.analyze({
    config: {
      provider: selectedModel.value,
      model: selectedModel.value === 'minimax' ? 'MiniMax-M1' : 'deepseek-chat',
      prompt: aiPrompt.value,
      temperature: temperature.value,
    },
    transcriptionIds: selectedTransIds.value,
  })
  if (data.error) { ElMessage.error(data.error); return }
  ElMessage.success(`已创建 ${data.tasks.length} 个分析任务`)
  refreshAll()
}

async function cancelWhisperTask(id: string) { await whisperAPI.cancelTask(id); refreshAll() }
async function cancelAITask(id: string) { await aiAPI.cancelTask(id); refreshAll() }

const whisperComplete = computed(() => transcriptions.value.filter((t: any) => t.status === 'completed').length)
const aiComplete = computed(() => aiResults.value.filter((r: any) => r.status === 'completed').length)

onMounted(refreshAll)
</script>

<template>
  <div class="page-container">
    <div class="mb-6">
      <h2 class="text-lg font-bold text-gray-100 mb-1">AI 分析</h2>
      <p class="text-sm text-gray-500">Whisper 语音识别 → 大模型智能分析 → 结构化输出</p>
    </div>

    <!-- Pipeline indicator -->
    <div class="flex items-center gap-2 mb-6 text-xs text-gray-500">
      <span :class="activeTab === 'whisper' ? 'text-blue-400' : ''">① 语音识别</span>
      <span>→</span>
      <span :class="activeTab === 'ai' ? 'text-amber-400' : ''">② 大模型分析</span>
    </div>

    <div class="flex gap-1 mb-6">
      <button
        v-for="tab in [
          { key: 'whisper', label: `语音识别 (${transcriptions.length})` },
          { key: 'ai', label: `大模型分析 (${aiResults.length})` },
        ]"
        :key="tab.key"
        @click="activeTab = tab.key"
        class="px-4 py-2 text-sm rounded-lg transition-all duration-200"
        :class="activeTab === tab.key
          ? 'bg-gray-800 text-gray-100 font-medium border border-gray-600/50'
          : 'text-gray-500 hover:text-gray-300'"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Whisper Tab -->
    <div v-show="activeTab === 'whisper'" class="space-y-5">
      <div class="card-static">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <span class="text-violet-400 text-sm">◇</span>
            <h3 class="text-sm font-semibold text-gray-200">选择要识别的媒体</h3>
          </div>
          <span class="text-xs text-gray-500">{{ whisperComplete }} 条已完成识别</span>
        </div>

        <el-table
          :data="whisperItems"
          style="width: 100%" size="small" max-height="320"
          @selection-change="(rows: any) => selectedWhisperIds = rows.map((r: any) => r.id)"
        >
          <el-table-column type="selection" width="40" />
          <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200" />
          <el-table-column label="媒体类型" width="100">
            <template #default="{ row }">
              <span class="text-xs text-gray-400">{{ row.media_type || '-' }} / {{ row.media_source || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <span :class="`badge text-[10px] ${row.status === 'completed' ? 'badge-completed' : 'badge-pending'}`">
                {{ row.status === 'completed' ? '就绪' : '待转码' }}
              </span>
            </template>
          </el-table-column>
        </el-table>
        <div class="mt-4 flex items-center gap-3">
          <button class="btn btn-primary" @click="startTranscribe">开始识别选中项</button>
          <span class="text-xs text-gray-500">请确保文件已完成转码（WAV 格式）</span>
        </div>
      </div>

      <!-- Transcription results -->
      <div v-if="transcriptions.length" class="card-static">
        <h3 class="text-sm font-semibold text-gray-200 mb-4">识别结果</h3>
        <div class="space-y-3 max-h-[500px] overflow-y-auto">
          <div v-for="t in transcriptions" :key="t.id" class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/40">
            <div class="flex items-center justify-between mb-2">
              <span :class="`badge text-[10px] ${t.status === 'completed' ? 'badge-completed' : 'badge-pending'}`">
                {{ t.status === 'completed' ? '已完成' : '处理中' }}
              </span>
              <span class="text-[11px] text-gray-600">{{ t.created_at }}</span>
            </div>
            <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{{ t.content?.slice(0, 500) }}{{ t.content?.length > 500 ? '...' : '' }}</div>
            <div v-if="!t.content" class="text-sm text-gray-600">等待识别结果...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Tab -->
    <div v-show="activeTab === 'ai'" class="space-y-5">
      <!-- Config -->
      <div class="card-static">
        <div class="flex items-center gap-2 mb-4">
          <span class="text-amber-400 text-sm">◉</span>
          <h3 class="text-sm font-semibold text-gray-200">分析配置</h3>
        </div>
        <div class="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label class="label">模型</label>
            <select v-model="selectedModel" class="input">
              <option v-for="p in providers" :key="p.name" :value="p.name">
                {{ p.name === 'deepseek' ? 'DeepSeek' : 'MiniMax' }} {{ p.configured ? '' : '(未配置)' }}
              </option>
            </select>
          </div>
          <div>
            <label class="label">Temperature</label>
            <el-input-number v-model="temperature" :min="0" :max="2" :step="0.1" :precision="1" size="small" class="!w-full" />
          </div>
          <div>
            <label class="label">已配置模型</label>
            <div class="flex gap-2 pt-1.5">
              <span v-for="p in providers.filter((x: any) => x.configured)" :key="p.name" class="badge badge-completed text-[10px]">{{ p.name }}</span>
              <span v-if="!providers.filter((x: any) => x.configured).length" class="text-xs text-red-400">无可用模型</span>
            </div>
          </div>
        </div>
        <div>
          <label class="label">提示词</label>
          <textarea v-model="aiPrompt" class="input" rows="4" placeholder="输入你的分析提示词..." />
        </div>
      </div>

      <!-- Select transcriptions -->
      <div class="card-static">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold text-gray-200">选择待分析文本</h3>
          <span class="text-xs text-gray-500">{{ allTranscriptions.filter((t: any) => t.status === 'completed').length }} 条可用</span>
        </div>
        <el-table
          :data="allTranscriptions"
          style="width: 100%" size="small" max-height="280"
          @selection-change="(rows: any) => selectedTransIds = rows.map((r: any) => r.id)"
        >
          <el-table-column type="selection" width="40" />
          <el-table-column label="文本预览" show-overflow-tooltip min-width="350">
            <template #default="{ row }">{{ row.content?.slice(0, 120) }}{{ row.content?.length > 120 ? '...' : '' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <span :class="`badge text-[10px] ${row.status === 'completed' ? 'badge-completed' : 'badge-pending'}`">
                {{ row.status === 'completed' ? '就绪' : '处理中' }}
              </span>
            </template>
          </el-table-column>
        </el-table>
        <button class="btn btn-primary mt-4" @click="startAnalyze">开始分析</button>
      </div>

      <!-- AI Results -->
      <div v-if="aiResults.length" class="card-static">
        <h3 class="text-sm font-semibold text-gray-200 mb-4">分析结果 ({{ aiComplete }})</h3>
        <div class="space-y-3 max-h-[500px] overflow-y-auto">
          <div v-for="r in aiResults" :key="r.id" class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/40">
            <div class="flex items-center gap-2 mb-2">
              <span :class="`badge text-[10px] ${r.status === 'completed' ? 'badge-completed' : 'badge-pending'}`">
                {{ r.status === 'completed' ? '完成' : '处理中' }}
              </span>
              <span class="text-[11px] text-gray-500">{{ r.model }}</span>
              <span class="text-[11px] text-gray-600">{{ r.created_at }}</span>
            </div>
            <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{{ r.result?.slice(0, 600) }}{{ r.result?.length > 600 ? '...' : '' }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
