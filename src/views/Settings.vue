<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '../store/app'
import type { LLMConfig, LLMProvider } from '../types'

const { locale } = useI18n()
const appStore = useAppStore()

// 折叠状态
const generalCollapsed = ref(true)
const llmCollapsed = ref(false)

// 语言选项
const languageOptions = [
  { value: 'zh-CN', label: '简体中文', icon: 'fa-solid fa-language' },
  { value: 'en-US', label: 'English', icon: 'fa-solid fa-language' }
]

// 主题选项
const themeOptions = [
  { value: 'dark', label: '深色', icon: 'fa-solid fa-moon' },
  { value: 'light', label: '浅色', icon: 'fa-solid fa-sun' },
  { value: 'auto', label: '跟随系统', icon: 'fa-solid fa-desktop' }
]

// 大模型提供商选项
const providerOptions = [
  { value: 'openai', label: 'OpenAI', logo: 'fa-brands fa-openai' },
  { value: 'wenxin', label: '文心一言', logo: 'fa-solid fa-brain' },
  { value: 'local-whisper', label: 'Local Whisper', logo: 'fa-solid fa-microphone-lines' },
  { value: 'custom', label: '自定义', logo: 'fa-solid fa-gear' }
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
  locale.value = value
  appStore.setLanguage(value)
}

// 主题切换
function onThemeChange(value: string) {
  appStore.setTheme(value)
}

// 获取提供商信息
function getProviderInfo(provider: string) {
  const info = providerOptions.find(p => p.value === provider)
  return info ?? providerOptions[3]!
}

// 挂载时加载配置
onMounted(() => {
  loadConfigs()
})
</script>

