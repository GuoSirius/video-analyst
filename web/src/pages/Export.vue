<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { exportAPI, crawlerAPI, whisperAPI, aiAPI } from '../api'
import { ElMessage } from 'element-plus'

const columns = ref<string[]>([])
const selectedColumns = ref<string[]>([
  'title', 'source_url', 'media_url', 'media_type', 'media_source', 'transcription', 'ai_result',
])
const items = ref<any[]>([])
const selectedItemIds = ref<string[]>([])
const exporting = ref(false)
const activeTab = ref('export')

const columnLabels: Record<string, string> = {
  id: 'ID',
  title: '标题',
  source_url: '来源 URL',
  media_url: '媒体 URL',
  media_type: '媒体类型',
  media_source: '媒体来源',
  transcription: '识别文本',
  language: '语言',
  duration: '时长',
  ai_result: 'AI 分析结果',
  ai_model: 'AI 模型',
  ai_prompt: '分析提示词',
}

async function refresh() {
  const [colRes, itemRes] = await Promise.all([
    exportAPI.getColumns(),
    crawlerAPI.getItems(),
  ])
  columns.value = colRes.data
  items.value = itemRes.data
}

async function doExport() {
  exporting.value = true
  try {
    const { data } = await exportAPI.exportExcel({
      columns: selectedColumns.value,
      itemIds: selectedItemIds.value.length ? selectedItemIds.value : undefined,
      includeTranscriptions: true,
      includeAIResults: true,
    })
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败')
  }
  exporting.value = false
}

const selectedCount = computed(() => selectedItemIds.value.length || items.value.length)

onMounted(refresh)
</script>

<template>
  <div class="page-container">
    <div class="mb-6">
      <h2 class="text-lg font-bold text-gray-100 mb-1">数据导出</h2>
      <p class="text-sm text-gray-500">自定义字段和范围，导出 Excel 结构化数据</p>
    </div>

    <div class="flex gap-1 mb-6">
      <button
        v-for="tab in [
          { key: 'export', label: '导出配置' },
          { key: 'preview', label: '数据预览' },
        ]"
        :key="tab.key"
        @click="activeTab = tab.key"
        class="px-4 py-2 text-sm rounded-lg transition-all duration-200"
        :class="activeTab === tab.key
          ? 'bg-gray-800 text-gray-100 font-medium border border-gray-600/50'
          : 'text-gray-500 hover:text-gray-300'"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-show="activeTab === 'export'" class="space-y-5">
      <!-- Columns -->
      <div class="card-static">
        <div class="flex items-center gap-2 mb-4">
          <span class="text-blue-400 text-sm">◆</span>
          <h3 class="text-sm font-semibold text-gray-200">导出字段</h3>
          <span class="text-xs text-gray-500 ml-auto">{{ selectedColumns.length }} / {{ columns.length }}</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="col in columns"
            :key="col"
            @click="selectedColumns.includes(col)
              ? selectedColumns = selectedColumns.filter(c => c !== col)
              : selectedColumns.push(col)"
            class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200 border"
            :class="selectedColumns.includes(col)
              ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
              : 'bg-gray-900/40 text-gray-500 border-gray-700/40 hover:border-gray-600/50'"
          >
            {{ columnLabels[col] || col }}
          </button>
        </div>
      </div>

      <!-- Select items -->
      <div class="card-static">
        <div class="flex items-center gap-2 mb-4">
          <span class="text-amber-400 text-sm">◈</span>
          <h3 class="text-sm font-semibold text-gray-200">选择数据范围</h3>
          <span class="text-xs text-gray-500 ml-auto">留空导出全部</span>
        </div>
        <el-table
          :data="items"
          style="width: 100%" size="small" max-height="300"
          @selection-change="(rows: any) => selectedItemIds = rows.map((r: any) => r.id)"
        >
          <el-table-column type="selection" width="40" />
          <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200" />
          <el-table-column label="类型" width="80">
            <template #default="{ row }">
              <span class="text-xs text-gray-400">{{ row.media_type || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="90">
            <template #default="{ row }">
              <span class="text-xs text-gray-400">{{ row.media_source || '-' }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="flex items-center gap-4">
        <button class="btn btn-primary" :disabled="exporting || !selectedColumns.length" @click="doExport">
          {{ exporting ? '导出中...' : `导出 Excel (${selectedCount} 条)` }}
        </button>
        <span class="text-xs text-gray-500">默认格式 .xlsx，保存至 data/exports/</span>
      </div>
    </div>

    <!-- Preview -->
    <div v-show="activeTab === 'preview'" class="card-static">
      <h3 class="text-sm font-semibold text-gray-200 mb-4">数据预览</h3>
      <el-table v-if="items.length" :data="items" style="width: 100%" size="small" max-height="500">
        <el-table-column
          v-for="col in selectedColumns"
          :key="col"
          :prop="col"
          :label="columnLabels[col] || col"
          show-overflow-tooltip
          min-width="160"
        />
      </el-table>
      <div v-else class="text-center py-16 text-gray-500 text-sm">
        <div class="text-3xl mb-3">◉</div>
        暂无数据可预览
      </div>
    </div>
  </div>
</template>
