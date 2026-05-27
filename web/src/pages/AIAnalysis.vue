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

async function refreshAll(){
  const[items,tr,pv,ar]=await Promise.all([crawlerAPI.getItems(),whisperAPI.getResults(),aiAPI.getProviders(),aiAPI.getResults()])
  whisperItems.value=items.data;transcriptions.value=tr.data;providers.value=pv.data;aiResults.value=ar.data;allTranscriptions.value=tr.data
}

async function startTranscribe(){
  if(!selectedWhisperIds.value.length){ElMessage.warning('请先选择媒体项');return}
  const{data}=await whisperAPI.transcribe({itemIds:selectedWhisperIds.value})
  if(data.error){ElMessage.error(data.error);return}
  ElMessage.success(`已创建 ${data.tasks.length} 个识别任务`);refreshAll()
}

async function startAnalyze(){
  if(!selectedTransIds.value.length){ElMessage.warning('请选择要分析的文本');return}
  const{data}=await aiAPI.analyze({config:{provider:selectedModel.value,model:selectedModel.value==='minimax'?'MiniMax-M1':'deepseek-chat',prompt:aiPrompt.value,temperature:temperature.value},transcriptionIds:selectedTransIds.value})
  if(data.error){ElMessage.error(data.error);return}
  ElMessage.success(`已创建 ${data.tasks.length} 个分析任务`);refreshAll()
}

onMounted(refreshAll)
</script>

