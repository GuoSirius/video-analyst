<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { whisperAPI, aiAPI, crawlerAPI, promptsAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()

const activeTab = ref('whisper')
const whisperItems = ref<any[]>([])
const selectedWhisperIds = ref<string[]>([])
const transcriptions = ref<any[]>([])
const providers = ref<any[]>([])
const prompts = ref<any[]>([])
const aiResults = ref<any[]>([])
const allTranscriptions = ref<any[]>([])
const selectedModel = ref('deepseek')
const selectedPromptId = ref('default')
const aiPrompt = ref('请对以下文本进行总结，提取关键信息和关键词，用中文回复。\n\n{{content}}')
const temperature = ref(0.7)
const whispTemp = ref(0.0)
const whispTempInc = ref(0.2)
const whispModel = ref('base')
const whispFormat = ref('json')
const selectedTransIds = ref<string[]>([])

async function refreshAll(){
  const[items,tr,pv,ar,pr]=await Promise.all([
    crawlerAPI.getItems(),whisperAPI.getResults(),aiAPI.getProviders(),aiAPI.getResults(),promptsAPI.getAll()
  ])
  whisperItems.value=items.data;transcriptions.value=tr.data;providers.value=pv.data;aiResults.value=ar.data
  prompts.value=pr.data
  // Set default prompt
  const def = pr.data.find((p:any)=>p.is_default)
  if (def) { selectedPromptId.value = def.id; aiPrompt.value = def.content }
  allTranscriptions.value=tr.data
}

function onPromptChange(id: string) {
  selectedPromptId.value = id
  const p = prompts.value.find((p:any)=>p.id===id)
  if (p) aiPrompt.value = p.content
}

const enabledProviders = computed(() => providers.value.filter((p: any) => p.enabled))

function ensureProviders(): boolean {
  if (!enabledProviders.value.length) {
    ElMessageBox.alert('尚未配置 AI 模型，请先在"模型管理"页面添加并启用至少一个模型。','无可用模型',{ confirmButtonText: '去配置', type: 'warning', callback: () => router.push('/models') })
    return false
  }
  return true
}

async function startTranscribe(){
  if(!selectedWhisperIds.value.length){ElMessage.warning('请先选择媒体项');return}
  const{data}=await whisperAPI.transcribe({
    itemIds: selectedWhisperIds.value,
    options: {
      model: whispModel.value,
      temperature: whispTemp.value,
      temperature_inc: whispTempInc.value,
      response_format: whispFormat.value,
    }
  })
  if(data.error){ElMessage.error(data.error);return}
  ElMessage.success(`已创建 ${data.tasks.length} 个识别任务`);refreshAll()
}

async function startAnalyze(){
  if(!selectedTransIds.value.length){ElMessage.warning('请选择要分析的文本');return}
  if(!ensureProviders()) return
  const{data}=await aiAPI.analyze({
    config:{prompt:aiPrompt.value,temperature:temperature.value},transcriptionIds:selectedTransIds.value
  })
  if(data.error){ElMessage.error(data.error);return}
  ElMessage.success(`已创建 ${data.tasks.length} 个分析任务`);refreshAll()
}

onMounted(refreshAll)
</script>

<template>
  <div class="px-7 py-6 max-w-[1240px]">
    <h2 class="text-lg font-bold mb-1">AI 分析</h2>
    <p class="text-[13px] text-gray-500 mb-5">Whisper 语音识别 → 大模型智能分析</p>

    <div class="flex gap-2 mb-5">
      <el-button v-for="tab in [{k:'whisper',l:'语音识别'},{k:'ai',l:'大模型分析'}]" :key="tab.k"
        :type="activeTab===tab.k?'primary':'default'" :plain="activeTab!==tab.k" size="small" @click="activeTab=tab.k">{{tab.l}}</el-button>
    </div>

    <!-- Whisper -->
    <div v-show="activeTab==='whisper'" class="space-y-5">
      <div class="card-static">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-microphone text-violet-400"></i>选择要识别的媒体</h3>
        <el-table :data="whisperItems" size="small" max-height="300" @selection-change="(rows:any)=>selectedWhisperIds=rows.map((r:any)=>r.id)">
          <el-table-column type="selection" width="40"/>
          <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200"/>
          <el-table-column label="类型" width="120"><template #default="{row}"><span class="text-xs text-gray-400">{{row.media_type||'-'}} / {{row.media_source||'-'}}</span></template></el-table-column>
        </el-table>
        <div class="mt-4 space-y-3">
          <div class="flex items-center gap-3">
            <el-button type="primary" @click="startTranscribe"><i class="fas fa-play mr-1.5"></i>开始识别选中项</el-button>
            <span class="text-xs text-gray-500">请确保文件已转为 WAV 格式</span>
          </div>
          <details class="text-xs text-gray-500">
            <summary class="cursor-pointer text-gray-400">识别参数</summary>
            <div class="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 ml-4">
              <div class="flex items-center">
                <span class="text-xs text-gray-500 w-28">模型</span>
                <el-select v-model="whispModel" size="small" class="!w-28">
                  <el-option v-for="m in ['tiny','base','small','medium','large']" :key="m" :label="m" :value="m"/>
                </el-select>
                <span class="text-[10px] text-gray-600 ml-2">CLI+API</span>
              </div>
              <div class="flex items-center">
                <span class="text-xs text-gray-500 w-28">输出格式</span>
                <el-select v-model="whispFormat" size="small" class="!w-28">
                  <el-option v-for="f in ['json','text','srt','vtt']" :key="f" :label="f" :value="f"/>
                </el-select>
                <span class="text-[10px] text-gray-600 ml-2">CLI+API</span>
              </div>
              <div class="flex items-center">
                <span class="text-xs text-gray-500 w-28">Temperature</span>
                <el-input-number v-model="whispTemp" :min="0" :max="1" :step="0.1" :precision="1" size="small" class="!w-28"/>
                <span class="text-[10px] text-gray-600 ml-2">仅API</span>
              </div>
              <div class="flex items-center">
                <span class="text-xs text-gray-500 w-28">Temp Inc</span>
                <el-input-number v-model="whispTempInc" :min="0" :max="1" :step="0.1" :precision="1" size="small" class="!w-28"/>
                <span class="text-[10px] text-gray-600 ml-2">仅API</span>
              </div>
            </div>
          </details>
        </div>
      </div>

      <div v-if="transcriptions.length" class="card-static">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold">识别结果 ({{transcriptions.length}})</h3>
          <el-button type="success" size="small" @click="activeTab='ai'; selectedTransIds=transcriptions.filter((t:any)=>t.status==='completed').map((t:any)=>t.id)">
            <i class="fas fa-forward-step mr-1"></i>继续流水线 → AI分析
          </el-button>
        </div>
        <div class="space-y-3 max-h-[500px] overflow-y-auto">
          <div v-for="t in transcriptions" :key="t.id" class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/30">
            <div class="flex items-center justify-between mb-2">
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
                :class="t.status==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/25':'bg-yellow-500/15 text-yellow-300 border-yellow-500/25'">{{t.status==='completed'?'完成':'处理中'}}</span>
              <span class="text-[11px] text-gray-600">{{t.created_at}}</span>
            </div>
            <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{{t.content?.slice(0,500)}}{{t.content?.length>500?'...':''}}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI -->
    <div v-show="activeTab==='ai'" class="space-y-5">
      <div v-if="!enabledProviders.length" class="rounded-xl bg-amber-500/8 border border-amber-500/20 p-4 flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm text-amber-300">
          <i class="fas fa-triangle-exclamation"></i> 尚未配置 AI 模型，AI 分析功能将不可用
        </div>
        <el-button size="small" type="warning" @click="router.push('/models')">去配置模型</el-button>
      </div>

      <div class="card-static">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-robot text-amber-400"></i>分析配置</h3>

        <!-- Provider priority -->
        <div class="mb-4 p-4 rounded-lg bg-gray-900/40 border border-gray-700/30">
          <div class="text-xs text-gray-400 mb-2">模型优先级 (调用顺序：从上到下，失败后自动尝试下一个)</div>
          <div class="space-y-1">
            <div v-for="(p, i) in providers" :key="p.name"
              class="flex items-center gap-3 px-3 py-2 rounded-lg"
              :class="p.configured ? 'bg-gray-800/60 border border-gray-700/40' : 'bg-gray-900/40 border border-gray-700/20 opacity-60'">
              <span class="text-[11px] text-gray-500 w-5 text-center">{{ i + 1 }}</span>
              <span class="text-sm flex-1" :class="p.configured ? 'text-gray-200' : 'text-gray-500'">
                {{ p.name === 'deepseek' ? 'DeepSeek' : 'MiniMax' }}
                <span v-if="!p.configured" class="text-[11px] text-red-400 ml-2">未配置</span>
                <span v-else-if="i === 0 && p.enabled" class="text-[11px] text-emerald-400 ml-2">首选</span>
              </span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div class="text-xs text-gray-400 mb-1.5">提示词模板</div>
            <el-select v-model="selectedPromptId" @change="onPromptChange" class="!w-full">
              <el-option v-for="p in prompts" :key="p.id" :value="p.id" :label="(p.is_default ? '[默认] ' : '') + p.name"/>
            </el-select>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1.5">Temperature</div>
            <el-input-number v-model="temperature" :min="0" :max="2" :step="0.1" :precision="1" class="!w-full"/>
          </div>
        </div>
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs text-gray-400">提示词内容 <code v-pre class="text-gray-600">{{content}}</code> 会被替换为实际文本</span>
            <el-button size="small" type="primary" text @click="router.push('/prompts')"><i class="fas fa-edit mr-1"></i>管理提示词</el-button>
          </div>
          <el-input v-model="aiPrompt" type="textarea" :rows="4" placeholder="输入你的分析提示词..."/>
        </div>
      </div>

      <div class="card-static">
        <h3 class="text-sm font-semibold mb-4">选择待分析文本</h3>
        <el-table :data="allTranscriptions" size="small" max-height="250" @selection-change="(rows:any)=>selectedTransIds=rows.map((r:any)=>r.id)">
          <el-table-column type="selection" width="40"/>
          <el-table-column label="文本预览" show-overflow-tooltip min-width="350"><template #default="{row}">{{row.content?.slice(0,120)}}{{row.content?.length>120?'...':''}}</template></el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{row}"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border" :class="row.status==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/25':'bg-yellow-500/15 text-yellow-300 border-yellow-500/25'">{{row.status==='completed'?'就绪':'处理中'}}</span></template>
          </el-table-column>
        </el-table>
        <el-button type="primary" class="mt-4" @click="startAnalyze"><i class="fas fa-play mr-1.5"></i>开始分析</el-button>
      </div>

      <div v-if="aiResults.length" class="card-static">
        <h3 class="text-sm font-semibold mb-4">分析结果 ({{aiResults.length}})</h3>
        <div class="space-y-3 max-h-[500px] overflow-y-auto">
          <div v-for="r in aiResults" :key="r.id" class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/30">
            <div class="flex items-center gap-2 mb-2">
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border" :class="r.status==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/25':'bg-yellow-500/15 text-yellow-300 border-yellow-500/25'">{{r.status==='completed'?'完成':'处理中'}}</span>
              <span class="text-[11px] text-gray-500">{{r.model}}</span>
              <span class="text-[11px] text-gray-600">{{r.created_at}}</span>
            </div>
            <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{{r.result?.slice(0,600)}}{{r.result?.length>600?'...':''}}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
