<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const navItems = [
  { path: '/', label: '仪表盘', icon: 'fa-house' },
  { path: '/crawler', label: '爬虫采集', icon: 'fa-bug' },
  { path: '/transcoder', label: '转码处理', icon: 'fa-wand-magic-sparkles' },
  { path: '/ai', label: 'AI 分析', icon: 'fa-robot' },
  { path: '/export', label: '数据导出', icon: 'fa-file-excel' },
]
const currentTitle = computed(() => navItems.find(i => i.path === route.path)?.label || '')
</script>

<template>
  <div style="min-height:100vh;background:#0d1117;color:#e5e7eb;display:flex">
    <aside style="width:220px;background:rgba(17,24,39,0.9);border-right:1px solid rgba(75,85,99,0.3);flex-shrink:0;display:flex;flex-direction:column;position:sticky;top:0;height:100vh">
      <div style="padding:20px;border-bottom:1px solid rgba(75,85,99,0.3)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);border-radius:8px;display:flex;align-items:center;justify-content:center">
            <i class="fas fa-film" style="font-size:12px;color:#fff"></i>
          </div>
          <div>
            <div style="font-size:14px;font-weight:600;color:#f3f4f6">Video Analyst</div>
            <div style="font-size:11px;color:#6b7280">v0.1.0</div>
          </div>
        </div>
      </div>
      <nav style="flex:1;padding:12px">
        <router-link v-for="item in navItems" :key="item.path" :to="item.path"
          style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;font-size:13px;text-decoration:none;margin-bottom:2px;transition:all 0.15s"
          :style="route.path === item.path
            ? { background:'rgba(59,130,246,0.15)', color:'#93c5fd', fontWeight:500, border:'1px solid rgba(59,130,246,0.2)' }
            : { color:'#9ca3af' }"
        >
          <i :class="'fas ' + item.icon" style="width:16px;text-align:center;font-size:12px"></i>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
      <div style="padding:16px;border-top:1px solid rgba(75,85,99,0.3);font-size:11px;color:#6b7280">
        <i class="fas fa-server" style="margin-right:4px"></i> data/ · SQLite
      </div>
    </aside>

    <div style="flex:1;min-width:0">
      <header style="height:48px;border-bottom:1px solid rgba(75,85,99,0.3);display:flex;align-items:center;padding:0 28px;background:rgba(17,24,39,0.5);backdrop-filter:blur(8px);position:sticky;top:0;z-index:40">
        <h1 style="font-size:13px;font-weight:600;color:#d1d5db">{{ currentTitle }}</h1>
        <div style="flex:1"></div>
        <span style="font-size:11px;color:#6b7280"><i class="fas fa-circle" style="font-size:5px;color:#10b981;margin-right:4px"></i>运行中</span>
      </header>
      <router-view />
    </div>
  </div>
</template>
