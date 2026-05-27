<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { whisperAPI, aiAPI, crawlerAPI } from '../api'
import { ElMessage } from 'element-plus'

const activeTab = ref('whisper')

const whisperItems = ref<any[]>([])
const selectedWhisperIds = ref<string[]>([])
const transcriptions = ref<any[]>([])

const providers = ref<any[]>([])
const aiResults = ref<any[]>([])
const allTranscriptions = ref<any[]>([])
const selectedModel = ref('deepseek')
const aiPrompt = ref('请对以下文本进行总结，提取关键信息和关键词，用中文回复。')
const temperature = ref(0.7)
const selectedTransIds = ref<string[]>([])

async function refreshAll() {
  const [items, tr, pv, ar] = await Promise.all([
    crawlerAPI.getItems(), whisperAPI.getResults(), aiAPI.getProviders(), aiAPI.getResults(),
  ])
  whisperItems.value = items.data; transcriptions.value = tr.data; providers.value = pv.data; aiResults.value = ar.data
  allTranscriptions.value = tr.data
}

async function startTranscribe() {
  if (!selectedWhisperIds.value.length) { ElMessage.warning('请先选择媒体项'); return }
  const { data } = await whisperAPI.transcribe({ itemIds: selectedWhisperIds.value })
  if (data.error) { ElMessage.error(data.error); return }
  ElMessage.success(`已创建 ${data.tasks.length} 个识别任务`); refreshAll()
}

async function startAnalyze() {
  if (!selectedTransIds.value.length) { ElMessage.warning('请选择要分析的文本'); return }
  const { data } = await aiAPI.analyze({
    config: { provider: selectedModel.value, model: selectedModel.value === 'minimax' ? 'MiniMax-M1' : 'deepseek-chat', prompt: aiPrompt.value, temperature: temperature.value },
    transcriptionIds: selectedTransIds.value,
  })
  if (data.error) { ElMessage.error(data.error); return }
  ElMessage.success(`已创建 ${data.tasks.length} 个分析任务`); refreshAll()
}

onMounted(refreshAll)
</script>

