import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Task, TranscriptionMethod } from '../types'

export const useTaskStore = defineStore('tasks', () => {
  // 任务列表
  const tasks = ref<Task[]>([])

  // 加载任务
  async function loadTasks() {
    if (window.electronAPI) {
      const loadedTasks = await window.electronAPI.getTasks()
      tasks.value = loadedTasks || []
    }
  }

  // 添加任务
  async function addTask(file: { name: string; path: string; size: number }) {
    const newTask: Task = {
      id: Date.now().toString(),
      fileName: file.name,
      filePath: file.path,
      fileSize: file.size,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    if (window.electronAPI) {
      await window.electronAPI.addTask(newTask)
    }
    tasks.value.push(newTask)
    return newTask
  }

  // 更新任务
  async function updateTask(taskId: string, updates: Partial<Task>) {
    if (window.electronAPI) {
      await window.electronAPI.updateTask(taskId, updates)
    }
    const index = tasks.value.findIndex(t => t.id === taskId)
    if (index !== -1) {
      tasks.value[index] = { ...tasks.value[index], ...updates, updatedAt: Date.now() }
    }
  }

  // 处理任务
  async function processTask(taskId: string, method: TranscriptionMethod, llmConfigId: string) {
    if (window.electronAPI) {
      try {
        await updateTask(taskId, { status: 'processing', progress: 0 })
        const result = await window.electronAPI.processTask(taskId, method, llmConfigId)
        await updateTask(taskId, { status: 'completed', progress: 100, outputPath: result })
        return result
      } catch (error) {
        await updateTask(taskId, { status: 'failed', error: (error as Error).message })
        throw error
      }
    }
  }

  // 按状态筛选任务
  const pendingTasks = computed(() => tasks.value.filter(t => t.status === 'pending'))
  const processingTasks = computed(() => tasks.value.filter(t => t.status === 'processing'))
  const completedTasks = computed(() => tasks.value.filter(t => t.status === 'completed'))
  const failedTasks = computed(() => tasks.value.filter(t => t.status === 'failed'))

  return {
    tasks,
    pendingTasks,
    processingTasks,
    completedTasks,
    failedTasks,
    loadTasks,
    addTask,
    updateTask,
    processTask
  }
})
