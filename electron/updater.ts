import pkg from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'

const { autoUpdater } = pkg

// 更新状态
let updateStatus: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' = 'idle'
let latestVersion: string | null = null
let downloadProgress = 0

// 配置日志
autoUpdater.logger = {
  info: (...args) => console.log('[AutoUpdater]', ...args),
  warn: (...args) => console.warn('[AutoUpdater]', ...args),
  error: (...args) => console.error('[AutoUpdater]', ...args),
  debug: (...args) => console.debug('[AutoUpdater]', ...args)
}

// 通知所有窗口更新状态
function notifyUpdateStatus(status: string, data?: Record<string, unknown>): void {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('update:status', status, data)
  })
}

// 初始化自动更新
export function initAutoUpdater(): void {
  // 开发环境禁用自动下载
  if (is.dev) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
  }

  // 更新事件监听
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] 检查更新中...')
    updateStatus = 'checking'
    notifyUpdateStatus('checking')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] 发现新版本:', info.version)
    updateStatus = 'available'
    latestVersion = info.version
    notifyUpdateStatus('available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] 已是最新版本')
    updateStatus = 'idle'
    notifyUpdateStatus('not-available', {
      currentVersion: info.version
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] 下载进度: ${progress.percent.toFixed(1)}%`)
    updateStatus = 'downloading'
    downloadProgress = progress.percent
    notifyUpdateStatus('downloading', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] 下载完成:', info.version)
    updateStatus = 'ready'
    notifyUpdateStatus('ready', {
      version: info.version,
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] 错误:', err)
    updateStatus = 'idle'
    notifyUpdateStatus('error', {
      message: err.message
    })
  })
}

// 设置 IPC 通信
export function setupUpdateIPC(): void {
  // 检查更新
  ipcMain.handle('update:check', async () => {
    try {
      if (updateStatus === 'downloading' || updateStatus === 'ready') {
        return { status: updateStatus, version: latestVersion }
      }
      await autoUpdater.checkForUpdates()
      return { status: 'checking' }
    } catch (error) {
      console.error('[AutoUpdater] 检查更新失败:', error)
      return { status: 'error', message: (error as Error).message }
    }
  })

  // 下载更新
  ipcMain.handle('update:download', async () => {
    try {
      if (updateStatus !== 'available') {
        return { status: updateStatus }
      }
      await autoUpdater.downloadUpdate()
      return { status: 'downloading' }
    } catch (error) {
      console.error('[AutoUpdater] 下载更新失败:', error)
      return { status: 'error', message: (error as Error).message }
    }
  })

  // 安装更新
  ipcMain.handle('update:install', () => {
    console.log('[AutoUpdater] 安装更新并重启...')
    autoUpdater.quitAndInstall(false, true)
    return { status: 'installing' }
  })

  // 获取当前状态
  ipcMain.handle('update:status', () => {
    return {
      status: updateStatus,
      version: latestVersion,
      progress: downloadProgress
    }
  })
}

// 触发更新检查（应用启动时）
export function checkForUpdates(): void {
  if (!is.dev) {
    // 生产环境自动检查更新
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.error('[AutoUpdater] 自动检查更新失败:', err)
      })
    }, 3000)
  }
}
