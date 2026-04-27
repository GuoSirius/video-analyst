import { extractAudio, transcribeWithLocalWhisper, transcribeAudio, checkFfmpeg } from './ffmpeg'
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

// 支持的音频格式
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma']

// 是否是音频文件
function isAudioFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'))
  return AUDIO_EXTENSIONS.includes(ext)
}

// 处理单个文件（音频转文字）
export async function processFile(
  task: Task,
  method: TranscriptionMethod,
  _llmConfigId: string,
  onProgress?: (progress: number) => void
): Promise<{ outputPath: string; transcriptionText: string }> {
  try {
    // 检查 ffmpeg 是否可用
    const ffmpegAvailable = await checkFfmpeg()
    if (!ffmpegAvailable) {
      throw new Error('FFmpeg 未安装或不在系统 PATH 中。请先安装 FFmpeg')
    }

    // 更新任务状态为处理中
    updateTask(task.id, { status: 'processing', progress: 0 })

    // 确定音频路径
    let audioPath: string
    let progressOffset = 0
    
    if (isAudioFile(task.filePath)) {
      // 已经是音频文件，直接使用
      audioPath = task.filePath
      progressOffset = 0
    } else {
      // 提取音频
      audioPath = task.filePath.replace(/\.[^/.]+$/, '.mp3')
      await extractAudio(task.filePath, audioPath, (progress) => {
        onProgress?.(Math.round(progress * 0.5))
        updateTask(task.id, { progress: Math.round(progress * 0.5) })
      })
      progressOffset = 50
    }

    // 转文字
    let transcriptionText: string
    let transcriptionPath: string
    
    if (method === 'local') {
      // 本地 Whisper
      transcriptionPath = audioPath.replace(/\.[^/.]+$/, '.txt')
      await transcribeWithLocalWhisper(audioPath, transcriptionPath, (progress) => {
        const p = progressOffset + Math.round(progress * (100 - progressOffset) / 100)
        onProgress?.(p)
        updateTask(task.id, { progress: p })
      })
      // 读取转录内容
      const fs = await import('fs/promises')
      transcriptionText = await fs.readFile(transcriptionPath, 'utf-8')
    } else {
      // 云端 API (这里用 ffmpeg whisper 模拟，实际应该调用云端 API)
      transcriptionText = await transcribeAudio(audioPath, (progress) => {
        const p = progressOffset + Math.round(progress * (100 - progressOffset) / 100)
        onProgress?.(p)
        updateTask(task.id, { progress: p })
      })
      transcriptionPath = audioPath.replace(/\.[^/.]+$/, '.txt')
      const fs = await import('fs/promises')
      await fs.writeFile(transcriptionPath, transcriptionText, 'utf-8')
    }

    // 更新任务状态为已完成，保存转录文字
    updateTask(task.id, { 
      status: 'completed', 
      progress: 100, 
      outputPath: transcriptionPath,
      transcriptionText 
    })
    
    return { outputPath: transcriptionPath, transcriptionText }
  } catch (error) {
    updateTask(task.id, { status: 'failed', error: (error as Error).message })
    throw error
  }
}

// 分析总结任务（发送给大模型）
export async function summarizeTask(
  taskId: string,
  llmConfigId: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const task = getTasks().find(t => t.id === taskId)
  if (!task) {
    throw new Error('任务不存在')
  }
  
  if (!task.transcriptionText) {
    throw new Error('请先完成转录')
  }

  const config = getLLMConfig(llmConfigId)
  if (!config) {
    throw new Error('LLM 配置不存在')
  }

  // 更新总结状态
  updateTask(taskId, { summaryStatus: 'processing' })
  onProgress?.(0)

  try {
    const summary = await callLLMSummarize(task.transcriptionText, config, (progress) => {
      onProgress?.(progress)
    })
    
    // 保存总结结果
    updateTask(taskId, { 
      summaryStatus: 'completed',
      summaryText: summary
    })
    
    return summary
  } catch (error) {
    updateTask(taskId, { summaryStatus: 'failed' })
    throw error
  }
}

// 调用大模型进行总结
async function callLLMSummarize(
  text: string,
  config: LLMConfig,
  onProgress?: (progress: number) => void
): Promise<string> {
  const prompt = `请对以下音频转录的文字进行总结和分析：

${text}

请提供：
1. 主要内容概述
2. 关键要点
3. 结论或建议（如有）`

  onProgress?.(30)

  // 根据不同提供商调用 API
  if (config.provider === 'openai') {
    const response = await fetch(config.apiUrl || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.modelName || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 2000
      })
    })

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`)
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    onProgress?.(100)
    return data.choices?.[0]?.message?.content || ''
  }
  
  // 文心一言
  if (config.provider === 'wenxin') {
    // 调用文心一言 API
    const response = await fetch('https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-8k-latest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }]
      })
    })
    
    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`)
    }
    
    const data = await response.json() as { result?: string }
    onProgress?.(100)
    return data.result || ''
  }

  throw new Error(`不支持的提供商: ${config.provider}`)
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
