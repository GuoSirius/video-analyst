// 任务状态
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

// 任务接口
export interface Task {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  status: TaskStatus
  progress: number
  outputPath?: string      // 转录结果文件路径
  transcriptionText?: string  // 转录文字内容
  summaryText?: string     // 分析总结结果
  summaryStatus?: 'pending' | 'processing' | 'completed' | 'failed'
  error?: string
  createdAt: number
  updatedAt: number
}

// 大模型提供商
export type LLMProvider = 'openai' | 'wenxin' | 'local-whisper' | 'custom'

// 大模型配置
export interface LLMConfig {
  id: string
  name: string
  provider: LLMProvider
  apiKey: string
  apiUrl: string
  modelName: string
  temperature: number
  maxTokens?: number
}

// 转文字方式
export type TranscriptionMethod = 'local' | 'cloud'

// 应用设置
export interface AppSettings {
  language: string
  theme: string
  defaultTranscriptionMethod: TranscriptionMethod
  maxConcurrentTasks: number
}
