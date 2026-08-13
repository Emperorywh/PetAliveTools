/**
 * 主进程入口 (main process entry)
 *
 * 负责引导 Electron 应用：创建透明宠物窗口、系统托盘、全局快捷键、
 * 屏幕管理器、设置面板，并处理生命周期事件。
 *
 * 运行于主进程。
 */

import { app, BrowserWindow, ipcMain, dialog, type Tray } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import {
  createPetWindow,
  createChromaPreviewWindow,
  createWalkCorrectionWindow,
  createImportWizardWindow,
  createSettingsWindow,
  setInteractive,
} from './window'
import { createTray, rebuildTrayMenu } from './tray'
import {
  HotkeyManager,
  DisplayManager,
  SettingsStore,
  ProfileSwitcher,
  isAutoLaunchEnabled,
  setAutoLaunch,
  type FileDialogs,
  type TrayMenuCallbacks,
} from './shell'
import { ScreenManager } from './screen'
import { registerImportIpcHandlers } from './pipeline/ipc-handlers'
import { MouseHandler } from './input/mouse-handler'
import { AudioCoordinator, type AudioPlayCommand } from './audio'
import {
  ProfileManager,
  loadNeedsStateOrDefault,
  saveNeedsState,
  loadProject,
  isPlaceholderClip,
} from './persistence'
import { getProjectPaths } from './persistence/project-io'
import type { ProfileSummary } from './persistence'
import type { RhythmConfig } from '../shared/types/behavior-config'
import type { ShellSettings } from '../shared/types/behavior-config'
import type { Personality } from '../shared/types/persona'
import type { NeedsState } from '../shared/types/needs-state'
import type { ClipMeta } from '../shared/types/clip-meta'
import type { TrackFile } from '../shared/types/track-file'
import type { ProjectData } from '../shared/types/project'
import { applyNeedDelta, advanceNeeds, DEFAULT_NEED_RATES, needWeightModifiers, type NeedRates } from './behavior/needs'
import {
  personalityNeedRates,
  personalityWeightModifiers,
} from './behavior/personality'
import { currentHour, rhythmWeightModifiers, rhythmNeedRates, isNightTime } from './behavior/rhythm'
import { advanceOffline, computeOfflineSec } from './behavior/offline-progression'
import { BehaviorFsm } from './behavior/fsm'
import { createSeededRandom } from './behavior/transitions'
import { trackFileName, readTrackFile } from './pipeline/track-file'
import {
  ClipScheduler,
  type ClipSchedulerConfig,
  type ClipSchedulerDeps,
  type RenderCommand,
} from './scheduler/clip-scheduler'
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
let profileManager: ProfileManager | null = null
let profileSwitcher: ProfileSwitcher | null = null
let activeProfile: ProfileSummary | null = null
let needsState: NeedsState = INITIAL_NEEDS
let scheduler: ClipScheduler | null = null
let schedulerTimer: ReturnType<typeof setInterval> | null = null
let projectClips: readonly ClipMeta[] = []
let projectTracks: ReadonlyMap<string, TrackFile> = new Map()
let needRates: NeedRates = DEFAULT_NEED_RATES
let loopStartMs = 0
let lastTickMs = 0

/**
 * 引导全部外壳组件。在 app ready 后调用。
 *
 * PETALIVE_VIEW=chroma-preview / walk-correction 时不启动宠物运行时，
 * 仅创建对应的入库管线工具窗口。
 */
