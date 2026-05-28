<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { promptsAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

interface Prompt {
  id: string; name: string; content: string; is_default: number
}

const prompts = ref<Prompt[]>([])
const dialogVisible = ref(false)
const editing = ref<Partial<Prompt>>({})
const isNew = ref(true)

async function load() { const { data } = await promptsAPI.getAll(); prompts.value = data }

function openNew() {
  isNew.value = true
  editing.value = { name: '', content: '请对以下文本进行总结，提取关键信息和关键词，用中文回复。\n\n{{content}}', is_default: 0 }
  dialogVisible.value = true
}

function openEdit(p: Prompt) {
  isNew.value = false
  editing.value = { ...p }
  dialogVisible.value = true
}

async function save() {
  if (!editing.value.name?.trim()) { ElMessage.warning('请输入提示词名称'); return }
  await promptsAPI.save({ ...editing.value, id: isNew.value ? undefined : editing.value.id })
  dialogVisible.value = false
  ElMessage.success(isNew.value ? '已添加' : '已更新')
  load()
}

async function remove(p: Prompt) {
  try {
    await ElMessageBox.confirm(`确定删除 "${p.name}"？`, '确认删除', { type: 'warning' })
    await promptsAPI.remove(p.id)
    ElMessage.success('已删除')
    load()
  } catch {}
}

onMounted(load)
</script>

<template>
  <div class="px-7 py-6">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">提示词管理</h2>
        <p class="text-[13px] text-gray-500">管理 AI 分析提示词模板，使用 <code v-pre class="text-gray-400 bg-gray-800 px-1 rounded">{{content}}</code> 作为文本占位符</p>
      </div>
      <el-button type="primary" @click="openNew"><i class="fas fa-plus mr-1.5"></i>添加提示词</el-button>
    </div>

    <div class="card-static">
      <el-table v-if="prompts.length" :data="prompts" size="small">
        <el-table-column label="名称" min-width="140">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <span class="text-sm" :class="row.is_default ? 'text-amber-300 font-medium' : 'text-gray-200'">{{ row.name }}</span>
              <span v-if="row.is_default" class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25">默认</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="提示词内容" min-width="350" show-overflow-tooltip>
          <template #default="{ row }"><span class="text-xs text-gray-400 whitespace-pre-wrap">{{ row.content?.slice(0, 120) }}{{ row.content?.length > 120 ? '...' : '' }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="center">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="remove(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-file-lines text-3xl mb-3 block opacity-30"></i>暂无提示词
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="isNew ? '添加提示词' : '编辑提示词'" width="560px" destroy-on-close>
      <div class="space-y-4">
        <div>
          <div class="text-xs text-gray-400 mb-1.5">名称</div>
          <el-input v-model="editing.name" placeholder="例如: 通用总结、提取关键词" />
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">提示词内容</div>
          <el-input v-model="editing.content" type="textarea" :rows="6" placeholder="输入提示词模板..." />
        </div>
        <div class="flex items-center gap-3">
          <el-checkbox v-model="editing.is_default" :true-value="1" :false-value="0" size="small">设为默认提示词</el-checkbox>
          <span class="text-[11px] text-gray-500">模板变量 <code v-pre class="text-gray-400 bg-gray-800 px-1 rounded">{{content}}</code> 会被替换为实际文本</span>
        </div>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
