import { extractAudio, transcribeWithLocalWhisper } from './ffmpeg'
import type { LLMConfig, Task, TranscriptionMethod } from '../../src/types'
import Store from 'electron-store'

// 初始化 electron-store
const store = new Store<{
  tasks: Task[];
  llmConfigs: LLMConfig[];
}>({
  defaults: {
    tasks: [],
    llmConfigs: []
  }
})

// 获取所有任务
export function getTasks(): Task[] {
  return store.get('tasks', [])
}

// 保存所有任务
export function saveTasks(tasks: Task[]): void {
  store.set('tasks', tasks)
}

// 更新单个任务
export function updateTask(taskId: string, updates: Partial<Task>): void {
  const tasks = getTasks()
  const index = tasks.findIndex(t => t.id === taskId)
  if (index !== -1) {
    tasks[index] = { ...tasks[index], ...updates, updatedAt: Date.now() }
    saveTasks(tasks)
  }
}

// 处理单个文件
export async function processFile(
  task: Task,
  method: TranscriptionMethod,
  llmConfigId: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  try {
    // 更新任务状态为处理中
    updateTask(task.id, { status: 'processing', progress: 0 })

    // 1. 提取音频
    const audioOutputPath = task.filePath.replace(/\.[^/.]+$/, '.mp3')
    await extractAudio(task.filePath, audioOutputPath, (progress) => {
      onProgress?.(Math.round(progress * 0.5)) // 音频提取占 50% 进度
      updateTask(task.id, { progress: Math.round(progress * 0.5) })
    })

    // 2. 转文字
    let transcriptionResult = ''
    if (method === 'local') {
      // 本地 Whisper
      const transcriptionPath = audioOutputPath.replace(/\.mp3$/, '.txt')
      await transcribeWithLocalWhisper(audioOutputPath, transcriptionPath, (progress) => {
        const p = 50 + Math.round(progress * 0.5)
        onProgress?.(p)
        updateTask(task.id, { progress: p })
      })
      transcriptionResult = transcriptionPath
    } else {
      // 云端 API
      const config = getLLMConfig(llmConfigId)
      if (!config) {
        throw new Error('LLM config not found')
      }
      transcriptionResult = await transcribeWithCloudAPI(audioOutputPath, config, (progress) => {
        const p = 50 + Math.round(progress * 0.5)
        onProgress?.(p)
        updateTask(task.id, { progress: p })
      })
    }

    // 更新任务状态为已完成
    updateTask(task.id, { status: 'completed', progress: 100, outputPath: transcriptionResult })
    return transcriptionResult
  } catch (error) {
    // 更新任务状态为失败
    updateTask(task.id, { status: 'failed', error: (error as Error).message })
    throw error
  }
}

// 使用云端 API 进行转文字
async function transcribeWithCloudAPI(
  audioPath: string,
  config: LLMConfig,
  onProgress?: (progress: number) => void
): Promise<string> {
  // TODO: 实现云端 API 调用
  // 这里以 OpenAI Whisper API 为例
  if (config.provider === 'openai') {
    // 1. 读取音频文件
    const fs = await import('fs/promises')
    const audioData = await fs.readFile(audioPath)

    // 2. 调用 OpenAI Whisper API
    const formData = new FormData()
    formData.append('file', new Blob([audioData]), 'audio.mp3')
    formData.append('model', config.modelName || 'whisper-1')
    formData.append('language', 'zh')
    // TODO: 使用 fetch 或 axios 发送请求
    // const response = await fetch(config.apiUrl, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${config.apiKey}`
    //   },
    //   body: formData
    // })
    // const result = await response.json()
    // return result.text

    // 占位符：返回模拟结果
    const outputPath = audioPath.replace(/\.mp3$/, '_transcription.txt')
    await fs.writeFile(outputPath, '模拟转文字结果')
    onProgress?.(100)
    return outputPath
  }

  throw new Error(`Unsupported provider: ${config.provider}`)
}

// 获取所有 LLM 配置
export function getLLMConfigs(): LLMConfig[] {
  return store.get('llmConfigs', [])
}

// 保存 LLM 配置
export function saveLLMConfig(config: LLMConfig): void {
  const configs = getLLMConfigs()
  const index = configs.findIndex(c => c.id === config.id)
  if (index !== -1) {
    configs[index] = config
  } else {
    configs.push(config)
  }
  store.set('llmConfigs', configs)
}

// 删除 LLM 配置
export function deleteLLMConfig(id: string): void {
  const configs = getLLMConfigs().filter(c => c.id !== id)
  store.set('llmConfigs', configs)
}

// 获取单个 LLM 配置
export function getLLMConfig(id: string): LLMConfig | undefined {
  return getLLMConfigs().find(c => c.id === id)
}
