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
    }
  }
}
