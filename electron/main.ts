import { app, shell, BrowserWindow, ipcMain, Tray, Menu, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createTray, setTrayWindow } from './tray'
import { getTasks, saveTasks, updateTask, processFile, getLLMConfigs, saveLLMConfig, deleteLLMConfig } from './utils/transcription'

// 窗口管理：存储所有窗口实例
const windows = new Map<number, BrowserWindow>()

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 监听最大化状态变化并通知渲染进程
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximize')
  })

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-unmaximize')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 存储窗口引用
  const id = mainWindow.id
  windows.set(id, mainWindow)
  setTrayWindow(mainWindow)

  mainWindow.on('closed', () => {
    windows.delete(id)
  })

  return mainWindow
}

// 窗口管理 IPC 处理
function setupWindowIPC(): void {
  // 窗口最小化
  ipcMain.on('window-minimize', (event) => {
    console.log('[Main] window-minimize received')
    const window = BrowserWindow.fromWebContents(event.sender)
    console.log('[Main] window object:', window)
    window?.minimize()
  })

  // 窗口最大化/还原
  ipcMain.on('window-toggle-maximize', (event) => {
    console.log('[Main] window-toggle-maximize received')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window?.isMaximized()) {
      window.unmaximize()
    } else {
      window?.maximize()
    }
  })

  // 窗口关闭
  ipcMain.on('window-close', (event) => {
    console.log('[Main] window-close received')
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.close()
  })

  // 窗口置顶
  ipcMain.handle('window-set-always-on-top', (event, onTop: boolean, level?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.setAlwaysOnTop(onTop, (level as 'normal' | 'floating' | 'torn-off-menu' | 'modal-panel' | 'main-menu' | 'status' | 'pop-up-menu' | 'screen-saver') || 'normal')
    return window?.isAlwaysOnTop()
  })

  // 窗口全屏
  ipcMain.on('window-toggle-fullscreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window?.isFullScreen()) {
      window.setFullScreen(false)
    } else {
      window?.setFullScreen(true)
    }
  })

  // 检查窗口是否最大化
  ipcMain.handle('window-is-maximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return window?.isMaximized() || false
  })

  // 创建新窗口
  ipcMain.handle('window-create', (event, options?: Electron.BrowserWindowConstructorOptions) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 600,
      minHeight: 400,
      show: false,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      },
      ...options
    })

    win.on('ready-to-show', () => win.show())

    // 监听最大化状态变化并通知渲染进程
    win.on('maximize', () => {
      win.webContents.send('window-maximize')
    })

    win.on('unmaximize', () => {
      win.webContents.send('window-unmaximize')
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    const id = win.id
    windows.set(id, win)
    win.on('closed', () => windows.delete(id))

    return { id: win.id }
  })

  // 文件选择对话框
  ipcMain.handle('dialog:selectFiles', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video/Audio', extensions: ['mp4', 'avi', 'mov', 'mkv', 'mp3', 'wav', 'flac', 'm4a'] }
      ]
    })
    return result.filePaths
  })

  // 文件夹选择对话框
  ipcMain.handle('dialog:selectFolder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openDirectory']
    })
    return result.filePaths[0] || null
  })

  // 任务管理
  ipcMain.handle('task:getTasks', () => {
    return getTasks()
  })

  ipcMain.handle('task:addTask', (event, task) => {
    const tasks = getTasks()
    tasks.push(task)
    saveTasks(tasks)
    return tasks
  })

  ipcMain.handle('task:updateTask', (event, taskId, updates) => {
    updateTask(taskId, updates)
    return true
  })

  ipcMain.handle('task:process', async (event, taskId, method, llmConfigId) => {
    const tasks = getTasks()
    const task = tasks.find(t => t.id === taskId)
    if (!task) {
      throw new Error('Task not found')
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    try {
      const result = await processFile(task, method, llmConfigId, (progress) => {
        // 发送进度更新到渲染进程
        window?.webContents.send('task:progress', taskId, progress)
      })
      return result
    } catch (error) {
      throw error
    }
  })

  // LLM 配置管理
  ipcMain.handle('llm:getConfigs', () => {
    return getLLMConfigs()
  })

  ipcMain.handle('llm:saveConfig', (event, config) => {
    saveLLMConfig(config)
    return true
  })

  ipcMain.handle('llm:deleteConfig', (event, id) => {
    deleteLLMConfig(id)
    return true
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupWindowIPC()
  const mainWindow = createWindow()
  setTrayWindow(mainWindow)
  createTray()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow()
      setTrayWindow(win)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
