<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { aiAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

interface Provider {
  id: string; name: string; api_key: string
  base_url: string; default_model: string
  priority: number; enabled: number
}

const providers = ref<Provider[]>([])
const dialogVisible = ref(false)
const editing = ref<Partial<Provider>>({})
const isNew = ref(true)

async function load() {
  const { data } = await aiAPI.getProviders()
  providers.value = data
}

function openNew() {
  isNew.value = true
  editing.value = { name: '', api_key: '', base_url: '', default_model: '', priority: providers.value.length + 1, enabled: 1 }
  dialogVisible.value = true
}

async function openEdit(p: Provider) {
  isNew.value = false
  editing.value = { ...p, api_key: '' }
  dialogVisible.value = true
  // 加载完整 Key
  try {
    const { data } = await aiAPI.getProviderKey(p.id)
    editing.value.api_key = data.key
  } catch {}
}

async function save() {
  const p = editing.value
  if (!p.name?.trim()) { ElMessage.warning('请输入模型名称'); return }
  try {
    if (isNew.value) {
      await aiAPI.createProvider(p)
    } else {
      await aiAPI.updateProvider(p.id!, p)
    }
    dialogVisible.value = false
    ElMessage.success(isNew.value ? '已添加' : '已更新')
    load()
  } catch { ElMessage.error('保存失败') }
}

async function remove(p: Provider) {
  try {
    await ElMessageBox.confirm(`确定删除 "${p.name}"？`, '确认删除', { type: 'warning' })
    await aiAPI.deleteProvider(p.id)
    ElMessage.success('已删除')
    load()
  } catch {}
}

async function moveUp(i: number) {
  if (i === 0) return
  const ids = providers.value.map(p => p.id)
  ;[ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]
  await aiAPI.setPriority(ids)
  load()
}

async function moveDown(i: number) {
  if (i === providers.value.length - 1) return
  const ids = providers.value.map(p => p.id)
  ;[ids[i], ids[i + 1]] = [ids[i + 1], ids[i]]
  await aiAPI.setPriority(ids)
  load()
}

async function toggleEnabled(p: Provider) {
  await aiAPI.updateProvider(p.id, { ...p, enabled: p.enabled ? 0 : 1 })
  load()
}

onMounted(load)

const modelOptions = computed(() => {
  const base = ['deepseek-chat','deepseek-reasoner','gpt-4o','gpt-4o-mini','claude-3-opus','claude-3-sonnet','gemini-pro','qwen-turbo','qwen-plus','glm-4','moonshot-v1','MiniMax-M1','abab6.5s-chat']
  if (editing.value.name === 'deepseek') return ['deepseek-chat','deepseek-reasoner',...base]
  if (editing.value.name === 'minimax') return ['MiniMax-M1','abab6.5s-chat',...base]
  return base
})
</script>

<template>
  <div class="px-7 py-6 max-w-[1100px]">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">模型管理</h2>
        <p class="text-[13px] text-gray-500">管理 AI 大模型接入和调用优先级</p>
      </div>
      <el-button type="primary" @click="openNew"><i class="fas fa-plus mr-1.5"></i>添加模型</el-button>
    </div>

    <div class="card-static">
      <div class="text-xs text-gray-500 mb-4 flex items-center gap-2">
        <i class="fas fa-circle-info text-blue-400"></i>
        按优先级依次调用，排在首位的为首选模型。调用失败时自动 fallback 到下一个已启用的模型。
      </div>

      <el-table v-if="providers.length" :data="providers" size="small">
        <el-table-column label="优先级" width="80" align="center">
          <template #default="{ row, $index }">
            <div class="flex flex-col items-center gap-1">
              <span class="text-xs font-bold" :class="row.enabled ? 'text-blue-300' : 'text-gray-600'">#{{ $index + 1 }}</span>
              <div class="flex gap-1">
                <el-button size="small" circle :disabled="$index === 0" @click="moveUp($index)">
                  <i class="fas fa-chevron-up text-[10px]"></i>
                </el-button>
                <el-button size="small" circle :disabled="$index === providers.length - 1" @click="moveDown($index)">
                  <i class="fas fa-chevron-down text-[10px]"></i>
                </el-button>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="名称" min-width="120">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium" :class="row.enabled ? 'text-gray-200' : 'text-gray-500 line-through'">{{ row.name }}</span>
              <el-switch :model-value="!!row.enabled" size="small" @change="toggleEnabled(row)" />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="API Key" min-width="180" show-overflow-tooltip>
          <template #default="{ row }"><span class="text-xs font-mono text-gray-400">{{ row.api_key?.slice(0, 16) }}{{ row.api_key?.length > 16 ? '...' : '' }}</span></template>
        </el-table-column>
        <el-table-column label="Base URL" min-width="180" show-overflow-tooltip>
          <template #default="{ row }"><span class="text-xs text-gray-400">{{ row.base_url }}</span></template>
        </el-table-column>
        <el-table-column label="默认模型" width="140">
          <template #default="{ row }"><span class="text-xs text-gray-400">{{ row.default_model }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="remove(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-else class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-robot text-3xl mb-3 block opacity-30"></i>
        暂无模型，点击"添加模型"开始配置
      </div>
    </div>

    <!-- Dialog -->
    <el-dialog v-model="dialogVisible" :title="isNew ? '添加模型' : '编辑模型'" width="520px" destroy-on-close>
      <div class="space-y-4">
        <div>
          <div class="text-xs text-gray-400 mb-1.5">名称</div>
          <el-select v-model="editing.name" filterable allow-create placeholder="选择或输入模型名" class="!w-full">
            <el-option v-for="n in ['deepseek','minimax','openai','qwen','glm','moonshot','baichuan','gemini','claude']" :key="n" :label="n" :value="n" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">API Key</div>
          <el-input v-model="editing.api_key" placeholder="sk-..." show-password />
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">Base URL</div>
          <el-input v-model="editing.base_url" placeholder="https://api.example.com/v1" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-gray-400 mb-1.5">默认模型名</div>
            <el-select v-model="editing.default_model" filterable allow-create placeholder="选择或输入" class="!w-full">
              <el-option v-for="n in modelOptions" :key="n" :label="n" :value="n" />
            </el-select>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1.5">启用</div>
            <el-switch v-model="editing.enabled" :active-value="1" :inactive-value="0" class="mt-2" />
          </div>
        </div>
        <div class="text-[11px] text-gray-500 bg-blue-500/5 border border-blue-500/15 rounded-lg p-3">
          <i class="fas fa-circle-info mr-1"></i> 调用流程：按列表从上到下依次尝试，当前模型失败或未启用则自动尝试下一个。
        </div>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
