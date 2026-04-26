<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '../store/app'
import type { LLMConfig, LLMProvider } from '../types'

const { t } = useI18n()
const appStore = useAppStore()

// 语言选项
const languageOptions = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' }
]

// 主题选项
const themeOptions = [
  { value: 'dark', label: t('settings.dark') },
  { value: 'light', label: t('settings.light') },
  { value: 'auto', label: t('settings.auto') }
]

// 大模型提供商选项
const providerOptions = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'wenxin', label: '文心一言' },
  { value: 'local-whisper', label: 'Local Whisper' },
  { value: 'custom', label: 'Custom' }
]

// 大模型配置列表
const llmConfigs = ref<LLMConfig[]>([])

// 对话框控制
const dialogVisible = ref(false)
const isEditing = ref(false)
const currentConfig = reactive<LLMConfig>({
  id: '',
  name: '',
  provider: 'openai' as LLMProvider,
  apiKey: '',
  apiUrl: '',
  modelName: '',
  temperature: 0.3
})

// 打开添加对话框
function openAddDialog() {
  isEditing.value = false
  Object.assign(currentConfig, {
    id: Date.now().toString(),
    name: '',
    provider: 'openai' as LLMProvider,
    apiKey: '',
    apiUrl: '',
    modelName: '',
    temperature: 0.3
  })
  dialogVisible.value = true
}

// 打开编辑对话框
function openEditDialog(config: LLMConfig) {
  isEditing.value = true
  Object.assign(currentConfig, { ...config })
  dialogVisible.value = true
}

// 保存配置
async function saveConfig() {
  if (window.electronAPI) {
    await window.electronAPI.saveLLMConfig({ ...currentConfig })
    await loadConfigs()
  }
  dialogVisible.value = false
}

// 删除配置
async function deleteConfig(id: string) {
  if (window.electronAPI) {
    await window.electronAPI.deleteLLMConfig(id)
    await loadConfigs()
  }
}

// 加载配置
async function loadConfigs() {
  if (window.electronAPI) {
    const configs = await window.electronAPI.getLLMConfigs()
    llmConfigs.value = configs || []
  }
}

// 语言切换
function onLanguageChange(value: string) {
  appStore.setLanguage(value)
}

// 主题切换
function onThemeChange(value: string) {
  appStore.setTheme(value)
}

// 挂载时加载配置
onMounted(() => {
  loadConfigs()
})
</script>

<template>
  <div class="settings p-6 h-full overflow-auto">
    <h1 class="text-2xl font-bold mb-6">{{ t('settings.title') }}</h1>

    <!-- 常规设置 -->
    <el-card class="mb-6">
      <template #header>{{ t('settings.title') }} - {{ t('app.settings') }}</template>

      <el-form label-width="120px">
        <el-form-item :label="t('settings.language')">
          <el-select :model-value="appStore.language" @update:model-value="onLanguageChange">
            <el-option
              v-for="option in languageOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('settings.theme')">
          <el-radio-group :model-value="appStore.theme" @update:model-value="onThemeChange">
            <el-radio-button value="dark">{{ t('settings.dark') }}</el-radio-button>
            <el-radio-button value="light">{{ t('settings.light') }}</el-radio-button>
            <el-radio-button value="auto">{{ t('settings.auto') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 大模型配置 -->
    <el-card class="mb-6">
      <template #header>
        <div class="flex justify-between items-center">
          <span>{{ t('settings.llm') }}</span>
          <el-button type="primary" size="small" @click="openAddDialog">
            {{ t('settings.add') }}
          </el-button>
        </div>
      </template>

      <el-table :data="llmConfigs" style="width: 100%">
        <el-table-column prop="name" :label="t('settings.llmName')" />
        <el-table-column prop="provider" :label="t('settings.llmProvider')" />
        <el-table-column prop="modelName" :label="t('settings.llmModel')" />
        <el-table-column :label="'操作'" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="openEditDialog(row)">
              {{ t('settings.edit') }}
            </el-button>
            <el-button size="small" type="danger" @click="deleteConfig(row.id)">
              {{ t('settings.delete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 配置对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? t('settings.edit') : t('settings.add')"
      width="500px"
    >
      <el-form label-width="120px">
        <el-form-item :label="t('settings.llmName')">
          <el-input v-model="currentConfig.name" />
        </el-form-item>

        <el-form-item :label="t('settings.llmProvider')">
          <el-select v-model="currentConfig.provider">
            <el-option
              v-for="option in providerOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('settings.llmApiKey')">
          <el-input v-model="currentConfig.apiKey" type="password" show-password />
        </el-form-item>

        <el-form-item :label="t('settings.llmApiUrl')">
          <el-input v-model="currentConfig.apiUrl" />
        </el-form-item>

        <el-form-item :label="t('settings.llmModel')">
          <el-input v-model="currentConfig.modelName" />
        </el-form-item>

        <el-form-item :label="t('settings.llmTemperature')">
          <el-slider v-model="currentConfig.temperature" :min="0" :max="1" :step="0.1" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('settings.cancel') }}</el-button>
        <el-button type="primary" @click="saveConfig">{{ t('settings.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settings {
  background-color: var(--el-bg-color-page, #141414);
  color: var(--el-text-color-primary, #fff);
}
</style>