async function bootstrap(): Promise<void> {
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

  // 0. 初始化多宠物 profile 与设置存储 (§12.2、§12.4)
  //    pets 根目录下每个子目录是一个 §12.1 项目；设置随项目存储
  const userData = app.getPath('userData')
  profileManager = new ProfileManager(join(userData, 'pets'), join(userData, 'profiles.json'))
  await profileManager.ensureRoot()
  activeProfile = await profileManager.ensureActiveProfile()
  settingsStore = new SettingsStore(activeProfile.dir)
  await settingsStore.load()
  needsState = await loadNeedsStateOrDefault(activeProfile.dir)

  // Profile 切换器：托盘宠物管理操作与外壳运行时之间的桥梁 (§12.2、§12.3)
  profileSwitcher = new ProfileSwitcher(profileManager, createFileDialogs(), {
    onActiveProfileChanged: (profile) => {
      void handleActiveProfileChanged(profile)
    },
    onProfilesChanged: () => {
      void refreshTrayMenu()
    },
    onNotify: (message) => console.log('[profile]', message),
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

  // 4. 音频协调器（§11）：应用当前宠物的 shell 设置
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
  const shell0 = settingsStore.getShell()
  audioCoordinator.setVolume(shell0.volume)
  audioCoordinator.setAmbientFrequency(shell0.ambientFrequency)

  // 5. 系统托盘（§10、§12.2、§12.4）
  tray = createTray(trayCallbacks())
  await refreshTrayMenu()

  // 6. 可配置全局快捷键：安全阀隐藏 (§10、§12.4)
  hotkeyManager = new HotkeyManager(() => mainWindow)
  if (!hotkeyManager.register(settingsStore.getShell().hideHotkey)) {
    console.warn(`[shortcut] failed to register ${settingsStore.getShell().hideHotkey}`)
  }

  // 7. 注册设置 IPC 处理器 (§12.4)
  registerSettingsIpc()

  // 8. 窗口默认 click-through（已在 createPetWindow 中设置）
  setInteractive(mainWindow, false)

  // 9. 鼠标交互处理器：穿透/交互切换 + 抢占 + 拖拽 + 右键菜单 (§10)
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
        void persistNeedsState()
      },
      onToy: () => {
        needsState = applyNeedDelta(needsState, { happiness: 20, attention: 20, fatigue: 5 })
        void persistNeedsState()
      },
    },
    { windowWidth: WINDOW_WIDTH, spriteBaseY: SPRITE_BASE_Y },
  )
  if (audioCoordinator) {
    mouseHandler.setAudioCoordinator(audioCoordinator)
  }

  // 10. 初始化调度器：FSM → scheduler → renderer 完整运行时闭环 (§9)
  await initScheduler()

  // 防止窗口被关闭时退出
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

/** 托盘菜单回调（§10、§12.2、§12.3） */
function trayCallbacks(): TrayMenuCallbacks {
  return {
    onFeed: () => {
      audioCoordinator?.onActionTriggered('eat', null)
      needsState = applyNeedDelta(needsState, { hunger: -40, happiness: 10 })
      void persistNeedsState()
    },
    onToy: () => {
      audioCoordinator?.onActionTriggered('play', null)
      needsState = applyNeedDelta(needsState, { happiness: 20, attention: 20, fatigue: 5 })
      void persistNeedsState()
    },
    onToggleMute: async () => {
      const muted = audioCoordinator?.toggleMute() ?? false
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('audio:set-muted', muted)
      }
      await refreshTrayMenu()
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
    onSwitchProfile: (id) => {
      void profileSwitcher?.switchProfile(id)
    },
    onImportProfile: () => {
      void profileSwitcher?.importProfile()
    },
    onExportProfile: () => {
      void profileSwitcher?.exportActiveProfile()
    },
    onDeleteProfile: (id) => {
      void profileSwitcher?.deleteProfile(id)
    },
  }
}

/** 以当前 profile 列表与静音状态重建托盘菜单 (§12.2) */
async function refreshTrayMenu(): Promise<void> {
  if (!tray || !profileSwitcher) return
  const state = await profileSwitcher.getMenuState(audioCoordinator?.isMuted ?? false)
  rebuildTrayMenu(tray, state, trayCallbacks())
}

/** 将当前需求状态持久化到活跃宠物的项目目录 (§12.2 状态独立) */
async function persistNeedsState(): Promise<void> {
  if (!activeProfile) return
  try {
    await saveNeedsState(activeProfile.dir, needsState)
  } catch (err) {
    console.warn('[needs] failed to save needs-state:', err)
  }
}

