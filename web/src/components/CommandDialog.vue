<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { copyWithFeedback } from '@/utils/clipboard'

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

const currentContent = computed(() => props.commands?.[activeTab.value]?.content || '')

function copyMultiLine() {
  if (!currentContent.value) return
  copyWithFeedback(currentContent.value, '已复制多行命令到剪贴板')
}

function copyOneLine() {
  if (!currentContent.value) return
  const cmd = currentContent.value.replace(/ \\\n  /g, ' ')
  copyWithFeedback(cmd, '已复制单行命令到剪贴板')
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title || '查看命令'"
    width="720px"
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

    <!-- Command preview -->
    <div v-if="commands?.length">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-gray-400">等效命令行</span>
        <div class="flex items-center gap-2">
          <el-button size="small" plain @click="copyMultiLine">
            <i class="fas fa-copy mr-1.5"></i>复制多行
          </el-button>
          <el-button size="small" plain @click="copyOneLine">
            <i class="fas fa-copy mr-1.5"></i>复制单行
          </el-button>
        </div>
      </div>
      <div class="rounded-lg bg-[#0d1117] border border-gray-700/40 p-4 font-mono text-xs text-emerald-300 leading-relaxed whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto">
        {{ currentContent || '-' }}
      </div>
      <div class="mt-2 flex items-center gap-1.5 text-[11px] text-gray-600">
        <i class="fas fa-lightbulb text-[10px]"></i>
        复制后在终端执行可复现操作。多行版易阅读，单行版方便直接粘贴。
      </div>
    </div>

    <div v-else-if="loading" class="text-center py-8 text-gray-500 text-sm">加载中...</div>
    <div v-else class="text-center py-8 text-gray-500 text-sm">暂无命令信息</div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>
