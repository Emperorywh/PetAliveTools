/**
 * 主进程入口 (main process entry)
 *
 * 负责引导 Electron 应用：创建透明宠物窗口、系统托盘、全局快捷键、
 * 屏幕管理器、设置面板，并处理生命周期事件。
 *
 * 运行于主进程。
 */

import { app, BrowserWindow, ipcMain, type Tray } from 'electron'
import {
  createPetWindow,
  createChromaPreviewWindow,
  createWalkCorrectionWindow,
  createImportWizardWindow,
  createSettingsWindow,
  setInteractive,
} from './window'
import { createTray } from './tray'
import {
  HotkeyManager,
  DisplayManager,
  SettingsStore,
  isAutoLaunchEnabled,
  setAutoLaunch,
} from './shell'
import { ScreenManager } from './screen'
import { registerImportIpcHandlers } from './pipeline/ipc-handlers'
import { MouseHandler } from './input/mouse-handler'
import { AudioCoordinator, type AudioPlayCommand } from './audio'
import type { RhythmConfig } from '../shared/types/behavior-config'
import type { ShellSettings } from '../shared/types/behavior-config'
import type { Personality } from '../shared/types/persona'
import type { NeedsState } from '../shared/types/needs-state'
import { applyNeedDelta } from './behavior/needs'
import { clampWindowX, groundedWindowY } from '../shared/spatial'

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

/** 窗口固定尺寸 (§6.1) */
const WINDOW_WIDTH = 400
const SPRITE_BASE_Y = 380

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let screenManager: ScreenManager | null = null
let displayManager: DisplayManager | null = null
let hotkeyManager: HotkeyManager | null = null
let settingsStore: SettingsStore | null = null
let mouseHandler: MouseHandler | null = null
let audioCoordinator: AudioCoordinator | null = null
let needsState: NeedsState = INITIAL_NEEDS

/**
 * 引导全部外壳组件。在 app ready 后调用。
 *
 * PETALIVE_VIEW=chroma-preview / walk-correction 时不启动宠物运行时，
 * 仅创建对应的入库管线工具窗口。
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

  // 0. 初始化设置存储 (§12.4)
  const configDir = app.getPath('userData')
  settingsStore = new SettingsStore(configDir)
  // load 是异步的但 IPC 处理器中有 ensureLoaded 兜底
  settingsStore.load().then(() => {
    // 应用持久化的 shell 设置
    const shell = settingsStore!.getShell()
    // 同步自启状态到系统 (§12.4)
    setAutoLaunch(shell.autoLaunch)
    // 同步音量到音频协调器
    audioCoordinator?.setVolume(shell.volume)
    audioCoordinator?.setAmbientFrequency(shell.ambientFrequency)
  })

  // 1. 创建透明置顶宠物窗口
  mainWindow = createPetWindow()

  // 2. 屏幕管理器：计算 workArea 与地面线，监听显示器变化（§7.1、§13）
  screenManager = new ScreenManager()
  const bounds = screenManager.init()
  console.log('[screen] workArea bounds:', bounds)

  // 3. 多显示器管理 (§6.4、§13)
  displayManager = new DisplayManager()
  displayManager.init(null)
  displayManager.onDisplayChange((event) => {
    console.log('[display] changed:', event)
    // 宠物回到可见区域 (§13)
    movePetToVisibleArea()
  })

  // 4. 系统托盘（§10、§12.4）
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
      onSettings: () => openSettings(),
      onAbout: () => console.log('[tray] about'),
    },
    audioCoordinator.isMuted,
  )

  // 5. 可配置全局快捷键：安全阀隐藏 (§10、§12.4)
  hotkeyManager = new HotkeyManager(() => mainWindow)
  settingsStore.load().then(() => {
    const shell = settingsStore!.getShell()
    const registered = hotkeyManager!.register(shell.hideHotkey)
    if (!registered) {
      console.warn(`[shortcut] failed to register ${shell.hideHotkey}`)
    }
  })

  // 6. 注册设置 IPC 处理器 (§12.4)
  registerSettingsIpc()

  // 7. 窗口默认 click-through（已在 createPetWindow 中设置）
  setInteractive(mainWindow, false)

  // 8. 鼠标交互处理器：穿透/交互切换 + 抢占 + 拖拽 + 右键菜单 (§10)
  mouseHandler = new MouseHandler(
    mainWindow,
    {
      onHide: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (mainWindow.isVisible()) mainWindow.hide()
        else mainWindow.show()
      },
      onSettings: () => openSettings(),
      onAbout: () => console.log('[input] about'),
      onFeed: () => {
        needsState = applyNeedDelta(needsState, { hunger: -40, happiness: 10 })
      },
      onToy: () => {
        needsState = applyNeedDelta(needsState, { happiness: 20, attention: 20, fatigue: 5 })
      },
    },
    { windowWidth: WINDOW_WIDTH, spriteBaseY: SPRITE_BASE_Y },
  )
  if (audioCoordinator) {
    mouseHandler.setAudioCoordinator(audioCoordinator)
  }

  // 防止窗口被关闭时退出
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

/**
 * 打开设置面板窗口 (§12.4)。
 * 如果已有打开的设置窗口则聚焦，否则创建新窗口。
 */
