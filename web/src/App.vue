<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

const navItems = [
  { path: '/', label: '仪表盘', icon: 'house' },
  { path: '/crawler', label: '爬虫采集', icon: 'bug' },
  { path: '/transcoder', label: '转码处理', icon: 'wand-magic-sparkles' },
  { path: '/ai', label: 'AI 分析', icon: 'robot' },
  { path: '/export', label: '数据导出', icon: 'file-excel' },
]

const currentTitle = computed(() => navItems.find(i => i.path === route.path)?.label || '')
</script>

<template>
  <div class="min-h-screen bg-[#0d1117] text-gray-100 flex">
    <!-- Sidebar -->
    <aside class="w-56 bg-gray-900/80 border-r border-gray-800 flex-shrink-0 flex flex-col sticky top-0 h-screen">
      <div class="px-5 py-5 border-b border-gray-800">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            <i class="fas fa-film text-xs"></i>
          </div>
          <div>
            <div class="text-sm font-semibold text-gray-100">Video Analyst</div>
            <div class="text-[11px] text-gray-500">v0.1.0</div>
          </div>
        </div>
      </div>

      <nav class="flex-1 px-3 py-4 space-y-0.5">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 group"
          :class="route.path === item.path
            ? 'bg-blue-600/20 text-blue-300 font-medium border border-blue-500/20'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'"
        >
          <i :class="'fas fa-' + item.icon + ' w-4 text-center flex-shrink-0'"></i>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="px-4 py-4 border-t border-gray-800">
        <div class="text-[11px] text-gray-500 leading-relaxed">
          <i class="fas fa-server mr-1"></i> 数据目录 <code class="text-gray-600 bg-gray-800 px-1 rounded">data/</code><br/>
          SQLite · 零依赖 · 本地存储
        </div>
      </div>
    </aside>

    <!-- Main -->
    <div class="flex-1 min-w-0">
      <header class="h-14 border-b border-gray-800 flex items-center px-8 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-40">
        <h1 class="text-sm font-semibold text-gray-300">{{ currentTitle }}</h1>
        <div class="flex-1" />
        <div class="flex items-center gap-3 text-[11px] text-gray-500">
          <span class="flex items-center gap-1"><i class="fas fa-circle text-[6px] text-emerald-500"></i> 系统运行中</span>
        </div>
      </header>
      <router-view />
    </div>
  </div>
</template>