<template>
  <div class="settings">
    <!-- 页面标题区 -->
    <div class="page-header">
      <div class="header-content">
        <h1 class="page-title">设置</h1>
        <p class="page-subtitle">个性化配置，应用偏好设置</p>
      </div>
    </div>

    <!-- 设置卡片 -->
    <div class="settings-grid">
      <!-- 常规设置 - 可折叠 -->
      <div class="settings-card" :class="{ collapsed: generalCollapsed }">
        <button class="card-header" @click="generalCollapsed = !generalCollapsed">
          <div class="card-icon">
            <i class="fa-solid fa-sliders"></i>
          </div>
          <h3 class="card-title">常规设置</h3>
          <i class="fa-solid fa-chevron-down collapse-icon" :class="{ rotated: !generalCollapsed }"></i>
        </button>

        <Transition name="collapse">
          <div class="card-content" v-show="!generalCollapsed">
            <div class="settings-list">
              <!-- 语言设置 -->
              <div class="setting-item">
                <div class="setting-info">
                  <div class="setting-icon lang">
                    <i class="fa-solid fa-language"></i>
                  </div>
                  <div class="setting-text">
                    <span class="setting-label">语言</span>
                    <span class="setting-desc">选择界面显示语言</span>
                  </div>
                </div>
                <div class="setting-control">
                  <div class="lang-selector">
                    <button 
                      v-for="option in languageOptions" 
                      :key="option.value"
                      class="lang-option"
                      :class="{ active: locale === option.value }"
                      @click="onLanguageChange(option.value)"
                    >
                      <i :class="option.icon"></i>
                      <span class="lang-text">{{ option.label }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- 主题设置 -->
              <div class="setting-item">
                <div class="setting-info">
                  <div class="setting-icon theme">
                    <i class="fa-solid fa-moon" v-if="appStore.isDark"></i>
                    <i class="fa-solid fa-sun" v-else></i>
                  </div>
                  <div class="setting-text">
                    <span class="setting-label">主题</span>
                    <span class="setting-desc">选择应用外观主题</span>
                  </div>
                </div>
                <div class="setting-control">
                  <div class="theme-selector">
                    <button 
                      v-for="option in themeOptions" 
                      :key="option.value"
                      class="theme-option"
                      :class="{ active: appStore.theme === option.value }"
                      @click="onThemeChange(option.value)"
                    >
                      <i :class="option.icon"></i>
                      <span>{{ option.label }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- 大模型配置 - 可折叠 -->
      <div class="settings-card llm-card" :class="{ collapsed: llmCollapsed }">
        <button class="card-header" @click="llmCollapsed = !llmCollapsed">
          <div class="card-icon">
            <i class="fa-solid fa-robot"></i>
          </div>
          <h3 class="card-title">大模型配置</h3>
          <button class="add-btn" @click.stop="openAddDialog" v-if="!llmCollapsed">
            <i class="fa-solid fa-plus"></i>
            添加配置
          </button>
          <i class="fa-solid fa-chevron-down collapse-icon" :class="{ rotated: !llmCollapsed }"></i>
        </button>

        <Transition name="collapse">
          <div class="card-content" v-show="!llmCollapsed">
            <div class="llm-list" v-if="llmConfigs.length > 0">
              <div v-for="config in llmConfigs" :key="config.id" class="llm-item">
                <div class="llm-logo">
                  <i :class="getProviderInfo(config.provider).logo"></i>
                </div>
                <div class="llm-info">
                  <span class="llm-name">{{ config.name }}</span>
                  <span class="llm-provider">{{ getProviderInfo(config.provider).label }}</span>
                </div>
                <div class="llm-model">
                  <span class="model-label">模型</span>
                  <span class="model-value">{{ config.modelName || '未设置' }}</span>
                </div>
                <div class="llm-actions">
                  <button class="action-btn edit-btn" @click="openEditDialog(config)">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button class="action-btn delete-btn" @click="deleteConfig(config.id)">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>

            <div class="empty-state" v-else>
              <div class="empty-icon">
                <i class="fa-regular fa-circle-check"></i>
              </div>
              <p class="empty-text">暂无大模型配置</p>
              <p class="empty-hint">点击上方按钮添加新的配置</p>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 配置对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑配置' : '添加配置'"
      width="520px"
      class="config-dialog"
    >
      <el-form label-position="top" class="config-form">
        <el-form-item label="配置名称">
          <el-input v-model="currentConfig.name" placeholder="例如：我的 Whisper" />
        </el-form-item>

        <el-form-item label="服务提供商">
          <el-select v-model="currentConfig.provider" placeholder="选择提供商" class="provider-select">
            <el-option
              v-for="option in providerOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            >
              <span>{{ option.logo }} {{ option.label }}</span>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="API Key">
          <el-input v-model="currentConfig.apiKey" type="password" show-password placeholder="输入 API Key" />
        </el-form-item>

        <el-form-item label="API 地址">
          <el-input v-model="currentConfig.apiUrl" placeholder="输入 API 地址（可选）" />
        </el-form-item>

        <el-form-item label="模型名称">
          <el-input v-model="currentConfig.modelName" placeholder="例如：gpt-3.5-turbo" />
        </el-form-item>

        <el-form-item label="温度参数">
          <div class="temp-slider">
            <el-slider v-model="currentConfig.temperature" :min="0" :max="1" :step="0.1" :show-tooltip="true" />
            <div class="temp-labels">
              <span>精确</span>
              <span>{{ currentConfig.temperature }}</span>
              <span>创意</span>
            </div>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false" class="cancel-btn">取消</el-button>
        <el-button type="primary" @click="saveConfig" class="save-btn">
          {{ isEditing ? '保存修改' : '添加配置' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settings {
  padding: 24px;
  min-height: calc(100vh - 52px);
  background: var(--el-bg-color-page);
}

/* 页面标题区 */
.page-header {
  margin-bottom: 16px;
}

.header-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}

.page-subtitle {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

/* 设置网格 */
.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card {
  background: var(--el-bg-color);
  border-radius: 16px;
  border: 1px solid var(--el-border-color);
  overflow: hidden;
  transition: all 0.3s ease;
}

.settings-card.collapsed {
  background: var(--el-fill-color-light);
}

/* 卡片头部 */
.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  background: var(--el-fill-color-light);
  border: none;
  width: 100%;
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 1px solid var(--el-border-color);
}

.card-header:hover {
  background: var(--el-fill-color);
}

.settings-card:not(.collapsed) .card-header {
  background: linear-gradient(135deg, var(--el-fill-color-lighter), var(--el-fill-color-light));
}

.card-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(14, 165, 233, 0.15));
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3b82f6;
  flex-shrink: 0;
}

.card-icon svg {
  width: 20px;
  height: 20px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
  flex: 1;
  text-align: left;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  background: linear-gradient(135deg, #3b82f6, #0ea5e9);
  border: none;
  color: white;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.collapse-icon {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  transition: transform 0.3s ease;
  flex-shrink: 0;
}

.collapse-icon.rotated {
  transform: rotate(180deg);
}

/* 卡片内容 */
.card-content {
  padding: 16px 20px;
}

/* 设置列表 */
.settings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.setting-item:hover {
  background: var(--el-fill-color);
}

.setting-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.setting-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.setting-icon.lang {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(74, 222, 128, 0.15));
  color: #22c55e;
}

.setting-icon.theme {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(192, 132, 252, 0.15));
  color: #a855f7;
}

.setting-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-label {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.setting-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 语言选择器 */
.lang-selector {
  display: flex;
  gap: 8px;
}

.lang-option {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.lang-option:hover {
  border-color: #3b82f6;
  color: #3b82f6;
}

.lang-option.active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(14, 165, 233, 0.15));
  border-color: #3b82f6;
  color: #3b82f6;
}

.lang-icon {
  font-size: 16px;
}

/* 主题选择器 */
.theme-selector {
  display: flex;
  gap: 8px;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.theme-option:hover {
  border-color: #3b82f6;
  color: #3b82f6;
}

.theme-option.active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(14, 165, 233, 0.15));
  border-color: #3b82f6;
  color: #3b82f6;
}

