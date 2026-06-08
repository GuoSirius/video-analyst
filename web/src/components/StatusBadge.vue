<script setup lang="ts">
defineProps<{
  status: string
  labels?: Record<string, string>
}>()

const defaultLabels: Record<string, string> = {
  pending: '待处理',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}
</script>

<template>
  <span
    class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
    :class="{
      'bg-emerald-500/15 text-emerald-300 border-emerald-500/25': status === 'completed',
      'bg-blue-500/15 text-blue-300 border-blue-500/25': status === 'running',
      'bg-red-500/15 text-red-300 border-red-500/25': status === 'failed',
      'bg-gray-500/15 text-gray-400 border-gray-500/25': status === 'cancelled',
      'bg-yellow-500/15 text-yellow-300 border-yellow-500/25': status === 'paused',
      'bg-purple-500/15 text-purple-300 border-purple-500/25': status === 'pending',
    }"
  >
    {{ labels?.[status] || defaultLabels[status] || status }}
  </span>
</template>
