import { contextBridge, ipcRenderer } from 'electron'

// 窗口管理 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口操作
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowToggleFullscreen: () => ipcRenderer.send('window-toggle-fullscreen'),

  // 窗口状态
  windowSetAlwaysOnTop: (onTop: boolean, level?: string) =>
    ipcRenderer.invoke('window-set-always-on-top', onTop, level),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // 创建新窗口
  windowCreate: (options?: Electron.BrowserWindowConstructorOptions) =>
    ipcRenderer.invoke('window-create', options),

  // 窗口最大化状态变化监听
  onWindowMaximize: (callback: () => void) => {
    ipcRenderer.on('window-maximize', callback)
    return () => ipcRenderer.removeListener('window-maximize', callback)
  },
  onWindowUnmaximize: (callback: () => void) => {
    ipcRenderer.on('window-unmaximize', callback)
    return () => ipcRenderer.removeListener('window-unmaximize', callback)
  },

  // 文件选择
  selectFiles: () => ipcRenderer.invoke('dialog:selectFiles'),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // 任务管理
  getTasks: () => ipcRenderer.invoke('task:getTasks'),
  addTask: (task) => ipcRenderer.invoke('task:addTask', task),
  updateTask: (taskId, updates) => ipcRenderer.invoke('task:updateTask', taskId, updates),
  processTask: (taskId, method, llmConfigId) => ipcRenderer.invoke('task:process', taskId, method, llmConfigId),

  // LLM 配置管理
  getLLMConfigs: () => ipcRenderer.invoke('llm:getConfigs'),
  saveLLMConfig: (config) => ipcRenderer.invoke('llm:saveConfig', config),
  deleteLLMConfig: (id) => ipcRenderer.invoke('llm:deleteConfig', id),

  // 任务进度监听
  onTaskProgress: (callback: (taskId: string, progress: number) => void) => {
    ipcRenderer.on('task:progress', (event, taskId, progress) => callback(taskId, progress))
    return () => ipcRenderer.removeListener('task:progress', callback)
  }
})

// 类型声明
declare global {
  interface Window {
    electronAPI: {
      windowMinimize: () => void
      windowToggleMaximize: () => void
      windowClose: () => void
      windowToggleFullscreen: () => void
      windowSetAlwaysOnTop: (onTop: boolean, level?: string) => Promise<boolean>
      windowIsMaximized: () => Promise<boolean>
      windowCreate: (options?: Electron.BrowserWindowConstructorOptions) => Promise<{ id: number }>
      onWindowMaximize: (callback: () => void) => () => void
      onWindowUnmaximize: (callback: () => void) => () => void
      selectFiles: () => Promise<string[]>
      selectFolder: () => Promise<string>
      getTasks: () => Promise<any[]>
      addTask: (task: any) => Promise<any[]>
      updateTask: (taskId: string, updates: any) => Promise<boolean>
      processTask: (taskId: string, method: string, llmConfigId: string) => Promise<string>
      getLLMConfigs: () => Promise<any[]>
      saveLLMConfig: (config: any) => Promise<boolean>
      deleteLLMConfig: (id: string) => Promise<boolean>
      onTaskProgress: (callback: (taskId: string, progress: number) => void) => () => void
    }
  }
}
