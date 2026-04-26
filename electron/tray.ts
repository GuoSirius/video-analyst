import { Tray, Menu, BrowserWindow, app, shell, nativeImage } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'

let tray: Tray | null = null
const windows: BrowserWindow[] = []

export function setTrayWindow(win: BrowserWindow) {
  windows.push(win)
}

export function createTray() {
  // 尝试加载图标，如果不存在则使用空图标
  let iconImage
  const iconPath = resolve(__dirname, '../../resources/icons/icon.png')
  if (existsSync(iconPath)) {
    iconImage = nativeImage.createFromPath(iconPath)
  } else {
    // 创建一个简单的占位图标（16x16 透明 PNG）
    iconImage = nativeImage.createFromBuffer(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5godDQkIqZZnZQAAAB1pVFh0Q29tbWVudAAAAAAAQ3JlYXRlZCB3aXRoIEdJTVBkLmUHAAABJUlEQVQ4y6WSoW7CQBRF312K0BW0tIRgYWkLidoIG4M2IgbVoEhsItiJGyE2toag2Fj atrial ZSx2gTZCwE7S0hYKVqK1rQoHw5z/AP/9gVIjNN7Jycz7Myd8cBY8xv1tp7a+3WWhdw3JoC3nPuJ6WU">
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