// ── 调度器运行时 (§9 连接 FSM → scheduler → renderer) ── //

/** 循环片段默认播放时长 (ms)：idle/sleep/lie 等循环片段在调度器中持续的时间 */
const LOOP_CLIP_DURATION_MS = 8_000

/** 调度器 tick 间隔 (ms)：10fps 足以驱动调度决策 */
const SCHEDULER_TICK_MS = 100

/**
 * 合并多来源的权重倍率到统一 weightOverrides 格式 (§9.3/§9.4/§9.6)。
 *
 * 后面的来源叠加到前面的结果上（乘法复合）。
 */
function mergeWeightOverrides(
  ...sources: ReadonlyArray<Readonly<Record<string, Readonly<Record<string, number>>>>>
): Record<string, Record<string, number>> {
  const merged: Record<string, Record<string, number>> = {}
  for (const source of sources) {
    for (const [from, targets] of Object.entries(source)) {
      for (const [to, mult] of Object.entries(targets)) {
        if (!merged[from]) merged[from] = {}
        merged[from][to] = (merged[from][to] ?? 1) * mult
      }
    }
  }
  return merged
}

/**
 * 构造片段时长解析器 (§5.4 loopOutSec / track frameCount)。
 */
function makeClipDurationResolver(
  clips: readonly ClipMeta[],
  tracks: ReadonlyMap<string, TrackFile>,
): (clipId: string) => number {
  return (clipId: string): number => {
    const clip = clips.find((c) => c.id === clipId)
    if (!clip) return 3
    if (clip.loop && clip.loopOutSec != null && clip.loopInSec != null) {
      return clip.loopOutSec - clip.loopInSec
    }
    const track = tracks.get(clipId)
    if (track) return track.frameCount / track.fps
    return 3
  }
}

/**
 * 初始化调度器 (§9)：
 * 加载项目素材 → 离线推进需求 → 构建 FSM + scheduler → 启动 tick 循环。
 *
 * 在 bootstrap() 末尾和 profile 切换时调用。
 */
async function initScheduler(): Promise<void> {
  if (!activeProfile || !displayManager) return

  try {
    const data = await loadProject(activeProfile.dir)
    await rebuildScheduler(data)
  } catch (err) {
    console.error('[scheduler] init failed, showing guidance:', err)
    projectClips = []
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scheduler:guidance')
    }
  }
}

/**
 * 用加载的项目数据重建调度器 (§9)。
 *
 * 加载 track 文件 → 应用离线推进 → 合并权重倍率 → 创建 FSM + scheduler → 注入 mouseHandler。
 * 调度器替换后，tick 循环在下一个 interval 自动使用新实例。
 */