/* LLM 配置列表 */
.llm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.llm-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.llm-item:hover {
  background: var(--el-fill-color);
}

.llm-logo {
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(14, 165, 233, 0.15));
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.llm-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.llm-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.llm-provider {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.llm-model {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.model-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.model-value {
  font-size: 13px;
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.llm-actions {
  display: flex;
  gap: 8px;
}

/* 操作按钮 */
.action-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  font-size: 12px;
}

.edit-btn {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(14, 165, 233, 0.15));
  color: #3b82f6;
}

.edit-btn:hover {
  background: linear-gradient(135deg, #3b82f6, #0ea5e9);
  color: white;
}

.delete-btn {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}

.delete-btn:hover {
  background: #ef4444;
  color: white;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 48px 24px;
}

.empty-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  background: var(--el-fill-color);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
}

.empty-icon svg {
  width: 32px;
  height: 32px;
}

.empty-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  margin: 0 0 4px;
}

.empty-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

/* 配置表单 */
.config-form {
  padding: 8px 0;
}

.provider-select {
  width: 100%;
}

.temp-slider {
  padding: 0 8px;
}

.temp-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.temp-labels span:nth-child(2) {
  font-weight: 600;
  color: #3b82f6;
}

/* 对话框按钮 */
.cancel-btn {
  padding: 10px 24px;
  border-radius: 8px;
}

.save-btn {
  padding: 10px 24px;
  border-radius: 8px;
  background: linear-gradient(135deg, #3b82f6, #0ea5e9);
  border: none;
}

/* 折叠动画 */
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  opacity: 1;
  max-height: 500px;
}

/* 响应式 */
@media (max-width: 768px) {
  .setting-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  
  .setting-control {
    width: 100%;
  }
  
  .lang-selector,
  .theme-selector {
    width: 100%;
  }
  
  .lang-option,
  .theme-option {
    flex: 1;
    justify-content: center;
  }
}
</style>
