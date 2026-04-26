<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '../store/app'

const { t, locale } = useI18n()
const appStore = useAppStore()

const isMaximized = ref(false)

// 窗口操作
function minimize(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  console.log('[AppHeader] minimize clicked, electronAPI:', window.electronAPI)
  if (window.electronAPI) {
    window.electronAPI.windowMinimize()
  } else {
    console.error('[AppHeader] electronAPI is undefined!')
  }
}

async function toggleMaximize(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  console.log('[AppHeader] toggleMaximize clicked, electronAPI:', window.electronAPI)
  if (window.electronAPI) {
    await window.electronAPI.windowToggleMaximize()
    isMaximized.value = await window.electronAPI.windowIsMaximized()
  } else {
    console.error('[AppHeader] electronAPI is undefined!')
  }
}

function close(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  console.log('[AppHeader] close clicked, electronAPI:', window.electronAPI)
  if (window.electronAPI) {
    window.electronAPI.windowClose()
  } else {
    console.error('[AppHeader] electronAPI is undefined!')
  }
}

// 主题切换
function toggleTheme() {
  const themes: string[] = ['dark', 'light', 'auto']
  const currentIndex = themes.indexOf(appStore.theme)
  const nextIndex = (currentIndex + 1) % themes.length
  const nextTheme = themes[nextIndex]
  if (nextTheme) {
    appStore.setTheme(nextTheme)
  }
}

// 语言切换
function toggleLanguage() {
  const langs: string[] = ['zh-CN', 'en-US']
  const currentIndex = langs.indexOf(locale.value)
  const nextIndex = (currentIndex + 1) % langs.length
  const nextLang = langs[nextIndex]
  if (nextLang) {
    locale.value = nextLang
    appStore.setLanguage(nextLang)
  }
}

// 监听最大化状态变化
let removeMaximizeListener: (() => void) | undefined
let removeUnmaximizeListener: (() => void) | undefined

onMounted(async () => {
  isMaximized.value = await window.electronAPI?.windowIsMaximized()
  
  removeMaximizeListener = window.electronAPI?.onWindowMaximize(() => {
    isMaximized.value = true
  })
  
  removeUnmaximizeListener = window.electronAPI?.onWindowUnmaximize(() => {
    isMaximized.value = false
  })
})

onUnmounted(() => {
  removeMaximizeListener?.()
  removeUnmaximizeListener?.()
})
</script>

<template>
  <header class="app-header" :class="{ 'is-dark': appStore.isDark }">
    <!-- 拖拽区域 -->
    <div class="drag-region"></div>
    
    <!-- 左侧品牌区 -->
    <div class="brand">
      <div class="brand-icon">
        <i class="fa-solid fa-video"></i>
      </div>
      <span class="brand-name">Video Analyst</span>
    </div>

    <!-- 右侧控制区 -->
    <div class="controls">
      <!-- 语言切换 -->
      <button class="control-btn lang-btn" @click="toggleLanguage" :title="t('settings.language')">
        {{ locale === 'zh-CN' ? 'EN' : '中' }}
      </button>

      <!-- 主题切换 -->
      <button class="control-btn" @click="toggleTheme" :title="t('settings.theme')">
        <i class="fa-solid fa-sun" v-if="appStore.theme === 'light'"></i>
        <i class="fa-solid fa-moon" v-else></i>
      </button>

      <!-- 窗口控制按钮 -->
      <div class="window-controls">
        <button class="window-btn" @click="minimize" title="最小化">
          <i class="fa-solid fa-minus"></i>
        </button>
        <button class="window-btn" @click="toggleMaximize" :title="isMaximized ? '还原' : '最大化'">
          <i class="fa-solid fa-clone" v-if="isMaximized"></i>
          <i class="fa-solid fa-expand" v-else></i>
        </button>
        <button class="window-btn close-btn" @click="close" title="关闭">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  position: relative;
  -webkit-app-region: drag;
  user-select: none;
}

.app-header.is-dark {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

/* 拖拽区域 - 占满整个头部但排除按钮 */
.drag-region {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  -webkit-app-region: drag;
  pointer-events: none;
}

/* 品牌区 */
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  z-index: 1;
  -webkit-app-region: no-drag;
}

.brand-icon {
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
  font-size: 14px;
}

.brand-name {
  font-size: 15px;
  font-weight: 600;
  background: linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.is-dark .brand-name {
  background: linear-gradient(135deg, #60a5fa 0%, #38bdf8 100%);
  -webkit-background-clip: text;
  background-clip: text;
}

/* 控制区 */
.controls {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  margin-left: auto;
  z-index: 1;
  -webkit-app-region: no-drag;
}

.control-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: #64748b;
  transition: all 0.2s ease;
  font-size: 12px;
  font-weight: 600;
}

.is-dark .control-btn {
  color: #94a3b8;
}

.control-btn:hover {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.is-dark .control-btn:hover {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.lang-btn {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

/* 窗口控制按钮 */
.window-controls {
  display: flex;
  align-items: center;
  margin-left: 8px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 10px;
  padding: 4px;
  gap: 2px;
  -webkit-app-region: no-drag;
}

.is-dark .window-controls {
  background: rgba(255, 255, 255, 0.06);
}

.window-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: #64748b;
  transition: all 0.15s ease;
  font-size: 12px;
  -webkit-app-region: no-drag;
}

.is-dark .window-btn {
  color: #94a3b8;
}

.window-btn:hover {
  background: rgba(100, 116, 139, 0.15);
  color: #475569;
}

.is-dark .window-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
}

.window-btn.close-btn:hover {
  background: #ef4444;
  color: white;
}

.is-dark .window-btn.close-btn:hover {
  background: #dc2626;
  color: white;
}
</style>
