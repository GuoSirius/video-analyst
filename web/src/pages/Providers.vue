<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { aiAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

interface Provider {
  id: string; name: string; api_key: string
  base_url: string; models: { name: string; role: string }[]
  priority: number; enabled: number
}

const providers = ref<Provider[]>([])
const dialogVisible = ref(false)
const editing = ref<Partial<Provider>>({})
const isNew = ref(true)
const fetchingModels = ref(false)
const availableModels = ref<string[]>([])
const selectedDefault = ref('')
const selectedFallback = ref('')

async function load() {
  const { data } = await aiAPI.getProviders()
  providers.value = data
}

function openNew() {
  isNew.value = true
  editing.value = { name: '', api_key: '', base_url: '', models: [], priority: providers.value.length + 1, enabled: 1 }
  availableModels.value = []
  selectedDefault.value = ''
  selectedFallback.value = ''
  dialogVisible.value = true
}

async function openEdit(p: Provider) {
  isNew.value = false
  editing.value = { ...p, models: (p.models || []).map(m => ({ ...m })), api_key: '' }
  selectedDefault.value = (p.models || []).find(m => m.role === 'default')?.name || ''
  selectedFallback.value = (p.models || []).find(m => m.role === 'fallback')?.name || ''
  availableModels.value = []
  dialogVisible.value = true
  try {
    const { data } = await aiAPI.getProviderKey(p.id)
    editing.value.api_key = data.key
  } catch {}
  if (editing.value.base_url && editing.value.api_key) {
    fetchModelsFromProvider()
  }
}

async function save() {
  const p = editing.value
  if (!p.name?.trim()) { ElMessage.warning('请输入供应商名称'); return }

  const models: { name: string; role: string }[] = []
  if (selectedDefault.value) models.push({ name: selectedDefault.value, role: 'default' })
  if (selectedFallback.value) models.push({ name: selectedFallback.value, role: 'fallback' })

  const payload = { ...p, models }

  try {
    if (isNew.value) {
      await aiAPI.createProvider(payload)
    } else {
      await aiAPI.updateProvider(p.id!, payload)
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

async function fetchModelsFromProvider() {
  const base_url = editing.value.base_url
  const api_key = editing.value.api_key
  if (!base_url || !api_key) return
  fetchingModels.value = true
  try {
    const { data } = await aiAPI.fetchModels({ base_url, api_key })
    if (data.error) {
      ElMessage.error(data.error)
      availableModels.value = []
    } else {
      availableModels.value = data as string[]
      if (!availableModels.value.length) {
        ElMessage.warning('未获取到模型列表')
      }
    }
  } catch (err: any) {
    ElMessage.error(err.message || '获取模型列表失败')
    availableModels.value = []
  } finally {
    fetchingModels.value = false
  }
}

function getModelDisplay(p: Provider) {
  const defaultM = (p.models || []).find(m => m.role === 'default')?.name || '-'
  const fallbackM = (p.models || []).find(m => m.role === 'fallback')?.name
  return fallbackM ? `${defaultM} → ${fallbackM}` : defaultM
}
</script>

<template>
  <div class="px-7 py-6">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">供应商管理</h2>
        <p class="text-[13px] text-gray-500">管理 AI 供应商接入和调用优先级</p>
      </div>
      <el-button type="primary" @click="openNew"><i class="fas fa-plus mr-1.5"></i>添加供应商</el-button>
    </div>

    <div class="card-static">
      <div class="text-xs text-gray-500 mb-4 flex items-center gap-2">
        <i class="fas fa-circle-info text-blue-400"></i>
        按优先级依次调用。单个供应商内优先使用默认模型，失败后尝试回退模型，依然失败则切换到下一个供应商。
      </div>

      <el-table v-if="providers.length" :data="providers" size="small">
        <el-table-column label="#" width="50" align="center">
          <template #default="{ $index }">
            <span class="text-sm font-bold" :class="providers[$index]?.enabled ? 'text-blue-300' : 'text-gray-600'">{{ $index + 1 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="排序" width="70" align="center">
          <template #default="{ $index }">
            <div class="flex justify-center gap-1">
              <el-button size="small" circle :disabled="$index === 0" @click="moveUp($index)">
                <i class="fas fa-chevron-up text-[10px]"></i>
              </el-button>
              <el-button size="small" circle :disabled="$index === providers.length - 1" @click="moveDown($index)">
                <i class="fas fa-chevron-down text-[10px]"></i>
              </el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="供应商" min-width="100">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium" :class="row.enabled ? 'text-gray-200' : 'text-gray-500 line-through'">{{ row.name }}</span>
              <el-switch :model-value="!!row.enabled" size="small" @change="toggleEnabled(row)" />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="API Key" min-width="160" show-overflow-tooltip>
          <template #default="{ row }"><span class="text-xs font-mono text-gray-400">{{ row.api_key?.slice(0, 16) }}{{ row.api_key?.length > 16 ? '...' : '' }}</span></template>
        </el-table-column>
        <el-table-column label="Base URL" min-width="180" show-overflow-tooltip>
          <template #default="{ row }"><span class="text-xs text-gray-400">{{ row.base_url }}</span></template>
        </el-table-column>
        <el-table-column label="模型" min-width="180">
          <template #default="{ row }">
            <span class="text-xs text-gray-300">{{ getModelDisplay(row) }}</span>
          </template>
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
        <i class="fas fa-robot text-3xl mb-3 inline-block opacity-30"></i>
        暂无供应商，点击"添加供应商"开始配置
      </div>
    </div>

    <!-- Dialog -->
    <el-dialog v-model="dialogVisible" :title="isNew ? '添加供应商' : '编辑供应商'" width="520px" destroy-on-close :close-on-click-modal="false">
      <div class="space-y-4">
        <div>
          <div class="text-xs text-gray-400 mb-1.5">供应商名称</div>
          <el-select v-model="editing.name" filterable allow-create placeholder="选择或输入供应商名" class="!w-full">
            <el-option v-for="n in ['deepseek','minimax','openai','qwen','glm','moonshot','baichuan','gemini','claude']" :key="n" :label="n" :value="n" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">API Key</div>
          <el-input v-model="editing.api_key" placeholder="sk-..." show-password />
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">Base URL</div>
          <div class="flex gap-2">
            <el-input v-model="editing.base_url" placeholder="https://api.example.com/v1" class="flex-1" />
            <el-button
              size="default"
              :loading="fetchingModels"
              :disabled="!editing.base_url || !editing.api_key"
              @click="fetchModelsFromProvider"
            >
              <i class="fas fa-sync-alt mr-1"></i>获取模型
            </el-button>
          </div>
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">默认模型 <span class="text-red-400">*</span></div>
          <el-select
            v-model="selectedDefault"
            filterable
            placeholder="选择默认模型"
            class="!w-full"
            :loading="fetchingModels"
          >
            <el-option v-for="m in availableModels" :key="m" :label="m" :value="m" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">回退模型 <span class="text-gray-600">(可选)</span></div>
          <el-select
            v-model="selectedFallback"
            filterable
            clearable
            placeholder="选择回退模型"
            class="!w-full"
            :loading="fetchingModels"
          >
            <el-option v-for="m in availableModels" :key="m" :label="m" :value="m" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-400 mb-1.5">启用</div>
          <el-switch v-model="editing.enabled" :active-value="1" :inactive-value="0" />
        </div>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
