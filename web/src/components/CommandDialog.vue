<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  modelValue: boolean
  title?: string
  commands?: { label: string; content: string }[]
  details?: { label: string; value: string }[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
}>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, v => { visible.value = v })
watch(visible, v => { emit('update:modelValue', v) })

const activeTab = ref(0)

function copy(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => ElMessage.success('已复制到剪贴板'))
    .catch(() => ElMessage.error('复制失败'))
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title || '查看命令'"
    width="680px"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <!-- Details -->
    <div v-if="details?.length" class="rounded-lg bg-gray-900/50 border border-gray-700/30 p-4 mb-4">
      <div class="grid grid-cols-2 gap-x-6 gap-y-2">
        <div v-for="d in details" :key="d.label" class="flex items-baseline gap-2 text-xs">
          <span class="text-gray-500 flex-shrink-0">{{ d.label }}</span>
          <span class="text-gray-300 truncate font-mono">{{ d.value || '-' }}</span>
        </div>
      </div>
    </div>

    <!-- Tab bar (if multiple commands) -->
    <div v-if="commands && commands.length > 1" class="flex items-center gap-1 mb-3">
      <el-button
        v-for="(cmd, i) in commands"
        :key="i"
        :type="activeTab === i ? 'primary' : 'default'"
        :plain="activeTab !== i"
        size="small"
        @click="activeTab = i"
      >{{ cmd.label }}</el-button>
    </div>

    <!-- Command content -->
    <div
      v-if="commands?.length"
      class="relative rounded-lg bg-[#0d1117] border border-gray-700/40 p-4 font-mono text-xs text-gray-300 leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-[400px] overflow-y-auto"
    >
      {{ commands[activeTab]?.content || '-' }}
      <el-button
        v-if="commands[activeTab]?.content"
        size="small" type="primary" plain
        class="!absolute top-2 right-2"
        @click="copy(commands[activeTab].content)"
      >
        <i class="fas fa-copy mr-1"></i>复制
      </el-button>
    </div>

    <div v-else-if="loading" class="text-center py-8 text-gray-500 text-sm">加载中...</div>
    <div v-else class="text-center py-8 text-gray-500 text-sm">暂无命令信息</div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>
