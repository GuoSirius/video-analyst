<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { crawlerAPI, transcoderAPI, whisperAPI, aiAPI } from '../api'

const router = useRouter()

interface TaskStats { total: number; running: number; completed: number; failed: number }

const stats = ref<Record<string, TaskStats>>({
  crawler: { total: 0, running: 0, completed: 0, failed: 0 },
  transcoder: { total: 0, running: 0, completed: 0, failed: 0 },
  whisper: { total: 0, running: 0, completed: 0, failed: 0 },
  ai: { total: 0, running: 0, completed: 0, failed: 0 },
})
const recentTasks = ref<any[]>([])
const recentItems = ref<any[]>([])
let timer: any

const runningCount = computed(() =>
  Object.values(stats.value).reduce((sum, s) => sum + s.running, 0)
)

const modules = [
  { key: 'crawler', label: '爬虫采集', desc: '网页内容抓取与媒体链接提取', icon: 'bug', color: 'blue', path: '/crawler' },
  { key: 'transcoder', label: '转码处理', desc: 'FFmpeg 音视频归一化转 WAV', icon: 'wand-magic-sparkles', color: 'emerald', path: '/transcoder' },
  { key: 'whisper', label: '语音识别', desc: 'Whisper 语音转文字', icon: 'microphone', color: 'violet', path: '/ai' },
  { key: 'ai', label: 'AI 分析', desc: '大模型总结、关键词提取', icon: 'robot', color: 'amber', path: '/ai' },
]

const colorMap: Record<string, string> = {
  blue: 'text-blue-400',
  emerald: 'text-emerald-400',
  violet: 'text-violet-400',
  amber: 'text-amber-400',
}

function countByStatus(tasks: any[]) {
  return {
    total: tasks.length,
    running: tasks.filter((t: any) => t.status === 'running').length,
    completed: tasks.filter((t: any) => t.status === 'completed').length,
    failed: tasks.filter((t: any) => t.status === 'failed').length,
  }
}

async function refresh() {
  const [ct, tt, wt, at, items] = await Promise.all([
    crawlerAPI.getTasks(), transcoderAPI.getTasks(), whisperAPI.getTasks(), aiAPI.getTasks(),
    crawlerAPI.getItems(),
  ])
  stats.value.crawler = countByStatus(ct.data)
  stats.value.transcoder = countByStatus(tt.data)
  stats.value.whisper = countByStatus(wt.data)
  stats.value.ai = countByStatus(at.data)

  const allTasks = [...ct.data, ...tt.data, ...wt.data, ...at.data]
  recentTasks.value = allTasks.sort((a: any, b: any) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8)
  recentItems.value = items.data.slice(0, 6)
}

const statusBadge = (status: string) => {
  const map: Record<string, string> = { completed: 'badge-completed', running: 'badge-running', pending: 'badge-pending', failed: 'badge-failed', cancelled: 'badge-cancelled' }
  return map[status] || 'badge-pending'
}

const statusLabel = (status: string) => {
  const map: Record<string, string> = { completed: '已完成', running: '进行中', pending: '等待中', failed: '失败', cancelled: '已取消' }
  return map[status] || status
}

const typeLabel = (type: string) => {
  const map: Record<string, string> = { crawl: '爬虫', transcode: '转码', whisper: '识别', ai: 'AI' }
  return map[type] || type
}

const typeIcon = (type: string) => {
  const map: Record<string, string> = { crawl: 'bug', transcode: 'wand-magic-sparkles', whisper: 'microphone', ai: 'robot' }
  return map[type] || 'circle'
}

onMounted(() => { refresh(); timer = setInterval(refresh, 4000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="page-container">
    <div class="mb-8">
      <h2 class="text-lg font-bold text-gray-100 mb-1">工作台</h2>
      <p class="text-sm text-gray-500">音视频采集 · 转码 · 识别 · 分析一站式处理</p>
    </div>

    <!-- Module cards -->
    <div class="grid grid-cols-4 gap-4 mb-8">
      <div
        v-for="mod in modules" :key="mod.key"
        class="stat-card cursor-pointer group"
        @click="router.push(mod.path)"
      >
        <div class="flex items-start justify-between mb-3">
          <i :class="'fas fa-' + mod.icon + ' text-xl ' + colorMap[mod.color]"></i>
          <span v-if="stats[mod.key].running > 0" class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </div>
        <div class="text-sm font-semibold text-gray-200 mb-1">{{ mod.label }}</div>
        <div class="text-xs text-gray-500 mb-3">{{ mod.desc }}</div>
        <div class="flex items-center gap-3 text-xs">
          <span class="text-gray-400">{{ stats[mod.key].total }} 任务</span>
          <span v-if="stats[mod.key].running" class="text-emerald-400">{{ stats[mod.key].running }} 运行中</span>
          <span v-if="stats[mod.key].failed" class="text-red-400">{{ stats[mod.key].failed }} 失败</span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-5 gap-6">
      <div class="col-span-3 card-static">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <i class="fas fa-clock text-gray-500 text-xs"></i>
            <h3 class="text-sm font-semibold text-gray-200">最新任务</h3>
          </div>
          <span v-if="runningCount" class="text-xs text-emerald-400">{{ runningCount }} 个任务运行中</span>
        </div>
        <div v-if="recentTasks.length === 0" class="text-center py-12 text-gray-500 text-sm">
          暂无任务，从上方模块开始使用
        </div>
        <div v-else class="space-y-1.5">
          <div
            v-for="task in recentTasks" :key="task.id"
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-900/40 hover:bg-gray-900/70 transition-colors"
          >
            <i :class="'fas fa-' + typeIcon(task.type) + ' text-gray-600 text-xs w-3'"></i>
            <span :class="['badge text-[10px] px-1.5 py-0.5', statusBadge(task.status)]">{{ statusLabel(task.status) }}</span>
            <span class="text-xs text-gray-400 truncate flex-1 font-mono">{{ task.id.slice(0, 8) }}</span>
            <div class="flex items-center gap-2 flex-shrink-0">
              <div v-if="task.status === 'running'" class="w-16 bg-gray-700 rounded-full h-1">
                <div class="bg-blue-500 h-1 rounded-full transition-all" :style="{ width: task.progress + '%' }"></div>
              </div>
              <span v-if="task.error" class="text-xs text-red-400 truncate max-w-32">{{ task.error }}</span>
              <span class="text-[11px] text-gray-600 w-16 text-right">{{ task.updated_at?.slice(11, 19) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="col-span-2 card-static">
        <div class="flex items-center gap-2 mb-4">
          <i class="fas fa-list text-gray-500 text-xs"></i>
          <h3 class="text-sm font-semibold text-gray-200">最近采集</h3>
        </div>
        <div v-if="recentItems.length === 0" class="text-center py-12 text-gray-500 text-sm">
          暂无采集数据
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="item in recentItems" :key="item.id"
            class="px-3 py-2.5 rounded-lg bg-gray-900/40 hover:bg-gray-900/70 transition-colors"
          >
            <div class="text-xs text-gray-300 truncate mb-1">{{ item.title || '(无标题)' }}</div>
            <div class="flex items-center gap-2 text-[11px] text-gray-500">
              <span :class="['badge text-[10px] px-1.5 py-0.5', statusBadge(item.status)]">{{ statusLabel(item.status) }}</span>
              <span v-if="item.media_type && item.media_type !== 'unknown'" class="text-gray-600">{{ item.media_type }}</span>
              <span v-if="item.media_source && item.media_source !== 'direct'" class="text-gray-600">{{ item.media_source }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
