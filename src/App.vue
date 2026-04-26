<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAppStore } from './store/app'
import AppHeader from './components/AppHeader.vue'

const { t } = useI18n()
const appStore = useAppStore()

// 初始化主题
appStore.initTheme()
</script>

<template>
  <div class="w-full h-screen overflow-hidden" :class="{ dark: appStore.isDark }">
    <AppHeader />
    <main class="w-full" style="height: calc(100vh - 40px)">
      <router-view />
    </main>
  </div>
</template>

<style>
html, body {
  margin: 0;
  padding: 0;
  overflow: hidden;
}

#app {
  width: 100%;
  height: 100%;
}
</style>