async function rebuildScheduler(data: ProjectData): Promise<void> {
  if (!displayManager) return

  projectClips = data.clips

  // 加载行走片段位移曲线 (§5.3)
  const clipsDir = join(activeProfile!.dir, 'clips')
  const tracksMap = new Map<string, TrackFile>()
  for (const clip of projectClips) {
    if (clip.track) {
      try {
        tracksMap.set(clip.id, await readTrackFile(clipsDir, trackFileName(clip.id)))
      } catch {
        /* 缺失 track 文件可忽略，行走片段会被占位兜底 */
      }
    }
  }
  projectTracks = tracksMap

  // 离线推进 (§9.4)：用 needs-state.json 的 mtime 计算离线时长
  const personality = data.persona.personality
  needRates = personalityNeedRates(personality)
  needsState = data.needsState
  try {
    const paths = getProjectPaths(activeProfile!.dir)
    const stat = await fs.stat(paths.needsState)
    const offlineSec = computeOfflineSec(stat.mtimeMs, Date.now())
    needsState = advanceOffline(needsState, offlineSec, needRates)
  } catch {
    /* mtime 不可用时使用原始状态 */
  }

  // 合并权重倍率：behavior-config → 性格 → 节律 → 需求 (§9.3/§9.4/§9.6)
  const hour = currentHour()
  const rhythmConfig = data.behaviorConfig.rhythm
  const isNight = isNightTime(hour, rhythmConfig)
  const weightOverrides = mergeWeightOverrides(
    data.behaviorConfig.weightOverrides,
    personalityWeightModifiers(personality),
    rhythmWeightModifiers(isNight, rhythmConfig),
    needWeightModifiers(needsState),
  )

  // 夜间需求速率调制 (§9.3 疲劳夜间上升)
  needRates = rhythmNeedRates(isNight, needRates)

  const fsmConfig = { ...data.behaviorConfig, weightOverrides }
  const fsm = new BehaviorFsm({ config: fsmConfig, rng: createSeededRandom(Date.now()) })

  const bounds = displayManager.getBounds()
  const deps: ClipSchedulerDeps = {
    fsm,
    clips: projectClips,
    tracks: projectTracks,
    getClipDurationSec: makeClipDurationResolver(projectClips, projectTracks),
  }

  const config: ClipSchedulerConfig = {
    symmetrical: data.persona.symmetrical,
    workArea: bounds,
    windowWidth: WINDOW_WIDTH,
    spriteBaseY: SPRITE_BASE_Y,
    displayedWidthPx: 200,
    idleConfig: {
      idleIntervalMs: 8_000,
      activeIntervalMs: 3_000,
      exhaustionMultiplier: 1.5,
      exhaustionThreshold: 3,
    },
    planOptions: {},
    rng: createSeededRandom(Date.now() + 1),
  }

  scheduler = new ClipScheduler(deps, config)

  // 注入 mouseHandler 以支持交互抢占 (§10)
  if (mouseHandler) {
    mouseHandler.setScheduler(scheduler)
  }

  // 启动 tick 循环
  startSchedulerTick()

  // §13 素材库为空：弹引导，不崩溃
  const hasRealClips = projectClips.length > 0 && projectClips.some((c) => !isPlaceholderClip(c))
  if (!hasRealClips) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scheduler:guidance')
    }
  }
}

/**
 * 启动调度器 tick 循环 (§9)。
 *
 * 每个 tick：推进需求 → 处理循环完成 → 推进调度器 → 分发渲染命令。
 * 循环片段在 LOOP_CLIP_DURATION_MS 后通知调度器完成。
 */
function startSchedulerTick(): void {
  if (schedulerTimer) return
  lastTickMs = Date.now()
  schedulerTimer = setInterval(() => {
    if (!scheduler) return
    const nowMs = Date.now()
    const elapsedSec = (nowMs - lastTickMs) / 1000
    lastTickMs = nowMs

    // 推进需求 (§9.4)
    needsState = advanceNeeds(needsState, elapsedSec, needRates)

    // 循环片段超时后通知完成 (§9.5 变体轮换)
    if (scheduler.isPlayingLoop && loopStartMs > 0 && nowMs >= loopStartMs + LOOP_CLIP_DURATION_MS) {
      const completeResult = scheduler.completeCurrentPlayback(nowMs)
      processSchedulerCommands(completeResult.commands)
      loopStartMs = 0
    }

    // 推进调度器
    const result = scheduler.tick(nowMs)
    processSchedulerCommands(result.commands)

    // 记录循环片段开始时间
    for (const cmd of result.commands) {
      if ((cmd.kind === 'play' || cmd.kind === 'fade_in') && cmd.clip?.loop) {
        loopStartMs = nowMs
      }
    }
  }, SCHEDULER_TICK_MS)
}

/**
 * 将调度器渲染命令分发到窗口/渲染进程 (§9 scheduler → renderer)。
 *
 * - play/fade_in：发送片段 file URL 给渲染进程
 * - update_position：直接移动窗口 (§7.2)
 * - idle/hold/easing/fade_out：无需 IPC（调度器内部时序控制）
 */
