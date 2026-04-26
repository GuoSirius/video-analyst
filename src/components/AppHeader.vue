<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '../store/app'
import { Sunny, Moon, Setting, VideoPlay, Minus, FullScreen, Close, CopyDocument } from '@element-plus/icons-vue'

const { t, locale } = useI18n()
const appStore = useAppStore()

const isMaximized = ref(false)

// 窗口操作
function minimize() {
  window.electronAPI?.windowMinimize()
}

async function toggleMaximize() {
  await window.electronAPI?.windowToggleMaximize()
  isMaximized.value = await window.electronAPI?.windowIsMaximized()
}

function close() {
  window.electronAPI?.windowClose()
}

// 主题切换
function toggleTheme() {
  const themes: string[] = ['dark', 'light', 'auto']
  const currentIndex = themes.indexOf(appStore.theme)
  const nextIndex = (currentIndex + 1) % themes.length
  appStore.setTheme(themes[nextIndex])
}

// 语言切换
function toggleLanguage() {
  const langs: string[] = ['zh-CN', 'en-US']
  const currentIndex = langs.indexOf(appStore.language)
  const nextIndex = (currentIndex + 1) % langs.length
  appStore.setLanguage(langs[nextIndex])
  locale.value = langs[nextIndex]
}

onMounted(async () => {
  isMaximized.value = await window.electronAPI?.windowIsMaximized()
})
</script>

<template>
  <div class="app-header h-10 bg-[#1a1a1a] text-white flex items-center px-4 select-none" style="-webkit-app-region: drag">
    <!-- 左侧：应用标题 -->
    <div class="flex items-center gap-2" style="-webkit-app-region: no-drag">
      <el-icon><VideoPlay /></el-icon>
      <span class="text-sm font-medium">{{ t('app.title') }}</span>
    </div>

    <!-- 中间：导航链接 -->
    <div class="flex-1 flex items-center justify-center gap-4" style="-webkit-app-region: no-drag">
      <router-link to="/" class="text-sm hover:text-blue-400 transition-colors">
        {{ t('app.home') }}
      </router-link>
      <router-link to="/settings" class="text-sm hover:text-blue-400 transition-colors">
        {{ t('app.settings') }}
      </router-link>
    </div>

    <!-- 右侧：窗口操作按钮 -->
    <div class="flex items-center gap-2" style="-webkit-app-region: no-drag">
      <!-- 语言切换 -->
      <el-button type="text" size="small" @click="toggleLanguage" class="!text-white">
        {{ appStore.language === 'zh-CN' ? 'EN' : '中' }}
      </el-button>

      <!-- 主题切换 -->
      <el-button type="text" size="small" @click="toggleTheme" class="!text-white">
        <el-icon>
          <Sunny v-if="appStore.theme === 'light'" />
          <Moon v-else />
        </el-icon>
      </el-button>

      <!-- 最小化 -->
      <el-button type="text" size="small" @click="minimize" class="!text-white">
        <el-icon><Minus /></el-icon>
      </el-button>

      <!-- 最大化/还原 -->
      <el-button type="text" size="small" @click="toggleMaximize" class="!text-white">
        <el-icon>
          <FullScreen v-if="!isMaximized" />
          <CopyDocument v-else />
        </el-icon>
      </el-button>

      <!-- 关闭 -->
      <el-button type="text" size="small" @click="close" class="!text-white hover:!bg-red-500">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.app-header {
  -webkit-app-region: drag;
}

.app-header button,
.app-header a {
  -webkit-app-region: no-drag;
}
</style>