<template>
  <div style="padding:24px 28px;max-width:1240px">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:4px">AI 分析</h2>
    <p style="font-size:13px;color:#6b7280;margin-bottom:20px">Whisper 语音识别 → 大模型智能分析</p>

    <div style="display:flex;gap:8px;margin-bottom:20px">
      <el-button v-for="tab in [{k:'whisper',l:'语音识别'},{k:'ai',l:'大模型分析'}]" :key="tab.k"
        :type="activeTab===tab.k?'primary':'default'" :plain="activeTab!==tab.k" size="small" @click="activeTab=tab.k">{{tab.l}}</el-button>
    </div>

    <!-- Whisper -->
    <div v-show="activeTab==='whisper'" style="display:flex;flex-direction:column;gap:20px">
      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px"><i class="fas fa-microphone" style="color:#a78bfa"></i>选择要识别的媒体</h3>
        <el-table :data="whisperItems" size="small" max-height="300" @selection-change="(rows:any)=>selectedWhisperIds=rows.map((r:any)=>r.id)">
          <el-table-column type="selection" width="40" />
          <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200" />
          <el-table-column label="类型" width="120"><template #default="{row}"><span style="font-size:12px;color:#9ca3af">{{row.media_type||'-'}} / {{row.media_source||'-'}}</span></template></el-table-column>
        </el-table>
        <div style="margin-top:16px;display:flex;align-items:center;gap:12px">
          <el-button type="primary" @click="startTranscribe"><i class="fas fa-play" style="margin-right:6px"></i>开始识别选中项</el-button>
          <span style="font-size:12px;color:#6b7280">请确保文件已转为 WAV 格式</span>
        </div>
      </div>

      <div v-if="transcriptions.length" style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px">识别结果 ({{transcriptions.length}})</h3>
        <div style="display:flex;flex-direction:column;gap:12px;max-height:500px;overflow-y:auto">
          <div v-for="t in transcriptions" :key="t.id" style="padding:16px;border-radius:8px;background:rgba(13,17,23,0.5);border:1px solid rgba(75,85,99,0.2)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span :style="{
                display:'inline-flex',padding:'2px 8px',borderRadius:'99px',fontSize:'11px',
                background:t.status==='completed'?'rgba(52,211,153,0.15)':'rgba(250,204,21,0.15)',
                color:t.status==='completed'?'#6ee7b7':'#fde047',
              }">{{t.status==='completed'?'完成':'处理中'}}</span>
              <span style="font-size:11px;color:#6b7280">{{t.created_at}}</span>
            </div>
            <div style="font-size:13px;color:#d1d5db;line-height:1.6;white-space:pre-wrap">{{t.content?.slice(0,500)}}{{t.content?.length>500?'...':''}}</div>
            <div v-if="!t.content" style="font-size:13px;color:#6b7280">等待识别结果...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI -->
    <div v-show="activeTab==='ai'" style="display:flex;flex-direction:column;gap:20px">
      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px"><i class="fas fa-robot" style="color:#fbbf24"></i>分析配置</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 200px;gap:16px;margin-bottom:16px">
          <div>
            <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">模型</div>
            <el-select v-model="selectedModel" size="default" style="width:100%">
              <el-option v-for="p in providers" :key="p.name" :value="p.name" :label="p.name==='deepseek'?'DeepSeek':'MiniMax'" />
            </el-select>
          </div>
          <div>
            <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">Temperature</div>
            <el-input-number v-model="temperature" :min="0" :max="2" :step="0.1" :precision="1" size="default" style="width:100%" />
          </div>
          <div>
            <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">可用模型</div>
            <div style="display:flex;gap:8px;padding-top:6px">
              <span v-for="p in providers.filter((x:any)=>x.configured)" :key="p.name" style="display:inline-flex;padding:4px 10px;border-radius:99px;font-size:11px;background:rgba(52,211,153,0.15);color:#6ee7b7;border:1px solid rgba(52,211,153,0.25)">{{p.name}}</span>
              <span v-if="!providers.filter((x:any)=>x.configured).length" style="font-size:12px;color:#f87171">无可用模型</span>
            </div>
          </div>
        </div>
        <div>
          <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">提示词</div>
          <el-input v-model="aiPrompt" type="textarea" :rows="3" placeholder="输入你的分析提示词..." />
        </div>
      </div>

      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px">选择待分析文本</h3>
        <el-table :data="allTranscriptions" size="small" max-height="250" @selection-change="(rows:any)=>selectedTransIds=rows.map((r:any)=>r.id)">
          <el-table-column type="selection" width="40" />
          <el-table-column label="文本预览" show-overflow-tooltip min-width="350"><template #default="{row}">{{row.content?.slice(0,120)}}{{row.content?.length>120?'...':''}}</template></el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{row}"><span style="display:inline-flex;padding:2px 8px;border-radius:99px;font-size:11px" :style="{background:row.status==='completed'?'rgba(52,211,153,0.15)':'rgba(250,204,21,0.15)',color:row.status==='completed'?'#6ee7b7':'#fde047'}">{{row.status==='completed'?'就绪':'处理中'}}</span></template>
          </el-table-column>
        </el-table>
        <el-button type="primary" style="margin-top:16px" @click="startAnalyze"><i class="fas fa-play" style="margin-right:6px"></i>开始分析</el-button>
      </div>

      <div v-if="aiResults.length" style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px">分析结果 ({{aiResults.length}})</h3>
        <div style="display:flex;flex-direction:column;gap:12px;max-height:500px;overflow-y:auto">
          <div v-for="r in aiResults" :key="r.id" style="padding:16px;border-radius:8px;background:rgba(13,17,23,0.5);border:1px solid rgba(75,85,99,0.2)">
            <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
              <span :style="{display:'inline-flex',padding:'2px 8px',borderRadius:'99px',fontSize:'11px',background:r.status==='completed'?'rgba(52,211,153,0.15)':'rgba(250,204,21,0.15)',color:r.status==='completed'?'#6ee7b7':'#fde047'}">{{r.status==='completed'?'完成':'处理中'}}</span>
              <span style="font-size:11px;color:#9ca3af">{{r.model}}</span>
              <span style="font-size:11px;color:#6b7280">{{r.created_at}}</span>
            </div>
            <div style="font-size:13px;color:#d1d5db;line-height:1.6;white-space:pre-wrap">{{r.result?.slice(0,600)}}{{r.result?.length>600?'...':''}}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
