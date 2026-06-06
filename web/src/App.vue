<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

interface NavChild {
  path: string
  label: string
}
interface NavItem {
  path: string
  label: string
  icon: string
  children?: NavChild[]
}

const navItems: NavItem[] = [
  { path: '/', label: '仪表盘', icon: 'House' },
  {
    path: '/crawler', label: '爬虫采集', icon: 'Connection',
    children: [
      { path: '/crawler/tasks', label: '任务列表' },
      { path: '/crawler/items', label: '采集列表' },
    ],
  },
  {
    path: '/media', label: '媒体资源', icon: 'Folder',
    children: [
      { path: '/media/resources', label: '资源管理' },
      { path: '/media/transcode', label: '转码处理' },
    ],
  },
  {
    path: '/ai', label: 'AI 处理', icon: 'Cpu',
    children: [
      { path: '/ai/whisper', label: '文字提取' },
      { path: '/ai/summary', label: '模型总结' },
    ],
  },
  { path: '/export', label: '数据导出', icon: 'DocumentCopy' },
  { path: '/providers', label: '供应商管理', icon: 'Monitor' },
  { path: '/prompts', label: '提示词管理', icon: 'EditPen' },
]

const currentTitle = computed(() => {
  for (const item of navItems) {
    if (item.path === route.path) return item.label
    if (item.children) {
      const child = item.children.find(c => c.path === route.path)
      if (child) return `${item.label} / ${child.label}`
    }
  }
  return ''
})

const activeMenu = computed(() => {
  // For submenu items, return the child path; for top-level, return the path
  for (const item of navItems) {
    if (item.children) {
      const child = item.children.find(c => c.path === route.path)
      if (child) return child.path
    }
  }
  return route.path
})

// Determine which sub-menus should be open
const defaultOpeneds = computed(() => {
  const opens: string[] = []
  for (const item of navItems) {
    if (item.children?.some(c => c.path === route.path)) {
      opens.push(item.path)
    }
  }
  return opens
})
</script>

<template>
  <div class="min-h-screen bg-[#0d1117] text-gray-200 flex">
    <!-- Sidebar -->
    <aside class="w-[220px] flex-shrink-0 flex flex-col sticky top-0 h-screen z-50 bg-[#0a0e14] border-r border-[#1c1f26]">
      <!-- Logo -->
      <div class="px-4 py-4 border-b border-[#1c1f26] flex-shrink-0">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <i class="fas fa-film text-[11px] text-white"></i>
          </div>
          <div class="leading-tight min-w-0">
            <div class="text-[13px] font-bold text-gray-100">Video Analyst</div>
            <div class="text-[10px] text-gray-500 font-mono">v0.1.0</div>
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <el-menu
        :default-active="activeMenu"
        :default-openeds="defaultOpeneds"
        router
        class="flex-1 border-r-0 overflow-y-auto"
        background-color="transparent"
        text-color="#9ca3af"
        active-text-color="#93c5fd"
      >
        <template v-for="item in navItems" :key="item.path">
          <!-- Submenu -->
          <el-sub-menu v-if="item.children" :index="item.path">
            <template #title>
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.label }}</span>
            </template>
            <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path">
              {{ child.label }}
            </el-menu-item>
          </el-sub-menu>

          <!-- Single item -->
          <el-menu-item v-else :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </template>
      </el-menu>

      <!-- Footer -->
      <div class="px-4 py-3 border-t border-[#1c1f26] flex items-center gap-2 text-[11px] text-gray-500 flex-shrink-0">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500/70 flex-shrink-0"></span>
        <span>SQLite</span>
        <span class="text-gray-700">·</span>
        <span>data/</span>
      </div>
    </aside>

    <!-- Main content -->
    <div class="flex-1 min-w-0">
      <header class="h-12 border-b border-[#1c1f26] flex items-center px-7 bg-[#0a0e14]/80 backdrop-blur-md sticky top-0 z-40">
        <h1 class="text-[13px] font-medium text-gray-300">{{ currentTitle }}</h1>
        <div class="flex-1"></div>
      </header>
      <router-view />
    </div>
  </div>
</template>
