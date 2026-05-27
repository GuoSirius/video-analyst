<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { crawlerAPI, transcoderAPI, whisperAPI, aiAPI } from '../api'

const router = useRouter()
const stats = ref<Record<string,any>>({
  crawler:{total:0,running:0,completed:0,failed:0},
  transcoder:{total:0,running:0,completed:0,failed:0},
  whisper:{total:0,running:0,completed:0,failed:0},
  ai:{total:0,running:0,completed:0,failed:0},
})
const recentTasks = ref<any[]>([])
const recentItems = ref<any[]>([])
let timer: any

const modules = [
  { key:'crawler', label:'爬虫采集', desc:'网页抓取与媒体链接提取', icon:'fa-bug', color:'#60a5fa', path:'/crawler' },
  { key:'transcoder', label:'转码处理', desc:'FFmpeg 归一化转 WAV', icon:'fa-wand-magic-sparkles', color:'#34d399', path:'/transcoder' },
  { key:'whisper', label:'语音识别', desc:'Whisper 语音转文字', icon:'fa-microphone', color:'#a78bfa', path:'/ai' },
  { key:'ai', label:'AI 分析', desc:'大模型总结与关键词提取', icon:'fa-robot', color:'#fbbf24', path:'/ai' },
]

function countByStatus(tasks: any[]) {
  return { total:tasks.length, running:tasks.filter((t:any)=>t.status==='running').length, completed:tasks.filter((t:any)=>t.status==='completed').length, failed:tasks.filter((t:any)=>t.status==='failed').length }
}

async function refresh() {
  const [ct,tt,wt,at,items] = await Promise.all([crawlerAPI.getTasks(),transcoderAPI.getTasks(),whisperAPI.getTasks(),aiAPI.getTasks(),crawlerAPI.getItems()])
  stats.value.crawler=countByStatus(ct.data); stats.value.transcoder=countByStatus(tt.data); stats.value.whisper=countByStatus(wt.data); stats.value.ai=countByStatus(at.data)
  const all=[...ct.data,...tt.data,...wt.data,...at.data]
  recentTasks.value=all.sort((a:any,b:any)=>b.updated_at.localeCompare(a.updated_at)).slice(0,8)
  recentItems.value=items.data.slice(0,6)
}

const runningCount = computed(()=>Object.values(stats.value).reduce((s:any,v:any)=>s+v.running,0))

onMounted(()=>{refresh();timer=setInterval(refresh,4000)})
onUnmounted(()=>clearInterval(timer))
</script>

<template>
  <div style="padding:24px 28px;max-width:1240px">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:4px">工作台</h2>
    <p style="font-size:13px;color:#6b7280;margin-bottom:24px">音视频采集 · 转码 · 识别 · 分析一站式处理</p>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
      <div v-for="m in modules" :key="m.key" @click="router.push(m.path)"
        style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:20px;cursor:pointer;transition:border-color 0.2s">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <i :class="'fas '+m.icon" :style="{fontSize:'20px',color:m.color}"></i>
          <span v-if="stats[m.key].running>0" style="display:inline-flex;height:8px;width:8px;position:relative">
            <span style="animation:ping 1s cubic-bezier(0,0,0.2,1) infinite;position:absolute;width:100%;height:100%;border-radius:50%;background:#34d399;opacity:0.75"></span>
            <span style="display:inline-flex;width:8px;height:8px;border-radius:50%;background:#10b981"></span>
          </span>
        </div>
        <div style="font-size:14px;font-weight:600;color:#e5e7eb;margin-bottom:4px">{{m.label}}</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:12px">{{m.desc}}</div>
        <div style="display:flex;gap:12px;font-size:12px">
          <span style="color:#9ca3af">{{stats[m.key].total}} 任务</span>
          <span v-if="stats[m.key].running" style="color:#34d399">{{stats[m.key].running}} 运行中</span>
          <span v-if="stats[m.key].failed" style="color:#f87171">{{stats[m.key].failed}} 失败</span>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:3fr 2fr;gap:20px">
      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px"><i class="fas fa-clock" style="color:#6b7280;font-size:12px"></i>最新任务</h3>
          <span v-if="runningCount" style="font-size:12px;color:#34d399">{{runningCount}} 运行中</span>
        </div>
        <div v-if="!recentTasks.length" style="text-align:center;padding:40px 0;color:#6b7280;font-size:13px">暂无任务</div>
        <div v-else style="display:flex;flex-direction:column;gap:4px">
          <div v-for="t in recentTasks" :key="t.id"
            style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;background:rgba(13,17,23,0.5)">
            <span :style="{
              display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:'99px',fontSize:'10px',
              background: t.status==='completed'?'rgba(52,211,153,0.15)':t.status==='running'?'rgba(59,130,246,0.15)':t.status==='failed'?'rgba(248,113,113,0.15)':'rgba(250,204,21,0.15)',
              color: t.status==='completed'?'#6ee7b7':t.status==='running'?'#93c5fd':t.status==='failed'?'#fca5a5':'#fde047',
              border: `1px solid ${t.status==='completed'?'rgba(52,211,153,0.25)':t.status==='running'?'rgba(59,130,246,0.25)':t.status==='failed'?'rgba(248,113,113,0.25)':'rgba(250,204,21,0.25)'}`,
            }">{{t.status==='completed'?'完成':t.status==='running'?'进行中':t.status==='failed'?'失败':'等待'}}</span>
            <span style="font-size:12px;color:#6b7280;width:36px">{{t.type==='crawl'?'爬虫':t.type==='transcode'?'转码':t.type==='whisper'?'识别':'AI'}}</span>
            <span style="font-size:12px;color:#9ca3af;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace">{{t.id.slice(0,8)}}</span>
            <div v-if="t.status==='running'" style="width:64px;height:4px;background:rgba(55,65,81,0.6);border-radius:99px"><div style="height:4px;background:#3b82f6;border-radius:99px" :style="{width:t.progress+'%'}"></div></div>
            <span style="font-size:11px;color:#6b7280;width:56px;text-align:right">{{t.updated_at?.slice(11,19)}}</span>
          </div>
        </div>
      </div>

      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:20px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px"><i class="fas fa-list" style="color:#6b7280;font-size:12px"></i>最近采集</h3>
        <div v-if="!recentItems.length" style="text-align:center;padding:40px 0;color:#6b7280;font-size:13px">暂无数据</div>
        <div v-else style="display:flex;flex-direction:column;gap:8px">
          <div v-for="item in recentItems" :key="item.id" style="padding:10px 12px;border-radius:8px;background:rgba(13,17,23,0.5)">
            <div style="font-size:12px;color:#d1d5db;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px">{{item.title||'(无标题)'}}</div>
            <div style="display:flex;gap:8px;font-size:11px;color:#6b7280"><span>{{item.media_type||'-'}}</span><span v-if="item.media_source&&item.media_source!=='direct'">{{item.media_source}}</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
