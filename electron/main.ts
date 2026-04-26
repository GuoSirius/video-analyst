import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

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
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
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

  mainWindow.on('closed', () => {
    windows.delete(id)
  })

  return mainWindow
}

// 窗口管理 IPC 处理
function setupWindowIPC(): void {
  // 窗口最小化
  ipcMain.on('window-minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.minimize()
  })

  // 窗口最大化/还原
  ipcMain.on('window-toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window?.isMaximized()) {
      window.unmaximize()
    } else {
      window?.maximize()
    }
  })

  // 窗口关闭
  ipcMain.on('window-close', (event) => {
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
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupWindowIPC()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
