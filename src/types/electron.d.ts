// Electron API 类型声明

export interface ElectronAPI {
  // 窗口操作
  windowMinimize: () => void
  windowToggleMaximize: () => void
  windowClose: () => void
  windowToggleFullscreen: () => void

  // 窗口状态
  windowSetAlwaysOnTop: (onTop: boolean, level?: string) => Promise<boolean>
  windowIsMaximized: () => Promise<boolean>

  // 创建新窗口
  windowCreate: (options?: Electron.BrowserWindowConstructorOptions) => Promise<{ id: number }>

  // 窗口最大化状态变化监听
  onWindowMaximize: (callback: () => void) => () => void
  onWindowUnmaximize: (callback: () => void) => () => void

  // 文件选择
  selectFiles: () => Promise<string[]>
  selectFolder: () => Promise<string>
  scanFolder: (folderPath: string, maxDepth: number) => Promise<string[]>

  // 任务管理
  getTasks: () => Promise<any[]>
  addTask: (task: any) => Promise<any[]>
  updateTask: (taskId: string, updates: any) => Promise<boolean>
  processTask: (taskId: string, method: string, llmConfigId: string) => Promise<string>

  // LLM 配置管理
  getLLMConfigs: () => Promise<any[]>
  saveLLMConfig: (config: any) => Promise<boolean>
  deleteLLMConfig: (id: string) => Promise<boolean>

  // 任务进度监听
  onTaskProgress: (callback: (taskId: string, progress: number) => void) => () => void

  // 自动更新
  updateCheck: () => Promise<{ status: string; version?: string; message?: string }>
  updateDownload: () => Promise<{ status: string; message?: string }>
  updateInstall: () => Promise<{ status: string }>
  updateStatus: () => Promise<{ status: string; version?: string; progress?: number }>
  onUpdateStatus: (callback: (status: string, data?: Record<string, unknown>) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
