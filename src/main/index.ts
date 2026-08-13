/**
 * 主进程入口 (main process entry)
 *
 * 负责引导 Electron 应用：创建透明宠物窗口、系统托盘、全局快捷键、
 * 屏幕管理器，并处理生命周期事件。
 *
 * 运行于主进程。
 */

import { app, BrowserWindow, type Tray } from 'electron'
import {
  createPetWindow,
  createChromaPreviewWindow,
  createWalkCorrectionWindow,
  createImportWizardWindow,
  setInteractive
} from './window'
import { createTray } from './tray'
import { registerHideShortcut, unregisterHideShortcut } from './global-shortcut'
import { ScreenManager } from './screen'
import { registerImportIpcHandlers } from './pipeline/ipc-handlers'
import { MouseHandler } from './input/mouse-handler'
import { AudioCoordinator, type AudioPlayCommand } from './audio'
import type { RhythmConfig } from '../shared/types/behavior-config'
import type { NeedsState } from '../shared/types/needs-state'
import { applyNeedDelta } from './behavior/needs'

/** 默认节律配置（§9.3：22–07 夜间） */
const DEFAULT_RHYTHM: RhythmConfig = {
  nightStartHour: 22,
  nightEndHour: 7,
  nightSleepBoost: 3.0,
}

/** 初始需求状态（§9.4） */
const INITIAL_NEEDS: NeedsState = {
  hunger: 30,
  fatigue: 20,
  happiness: 70,
  attention: 60,
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let screenManager: ScreenManager | null = null
let mouseHandler: MouseHandler | null = null
let audioCoordinator: AudioCoordinator | null = null
let needsState: NeedsState = INITIAL_NEEDS

/**
 * 引导全部外壳组件。在 app ready 后调用。
 *
 * PETALIVE_VIEW=chroma-preview / walk-correction 时不启动宠物运行时，
 * 仅创建对应的入库管线工具窗口（§5.5 抠像预览、§5.3 行走跟踪校正，
 * 均为手动验证入口）。
 */
function bootstrap(): void {
  if (process.env['PETALIVE_VIEW'] === 'chroma-preview') {
    createChromaPreviewWindow()
    return
  }
  if (process.env['PETALIVE_VIEW'] === 'walk-correction') {
    createWalkCorrectionWindow()
    return
  }
  if (process.env['PETALIVE_VIEW'] === 'import-wizard') {
    createImportWizardWindow()
    return
  }

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
  audioCoordinator = new AudioCoordinator(
    [],
    { rhythmConfig: DEFAULT_RHYTHM },
    (cmd: AudioPlayCommand) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (cmd.kind === 'play') {
          mainWindow.webContents.send('audio:play', cmd.file, cmd.volume)
        } else if (cmd.kind === 'embedded_start') {
          mainWindow.webContents.send('audio:embedded-start')
        } else if (cmd.kind === 'embedded_stop') {
          mainWindow.webContents.send('audio:embedded-stop')
        }
      }
    },
  )
  audioCoordinator.start()

  tray = createTray(
    {
      onFeed: () => {
        audioCoordinator?.onActionTriggered('eat', null)
        needsState = applyNeedDelta(needsState, { hunger: -40, happiness: 10 })
      },
      onToy: () => {
        audioCoordinator?.onActionTriggered('play', null)
        needsState = applyNeedDelta(needsState, { happiness: 20, attention: 20, fatigue: 5 })
      },
      onToggleMute: () => {
        const muted = audioCoordinator?.toggleMute() ?? false
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('audio:set-muted', muted)
        }
      },
      onToggleHide: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
        }
      },
      onSettings: () => console.log('[tray] settings'),
      onAbout: () => console.log('[tray] about'),
    },
    audioCoordinator.isMuted,
  )

  // 4. 全局快捷键：安全阀隐藏（§10）
  const registered = registerHideShortcut(() => mainWindow)
  if (!registered) {
    console.warn('[shortcut] failed to register Ctrl+Shift+H')
  }

  // 5. 窗口默认 click-through（已在 createPetWindow 中设置）
  //    toggle 机制已就绪（setInteractive API），命中盒逻辑由 TASK-012 实现
  setInteractive(mainWindow, false)

  // 6. 鼠标交互处理器：穿透/交互切换 + 抢占 + 拖拽 + 右键菜单 (§10)
  mouseHandler = new MouseHandler(
    mainWindow,
    {
      onHide: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (mainWindow.isVisible()) mainWindow.hide()
        else mainWindow.show()
      },
      onSettings: () => console.log('[input] settings'),
      onAbout: () => console.log('[input] about'),
      onFeed: () => {
        needsState = applyNeedDelta(needsState, { hunger: -40, happiness: 10 })
      },
      onToy: () => {
        needsState = applyNeedDelta(needsState, { happiness: 20, attention: 20, fatigue: 5 })
      },
    },
    { windowWidth: 400, spriteBaseY: 380 },
  )
  if (audioCoordinator) {
    mouseHandler.setAudioCoordinator(audioCoordinator)
  }

  // 防止窗口被关闭时退出（frameless 无关闭按钮，但 Alt+F4 可能触发）
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

app.whenReady().then(() => {
  // 注册导入向导 IPC 处理器 (§5.5)
  registerImportIpcHandlers()

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
  audioCoordinator?.dispose()
})

app.on('before-quit', () => {
  // 允许窗口真正关闭（解除 close → hide 拦截）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close')
    mainWindow.destroy()
  }
  tray?.destroy()
  mouseHandler?.dispose()
  audioCoordinator?.dispose()
})

app.on('window-all-closed', () => {
  // skipTaskbar 窗口被隐藏而非关闭，不会触发 window-all-closed；
  // 若确实所有窗口已关闭（如 destroy），则退出
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
