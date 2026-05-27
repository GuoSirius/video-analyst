<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { computed, ref, onMounted } from 'vue'
import { settingsAPI } from './api'
import { ElMessage } from 'element-plus'

const route = useRoute()
const autoMode = ref(true)
const navItems = [
  { path: '/', label: '仪表盘', icon: 'fa-house' },
  { path: '/crawler', label: '爬虫采集', icon: 'fa-bug' },
  { path: '/transcoder', label: '转码处理', icon: 'fa-wand-magic-sparkles' },
  { path: '/ai', label: 'AI 分析', icon: 'fa-robot' },
  { path: '/export', label: '数据导出', icon: 'fa-file-excel' },
  { path: '/models', label: '模型管理', icon: 'fa-microchip' },
  { path: '/prompts', label: '提示词管理', icon: 'fa-file-lines' },
]
const currentTitle = computed(() => navItems.find(i => i.path === route.path)?.label || '')

async function loadSettings() {
  try {
    const { data } = await settingsAPI.getPipeline()
    autoMode.value = data.autoMode
  } catch {}
}

async function toggleAuto() {
  try {
    const { data } = await settingsAPI.setPipeline(!autoMode.value)
    autoMode.value = data.autoMode
  } catch { ElMessage.error('设置失败') }
}

onMounted(loadSettings)
</script>

<template>
  <div class="min-h-screen bg-[#0d1117] text-gray-200 flex">
    <aside class="w-[220px] bg-gray-900/90 border-r border-gray-800 flex-shrink-0 flex flex-col sticky top-0 h-screen">
      <div class="px-5 py-5 border-b border-gray-800">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center">
            <i class="fas fa-film text-xs text-white"></i>
          </div>
          <div>
            <div class="text-sm font-semibold text-gray-100">Video Analyst</div>
            <div class="text-[11px] text-gray-500">v0.1.0</div>
          </div>
        </div>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-0.5">
        <router-link v-for="item in navItems" :key="item.path" :to="item.path"
          class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] no-underline transition-all duration-150"
          :class="route.path === item.path
            ? 'bg-blue-500/15 text-blue-300 font-medium border border-blue-500/20'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'"
        >
          <i :class="'fas ' + item.icon + ' w-4 text-center text-xs'"></i>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="px-4 py-4 border-t border-gray-800 text-[11px] text-gray-500">
        <i class="fas fa-server mr-1"></i> data/ · SQLite
      </div>
    </aside>

    <div class="flex-1 min-w-0">
      <header class="h-12 border-b border-gray-800 flex items-center px-7 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-40">
        <h1 class="text-[13px] font-semibold text-gray-300">{{ currentTitle }}</h1>
        <div class="flex-1"></div>
        <div class="flex items-center gap-3">
          <el-tooltip :content="autoMode ? '自动流水线已开启' : '自动流水线已关闭'" placement="bottom">
            <el-switch
              v-model="autoMode"
              size="small"
              @change="toggleAuto"
              active-text="自动"
              inactive-text="手动"
            />
          </el-tooltip>
          <span class="text-[11px] text-gray-500"><i class="fas fa-circle text-[5px] text-emerald-500 mr-1"></i>运行中</span>
        </div>
      </header>
      <router-view />
    </div>
  </div>
</template>
