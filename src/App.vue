<script setup lang="ts">
import { useAppStore } from './store/app'
import AppHeader from './components/AppHeader.vue'
import AppSidebar from './components/AppSidebar.vue'

const appStore = useAppStore()

// 初始化主题
appStore.initTheme()
</script>

<template>
  <div class="app-container" :class="{ dark: appStore.isDark }">
    <AppHeader />
    <div class="app-body">
      <AppSidebar />
      <main class="main-content">
        <router-view />
      </main>
    </div>
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

.app-container {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color-page);
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
