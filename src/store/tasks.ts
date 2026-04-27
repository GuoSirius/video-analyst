import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Task, TranscriptionMethod } from '../types'

export const useTaskStore = defineStore('tasks', () => {
  // 任务列表
  const tasks = ref<Task[]>([])
  
  // 是否正在处理队列
  const isProcessingQueue = ref(false)

  // 加载任务
  async function loadTasks() {
    if (window.electronAPI) {
      const loadedTasks = await window.electronAPI.getTasks()
      tasks.value = loadedTasks || []
    }
  }

  // 添加任务
  async function addTask(file: { name: string; path: string; size: number }) {
    // 检查是否已存在相同路径的任务
    const exists = tasks.value.some(t => t.filePath === file.path)
    if (exists) {
      return null
    }
    
    const newTask: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      fileName: file.name,
      filePath: file.path,
      fileSize: file.size,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    tasks.value.push(newTask)
    
    if (window.electronAPI) {
      try {
        await window.electronAPI.addTask(newTask)
      } catch (e) {
        console.error('Failed to persist task:', e)
      }
    }
    return newTask
  }

  // 批量添加任务
  async function addTasks(files: { name: string; path: string; size: number }[]) {
    const added: Task[] = []
    for (const file of files) {
      const task = await addTask(file)
      if (task) {
        added.push(task)
      }
    }
    return added
  }

  // 更新任务
  async function updateTask(taskId: string, updates: Partial<Task>) {
    if (window.electronAPI) {
      await window.electronAPI.updateTask(taskId, updates)
    }
    const index = tasks.value.findIndex(t => t.id === taskId)
    const existingTask = tasks.value[index]
    if (index !== -1 && existingTask) {
      tasks.value[index] = { ...existingTask, ...updates, updatedAt: Date.now() }
    }
  }

  // 处理单个任务
  async function processTask(taskId: string, method: TranscriptionMethod, llmConfigId: string): Promise<string | undefined> {
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
    return undefined
  }

  // 获取下一个待处理任务
  function getNextPendingTask(): Task | undefined {
    return tasks.value.find(t => t.status === 'pending')
  }

  // 检查是否还有正在处理的任务
  function hasProcessingTask(): boolean {
    return tasks.value.some(t => t.status === 'processing')
  }

  // 清空所有任务
  async function clearTasks() {
    tasks.value = []
    if (window.electronAPI) {
      try {
        await window.electronAPI.clearTasks()
      } catch (e) {
        console.error('Failed to clear tasks:', e)
      }
    }
  }

  // 获取待处理任务数量
  const pendingTasks = computed(() => tasks.value.filter(t => t.status === 'pending'))
  const processingTasks = computed(() => tasks.value.filter(t => t.status === 'processing'))
  const completedTasks = computed(() => tasks.value.filter(t => t.status === 'completed'))
  const failedTasks = computed(() => tasks.value.filter(t => t.status === 'failed'))

  return {
    tasks,
    isProcessingQueue,
    pendingTasks,
    processingTasks,
    completedTasks,
    failedTasks,
    loadTasks,
    addTask,
    addTasks,
    updateTask,
    processTask,
    getNextPendingTask,
    hasProcessingTask,
    clearTasks
  }
})