function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = createSettingsWindow()
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

/**
 * 将宠物窗口校正到当前显示器可见区域 (§13)。
 *
 * 在显示器变化时调用：重新计算地面线，钳制 x 坐标。
 */
function movePetToVisibleArea(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !displayManager) return
  const bounds = displayManager.getBounds()
  const currentX = mainWindow.getPosition()[0]
  const x = clampWindowX(bounds, currentX, WINDOW_WIDTH)
  const y = groundedWindowY(bounds.groundLine, SPRITE_BASE_Y)
  mainWindow.setPosition(Math.round(x), Math.round(y), false)
}

/**
 * 注册设置面板 IPC 处理器 (§12.4)。
 */
function registerSettingsIpc(): void {
  ipcMain.handle('settings:get-displays', () => {
    if (!displayManager) return []
    return displayManager.enumerate().map((d) => ({
      id: d.id,
      label: d.label,
      isPrimary: d.isPrimary,
      scaleFactor: d.scaleFactor,
    }))
  })

  ipcMain.handle('settings:get-shell', async () => {
    if (!settingsStore) return null
    await settingsStore.load()
    return settingsStore.getShell()
  })

  ipcMain.handle('settings:update-shell', async (_e, changes: Partial<ShellSettings>) => {
    if (!settingsStore) return null
    await settingsStore.load()
    const updated = await settingsStore.updateShell(changes)

    // 应用变更到运行时子系统
    if (changes.displayId !== undefined && displayManager) {
      displayManager.selectDisplay(changes.displayId)
      movePetToVisibleArea()
    }
    if (changes.volume !== undefined && audioCoordinator) {
      audioCoordinator.setVolume(changes.volume)
    }
    if (changes.ambientFrequency !== undefined && audioCoordinator) {
      audioCoordinator.setAmbientFrequency(changes.ambientFrequency)
    }
    if (changes.autoLaunch !== undefined) {
      setAutoLaunch(changes.autoLaunch)
    }
    if (changes.hideHotkey !== undefined && hotkeyManager) {
      const result = hotkeyManager.reregister(changes.hideHotkey)
      return { ...updated, hideHotkey: result.activeAccelerator }
    }
    return updated
  })

  ipcMain.handle('settings:get-personality', async () => {
    if (!settingsStore) return null
    await settingsStore.load()
    return settingsStore.getPersonality()
  })

  ipcMain.handle('settings:update-personality', async (_e, changes: Partial<Personality>) => {
    if (!settingsStore) return null
    await settingsStore.load()
    return settingsStore.updatePersonality(changes)
  })

  ipcMain.handle('settings:get-auto-launch', () => {
    return isAutoLaunchEnabled()
  })

  ipcMain.handle('settings:set-auto-launch', (_e, enabled: boolean) => {
    setAutoLaunch(enabled)
    return isAutoLaunchEnabled()
  })

  ipcMain.handle('settings:rebind-hotkey', async (_e, accelerator: string) => {
    if (!hotkeyManager || !settingsStore) {
      return { success: false, activeAccelerator: '' }
    }
    const result = hotkeyManager.reregister(accelerator)
    if (result.success) {
      await settingsStore.load()
      await settingsStore.updateShell({ hideHotkey: result.activeAccelerator! })
    }
    return { success: result.success, activeAccelerator: result.activeAccelerator ?? '' }
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
  hotkeyManager?.dispose()
  screenManager?.dispose()
  displayManager?.dispose()
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
