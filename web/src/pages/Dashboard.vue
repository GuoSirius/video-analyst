<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { crawlerAPI } from '../api'

const router = useRouter()
const stats = ref<Record<string,any>>({
  crawler:{total:0,running:0,completed:0,failed:0},
})
const recentTasks = ref<any[]>([])
const recentItems = ref<any[]>([])
let timer: ReturnType<typeof setInterval> | undefined

const modules = [
  { key:'crawler',label:'爬虫采集',desc:'网页抓取与媒体链接提取',icon:'fa-bug',color:'text-blue-400',path:'/crawler/tasks' },
]

function countByStatus(tasks: any[]) {
  return { total:tasks.length,running:tasks.filter((t:any)=>t.status==='running').length,completed:tasks.filter((t:any)=>t.status==='completed').length,failed:tasks.filter((t:any)=>t.status==='failed').length }
}

async function refresh() {
  const [ct, items] = await Promise.all([
    crawlerAPI.getTasks(),
    crawlerAPI.getItems(),
  ])
  stats.value.crawler = countByStatus(ct.data)
  recentTasks.value = [...ct.data].sort((a: any, b: any) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 10)
  recentItems.value = (items.data?.data || []).slice(0, 6)
}

const runningCount=computed(()=>stats.value.crawler.running)

const taskName = (t: any) => {
  if (t.payload?.name) return t.payload.name
  return t.payload?.url || t.id.slice(0, 8)
}

const taskTypeLabel = (t: string) => {
  const map: Record<string, string> = { crawl: '爬虫' }
  return map[t] || t
}

const statusStyle=(s:string)=>({
  completed:'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  running:'bg-blue-500/15 text-blue-300 border-blue-500/25',
  failed:'bg-red-500/15 text-red-300 border-red-500/25',
  pending:'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
}[s]||'')

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 4000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="px-7 py-6">
    <h2 class="text-lg font-bold mb-1">工作台</h2>
    <p class="text-[13px] text-gray-500 mb-6">网页采集一站式处理：新建爬取任务 · 执行采集 · 查看结果 · 导出数据</p>

    <div class="grid grid-cols-4 gap-4 mb-6">
      <div v-for="m in modules" :key="m.key" @click="router.push(m.path)"
        class="stat-card cursor-pointer border border-transparent hover:border-gray-600/40">
        <div class="flex items-start justify-between mb-3">
          <i :class="'fas '+m.icon+' text-xl '+m.color"></i>
          <span v-if="stats[m.key].running>0" class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </div>
        <div class="text-sm font-semibold text-gray-200 mb-1">{{ m.label }}</div>
        <div class="text-xs text-gray-500 mb-3">{{ m.desc }}</div>
        <div class="flex items-center gap-3 text-xs">
          <span class="text-gray-400">{{ stats[m.key].total }} 任务</span>
          <span v-if="stats[m.key].running" class="text-emerald-400">{{ stats[m.key].running }} 运行中</span>
          <span v-if="stats[m.key].failed" class="text-red-400">{{ stats[m.key].failed }} 失败</span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-4 gap-5">
      <div class="col-span-3 card-static">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold flex items-center gap-2"><i class="fas fa-clock text-gray-500 text-xs"></i>最新任务</h3>
          <span v-if="runningCount" class="text-xs text-emerald-400">{{ runningCount }} 运行中</span>
        </div>
        <div v-if="!recentTasks.length" class="text-center py-12 text-gray-500 text-sm">暂无任务</div>
        <div v-else class="space-y-1">
          <div v-for="t in recentTasks" :key="t.id" class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-900/40">
            <span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] border" :class="statusStyle(t.status)">
              {{ t.status==='completed'?'完成':t.status==='running'?'进行中':t.status==='failed'?'失败':'等待' }}</span>
            <span class="text-xs text-gray-500 w-10">{{ taskTypeLabel(t.type || 'crawl') }}</span>
            <span class="text-xs text-gray-400 truncate flex-1">{{ taskName(t) }}</span>
            <div v-if="t.status==='running'" class="w-16 bg-gray-700 rounded-full h-1"><div class="bg-blue-500 h-1 rounded-full" :style="{width:t.progress+'%'}"></div></div>
            <span class="text-[11px] text-gray-600 w-16 text-right">{{ t.updated_at?.slice(11,19) }}</span>
          </div>
        </div>
      </div>

      <div class="col-span-2 card-static">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-list text-gray-500 text-xs"></i>最近采集</h3>
        <div v-if="!recentItems.length" class="text-center py-12 text-gray-500 text-sm">暂无数据</div>
        <div v-else class="space-y-2">
          <div v-for="item in recentItems" :key="item.id" class="px-3 py-2.5 rounded-lg bg-gray-900/40">
            <div class="text-xs text-gray-300 truncate mb-1">{{ item.title||'(无标题)' }}</div>
            <div class="flex items-center gap-2 text-[11px] text-gray-500">
              <span v-if="item.media_source" class="text-gray-600">{{ item.media_source }}</span>
              <span v-else>-</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