function processSchedulerCommands(commands: readonly RenderCommand[]): void {
  if (!mainWindow || mainWindow.isDestroyed() || !activeProfile) return

  for (const cmd of commands) {
    switch (cmd.kind) {
      case 'play':
      case 'fade_in': {
        if (isPlaceholderClip(cmd.clip)) break
        const clipFile = join(activeProfile.dir, 'clips', `${cmd.clip.id}.webm`)
        const clipUrl = pathToFileURL(clipFile).href
        mainWindow.webContents.send(
          'scheduler:play',
          clipUrl,
          cmd.mirrored,
          cmd.clip.loop,
        )
        break
      }
      case 'update_position':
        mainWindow.setPosition(Math.round(cmd.x), Math.round(cmd.y), false)
        break
      // idle / hold / easing / fade_out — 调度器内部时序控制，无需 IPC
    }
  }
}

/** 停止调度器 tick 循环 */
function stopSchedulerTick(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
}

/**
 * 活跃宠物变化处理 (§12.2)：
 * 保存旧宠物需求状态 → 加载新宠物项目数据 → 重建设置存储 → 通知渲染进程。
 */
async function handleActiveProfileChanged(profile: ProfileSummary | null): Promise<void> {
  // 1. 保存旧宠物的需求状态（切换后互不影响）
  await persistNeedsState()
  activeProfile = profile

  if (profile === null) {
    needsState = INITIAL_NEEDS
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
    await refreshTrayMenu()
    return
  }

  // 2. 加载选中宠物的项目数据（persona / needs / clips / audio）并重建调度器
  try {
    const data = await loadProject(profile.dir)
    console.log(
      `[profile] active="${profile.name}" clips=${data.clips.length} audio=${data.audio.length}`,
    )
    await rebuildScheduler(data)
  } catch (err) {
    console.warn(`[profile] invalid project "${profile.id}", using defaults:`, err)
    needsState = await loadNeedsStateOrDefault(profile.dir)
    scheduler = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scheduler:guidance')
    }
  }

  // 3. 设置存储指向新宠物项目目录（persona/behavior-config 为项目内文件 §12.1）
  settingsStore = new SettingsStore(profile.dir)
  await settingsStore.load()
  const shell = settingsStore.getShell()
  setAutoLaunch(shell.autoLaunch)
  audioCoordinator?.setVolume(shell.volume)
  audioCoordinator?.setAmbientFrequency(shell.ambientFrequency)
  if (hotkeyManager) {
    hotkeyManager.reregister(shell.hideHotkey)
  }

  // 4. 设置面板展示的是旧宠物数据，切换后关闭
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close()
  }

  // 5. 通知渲染进程宠物已切换
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('profile:switched', profile.id, profile.name)
  }

  await refreshTrayMenu()
}

/** 导入/导出用文件对话框 (§12.3) */
function createFileDialogs(): FileDialogs {
  return {
    showSaveZipDialog: async (defaultPath) => {
      const result = await dialog.showSaveDialog({
        title: '导出宠物项目',
        defaultPath,
        filters: [{ name: 'ZIP 归档', extensions: ['zip'] }],
      })
      return result.canceled || !result.filePath ? null : result.filePath
    },
    showOpenZipDialog: async () => {
      const result = await dialog.showOpenDialog({
        title: '导入宠物项目',
        properties: ['openFile'],
        filters: [{ name: 'ZIP 归档', extensions: ['zip'] }],
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
    },
  }
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

  bootstrap().catch((err) => console.error('[bootstrap] failed:', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootstrap().catch((err) => console.error('[bootstrap] failed:', err))
    }
  })
})

app.on('will-quit', () => {
  stopSchedulerTick()
  hotkeyManager?.dispose()
  screenManager?.dispose()
  displayManager?.dispose()
  audioCoordinator?.dispose()
})

app.on('before-quit', () => {
  // 保存当前宠物的需求状态（§12.2 跨会话持久化）
  void persistNeedsState()

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
