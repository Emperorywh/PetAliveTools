/**
 * 主进程入口 (main process entry)
 *
 * 负责引导 Electron 应用：创建透明宠物窗口、系统托盘、全局快捷键、
 * 屏幕管理器，并处理生命周期事件。
 *
 * 运行于主进程。
 */

import { app, BrowserWindow, type Tray } from 'electron'
import { createPetWindow, setInteractive } from './window'
import { createTray } from './tray'
import { registerHideShortcut, unregisterHideShortcut } from './global-shortcut'
import { ScreenManager } from './screen'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let screenManager: ScreenManager | null = null

/**
 * 引导全部外壳组件。在 app ready 后调用。
 */
function bootstrap(): void {
  // 1. 创建透明置顶宠物窗口
  mainWindow = createPetWindow()

  // 2. 屏幕管理器：计算 workArea 与地面线，监听显示器变化（§7.1、§13）
  screenManager = new ScreenManager()
  const bounds = screenManager.init()
  console.log('[screen] workArea bounds:', bounds)

  screenManager.onDisplayChange((newBounds) => {
    console.log('[screen] display changed, recalculated bounds:', newBounds)
  })

  // 3. 系统托盘（§10、§12.4）
  tray = createTray({
    onFeed: () => console.log('[tray] feed'),
    onToy: () => console.log('[tray] toy'),
    onToggleHide: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
      }
    },
    onSettings: () => console.log('[tray] settings'),
    onAbout: () => console.log('[tray] about')
  })

  // 4. 全局快捷键：安全阀隐藏（§10）
  const registered = registerHideShortcut(() => mainWindow)
  if (!registered) {
    console.warn('[shortcut] failed to register Ctrl+Shift+H')
  }

  // 5. 窗口默认 click-through（已在 createPetWindow 中设置）
  //    toggle 机制已就绪（setInteractive API），命中盒逻辑由 TASK-012 实现
  setInteractive(mainWindow, false)

  // 防止窗口被关闭时退出（frameless 无关闭按钮，但 Alt+F4 可能触发）
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

app.whenReady().then(() => {
  bootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootstrap()
    }
  })
})

app.on('will-quit', () => {
  unregisterHideShortcut()
  screenManager?.dispose()
})

app.on('before-quit', () => {
  // 允许窗口真正关闭（解除 close → hide 拦截）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close')
    mainWindow.destroy()
  }
  tray?.destroy()
})

app.on('window-all-closed', () => {
  // skipTaskbar 窗口被隐藏而非关闭，不会触发 window-all-closed；
  // 若确实所有窗口已关闭（如 destroy），则退出
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
