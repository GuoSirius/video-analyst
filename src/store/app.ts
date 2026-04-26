import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

export const useAppStore = defineStore('app', () => {
  // 主题：dark, light, auto
  const theme = ref<string>(localStorage.getItem('theme') || 'dark')
  const isDark = ref<boolean>(theme.value === 'dark' || (theme.value === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches))

  // 语言
  const language = ref<string>(localStorage.getItem('language') || 'zh-CN')

  // 初始化主题
  function initTheme() {
    applyTheme()
    if (theme.value === 'auto') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        isDark.value = e.matches
        applyTheme()
      })
    }
  }

  // 应用主题
  function applyTheme() {
    const html = document.documentElement
    if (theme.value === 'dark') {
      html.classList.add('dark')
      isDark.value = true
    } else if (theme.value === 'light') {
      html.classList.remove('dark')
      isDark.value = false
    } else if (theme.value === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      if (prefersDark) {
        html.classList.add('dark')
        isDark.value = true
      } else {
        html.classList.remove('dark')
        isDark.value = false
      }
    }
  }

  // 设置主题
  function setTheme(newTheme: string) {
    theme.value = newTheme
    localStorage.setItem('theme', newTheme)
    applyTheme()
  }

  // 设置语言
  function setLanguage(newLang: string) {
    language.value = newLang
    localStorage.setItem('language', newLang)
  }

  return {
    theme,
    isDark,
    language,
    initTheme,
    setTheme,
    setLanguage
  }
})
