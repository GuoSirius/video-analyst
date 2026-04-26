<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '../store/app'

const { t } = useI18n()
const appStore = useAppStore()

const isCollapsed = ref(false)
const activeTooltip = ref<string | null>(null)

const menuItems = [
  { path: '/', icon: 'fa-solid fa-home', label: 'app.home' },
  { path: '/settings', icon: 'fa-solid fa-gear', label: 'app.settings' }
]

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

function showTooltip(itemPath: string) {
  if (isCollapsed.value) {
    activeTooltip.value = itemPath
  }
}

function hideTooltip() {
  activeTooltip.value = null
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: isCollapsed, dark: appStore.isDark }">
    <!-- 菜单列表 -->
    <nav class="menu">
      <div
        v-for="item in menuItems"
        :key="item.path"
        class="menu-item-wrapper"
        @mouseenter="showTooltip(item.path)"
        @mouseleave="hideTooltip"
      >
        <router-link
          :to="item.path"
          class="menu-item"
          :class="{ active: $route.path === item.path }"
        >
          <i :class="item.icon"></i>
          <span class="menu-text" v-show="!isCollapsed">{{ t(item.label) }}</span>
        </router-link>

        <!-- 悬停浮框 -->
        <Transition name="tooltip">
          <div v-if="isCollapsed && activeTooltip === item.path" class="tooltip-card">
            <div class="tooltip-label">{{ t(item.label) }}</div>
            <div class="tooltip-arrow"></div>
          </div>
        </Transition>
      </div>
    </nav>

    <!-- 折叠按钮 -->
    <div class="sidebar-footer">
      <button class="collapse-btn" @click="toggleCollapse" :title="isCollapsed ? '展开菜单' : '收起菜单'">
        <i :class="isCollapsed ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-left'"></i>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 200px;
  height: 100%;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  position: relative;
  overflow: visible;
}

.dark .sidebar {
  background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
  border-right-color: rgba(255, 255, 255, 0.08);
}

.sidebar.collapsed {
  width: 60px;
}

/* 菜单 */
.menu {
  flex: 1;
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  overflow: visible;
}

/* 菜单项包装器 - 用于定位浮框 */
.menu-item-wrapper {
  position: relative;
}

/* 底部区域 */
.sidebar-footer {
  padding: 12px 8px;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.dark .sidebar-footer {
  border-top-color: rgba(255, 255, 255, 0.08);
}

.sidebar.collapsed .sidebar-footer {
  justify-content: center;
}

/* 折叠按钮 */
.collapse-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(59, 130, 246, 0.08);
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.dark .collapse-btn {
  background: rgba(59, 130, 246, 0.12);
  color: #94a3b8;
}

.dark .collapse-btn:hover {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

/* 菜单项 */
.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  text-decoration: none;
  color: #64748b;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
}

.menu-item i {
  font-size: 16px;
  min-width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.menu-item .menu-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar.collapsed .menu-item {
  justify-content: center;
  padding: 12px;
}

.dark .menu-item {
  color: #94a3b8;
}

.menu-item:hover {
  background: rgba(59, 130, 246, 0.08);
  color: #3b82f6;
}

.dark .menu-item:hover {
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
}

.menu-item.active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(14, 165, 233, 0.15) 100%);
  color: #3b82f6;
}

.dark .menu-item.active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(14, 165, 233, 0.2) 100%);
  color: #60a5fa;
}

/* 浮框样式 - 浅色模式（默认） */
.tooltip-card {
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  padding: 10px 14px;
  box-shadow: 
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -2px rgba(0, 0, 0, 0.05),
    0 0 0 1px rgba(0, 0, 0, 0.02) inset;
  z-index: 1000;
  white-space: nowrap;
  min-width: 100px;
}

/* 浮框样式 - 深色模式 */
.sidebar.dark .tooltip-card {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 
    0 4px 6px -1px rgba(0, 0, 0, 0.3),
    0 2px 4px -2px rgba(0, 0, 0, 0.2),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
}

.tooltip-label {
  font-size: 13px;
  font-weight: 500;
  color: #1e293b;
}

.sidebar.dark .tooltip-label {
  color: #f1f5f9;
}

.tooltip-arrow {
  position: absolute;
  left: -5px;
  top: 50%;
  transform: translateY(-50%) rotate(45deg);
  width: 10px;
  height: 10px;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.sidebar.dark .tooltip-arrow {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

/* 浮框动画 */
.tooltip-enter-active,
.tooltip-leave-active {
  transition: all 0.2s ease;
}

.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(-8px);
}
</style>