<template>
  <div class="p-6 max-w-[1200px]">
    <h2 class="text-lg font-bold mb-1">AI 分析</h2>
    <p class="text-sm text-gray-500 mb-5">Whisper 语音识别 → 大模型智能分析</p>

    <div class="flex gap-2 mb-5">
      <button v-for="tab in [{ key: 'whisper', label: '语音识别', icon: 'fa-microphone' },{ key: 'ai', label: '大模型分析', icon: 'fa-robot' }]"
        :key="tab.key" @click="activeTab = tab.key"
        class="px-4 py-2 text-sm rounded-lg transition-colors flex items-center gap-2"
        :class="activeTab === tab.key ? 'bg-gray-800 text-gray-100 border border-gray-600' : 'text-gray-400 hover:text-gray-200'">
        <i :class="'fas '+tab.icon+' text-xs'"></i>{{ tab.label }}
      </button>
    </div>

    <!-- WHISPER -->
    <div v-show="activeTab==='whisper'" class="space-y-5">
      <div class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-microphone text-violet-400"></i>选择要识别的媒体</h3>
        <el-table :data="whisperItems" size="small" max-height="300" @selection-change="(rows:any)=>selectedWhisperIds=rows.map((r:any)=>r.id)">
          <el-table-column type="selection" width="40"/>
          <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200"/>
          <el-table-column label="类型" width="120"><template #default="{row}"><span class="text-xs text-gray-400">{{row.media_type||'-'}} / {{row.media_source||'-'}}</span></template></el-table-column>
        </el-table>
        <button class="mt-4 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 flex items-center gap-2" @click="startTranscribe">
          <i class="fas fa-play text-xs"></i>开始识别选中项
        </button>
        <span class="text-xs text-gray-500 ml-3">请确保文件已转为 WAV 格式</span>
      </div>

      <div v-if="transcriptions.length" class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
        <h3 class="text-sm font-semibold mb-4">识别结果 ({{ transcriptions.length }})</h3>
        <div class="space-y-3 max-h-[500px] overflow-y-auto">
          <div v-for="t in transcriptions" :key="t.id" class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/40">
            <div class="flex items-center justify-between mb-2">
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs" :class="t.status==='completed'?'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25':'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25'">
                {{ t.status==='completed'?'完成':'处理中' }}</span>
              <span class="text-[11px] text-gray-600">{{ t.created_at }}</span>
            </div>
            <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{{ t.content?.slice(0,500) }}{{ t.content?.length>500?'...':'' }}</div>
            <div v-if="!t.content" class="text-sm text-gray-600">等待识别结果...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI -->
    <div v-show="activeTab==='ai'" class="space-y-5">
      <div class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-robot text-amber-400"></i>分析配置</h3>
        <div class="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label class="text-xs text-gray-400 mb-1.5 block">模型</label>
            <select v-model="selectedModel" class="w-full px-3 py-2.5 bg-gray-900/70 border border-gray-600/50 rounded-lg text-sm text-gray-100 outline-none focus:border-blue-500/50">
              <option v-for="p in providers" :key="p.name" :value="p.name">{{ p.name==='deepseek'?'DeepSeek':'MiniMax' }}{{p.configured?'':' (未配置)'}}</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1.5 block">Temperature</label>
            <el-input-number v-model="temperature" :min="0" :max="2" :step="0.1" :precision="1" size="small"/>
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1.5 block">可用模型</label>
            <div class="flex gap-2 pt-1.5">
              <span v-for="p in providers.filter((x:any)=>x.configured)" :key="p.name" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">{{ p.name }}</span>
              <span v-if="!providers.filter((x:any)=>x.configured).length" class="text-xs text-red-400">无可用模型</span>
            </div>
          </div>
        </div>
        <div>
          <label class="text-xs text-gray-400 mb-1.5 block">提示词</label>
          <textarea v-model="aiPrompt" class="w-full px-3 py-2.5 bg-gray-900/70 border border-gray-600/50 rounded-lg text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500/50" rows="3" placeholder="输入你的分析提示词..."/>
        </div>
      </div>

      <div class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
        <h3 class="text-sm font-semibold mb-4">选择待分析文本</h3>
        <el-table :data="allTranscriptions" size="small" max-height="250" @selection-change="(rows:any)=>selectedTransIds=rows.map((r:any)=>r.id)">
          <el-table-column type="selection" width="40"/>
          <el-table-column label="文本预览" show-overflow-tooltip min-width="350"><template #default="{row}">{{row.content?.slice(0,120)}}{{row.content?.length>120?'...':''}}</template></el-table-column>
          <el-table-column label="状态" width="80"><template #default="{row}"><span :class="row.status==='completed'?'inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-500/25':'inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-500/15 text-yellow-300 border border-yellow-500/25'">{{row.status==='completed'?'就绪':'处理中'}}</span></template></el-table-column>
        </el-table>
        <button class="mt-4 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 flex items-center gap-2" @click="startAnalyze"><i class="fas fa-play text-xs"></i>开始分析</button>
      </div>

      <div v-if="aiResults.length" class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
        <h3 class="text-sm font-semibold mb-4">分析结果 ({{ aiResults.length }})</h3>
        <div class="space-y-3 max-h-[500px] overflow-y-auto">
          <div v-for="r in aiResults" :key="r.id" class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/40">
            <div class="flex items-center gap-2 mb-2">
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs" :class="r.status==='completed'?'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25':'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25'">{{r.status==='completed'?'完成':'处理中'}}</span>
              <span class="text-[11px] text-gray-500">{{ r.model }}</span>
              <span class="text-[11px] text-gray-600">{{ r.created_at }}</span>
            </div>
            <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{{ r.result?.slice(0,600) }}{{ r.result?.length>600?'...':'' }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
