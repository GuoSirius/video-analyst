import { Tray, Menu, BrowserWindow, app, shell, nativeImage } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'

let tray: Tray | null = null
const windows: BrowserWindow[] = []

export function setTrayWindow(win: BrowserWindow) {
  windows.push(win)
}

export function createTray() {
  // 加载专用托盘图标（优先使用 16x16 的 tray.png）
  let iconImage
  const trayIconPath = resolve(__dirname, '../../resources/icons/tray.png')
  const fallbackIconPath = resolve(__dirname, '../../resources/icons/icon.png')
  
  if (existsSync(trayIconPath)) {
    // 使用专用托盘图标
    iconImage = nativeImage.createFromPath(trayIconPath)
  } else if (existsSync(fallbackIconPath)) {
    // 回退到主图标并调整尺寸
    iconImage = nativeImage.createFromPath(fallbackIconPath).resize(16, 16)
  } else {
    // 创建一个简单的占位图标（16x16 透明 PNG）
    const placeholderBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABhSURBVDhP7c6xDQAgDASwQ6T9O2sBHvZCNkI2QjZCNkI2QjZCNkI2QjZCNkI2QjZCNkI2QjZCNkI2QjZCNkI2QjbCP0a9gB6G8BQMp6eHQAAAABJRU5ErkJggg=='
    iconImage = nativeImage.createFromBuffer(Buffer.from(placeholderBase64, 'base64'))
  }
  
  tray = new Tray(iconImage)

  // 更新托盘菜单
  function updateTrayMenu() {
    const allVisible = windows.some(w => w.isVisible())

    const contextMenu = Menu.buildFromTemplate([
      {
        label: allVisible ? '隐藏所有窗口' : '显示所有窗口',
        click: () => {
          if (allVisible) {
            windows.forEach(w => w.hide())
          } else {
            windows.forEach(w => w.show())
          }
          updateTrayMenu()
        }
      },
      {
        label: '退出应用',
        click: () => {
          app.quit()
        }
      }
    ])

    tray?.setContextMenu(contextMenu)
  }

  // 左键点击：切换显示/隐藏所有窗口
  tray.on('click', () => {
    const allVisible = windows.some(w => w.isVisible())
    if (allVisible) {
      windows.forEach(w => w.hide())
    } else {
      windows.forEach(w => {
        w.show()
        w.focus()
      })
    }
    updateTrayMenu()
  })

  // 右键菜单
  updateTrayMenu()

  return tray
}

export function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
