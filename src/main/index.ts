/**
 * 主进程入口 (main process entry)
 *
 * 负责引导 Electron 应用：创建透明宠物窗口、系统托盘、全局快捷键、
 * 屏幕管理器、设置面板，并处理生命周期事件。
 *
 * 运行于主进程。
 */

import { app, BrowserWindow, ipcMain, dialog, session, type Tray } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import {
  createPetWindow,
  createImportWizardWindow,
  createSettingsWindow,
  setInteractive,
} from './window'
import { createTray } from './tray'
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
import { registerDirectImportIpcHandlers } from './direct-import-handlers'
import { registerMediaScheme, handleMediaProtocol } from './media-protocol'
import { localPathToMediaUrl } from '../shared/media-url'
import { clipFromFileName } from '../shared/direct-media'
import { MouseHandler } from './input/mouse-handler'
import { closeContextMenu, showTrayMenu } from './input/context-menu'
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
import type { BehaviorConfig, ShellSettings } from '../shared/types/behavior-config'
import type { Personality } from '../shared/types/persona'
import type { NeedsState } from '../shared/types/needs-state'
import type { ClipMeta } from '../shared/types/clip-meta'
import type { ProjectData } from '../shared/types/project'
import {
  applyNeedDelta,
  advanceNeeds,
  DEFAULT_NEED_RATES,
  needWeightModifiers,
  sleepingNeedRates,
  type NeedRates,
} from './behavior/needs'
import {
  personalityNeedRates,
  personalityWeightModifiers,
} from './behavior/personality'
import { currentHour, rhythmWeightModifiers, rhythmNeedRates, isNightTime } from './behavior/rhythm'
import { advanceOffline, computeOfflineSec } from './behavior/offline-progression'
import { BehaviorFsm } from './behavior/fsm'
import { createSeededRandom } from './behavior/transitions'
import {
  ClipScheduler,
  type ClipSchedulerConfig,
  type ClipSchedulerDeps,
  type RenderCommand,
} from './scheduler/clip-scheduler'
import { WalkController } from './scheduler/walk-controller'
import { currentItem } from './scheduler/lifecycle'
import { SCHEDULER_IPC, SchedulerCommandDispatcher } from './dispatch/scheduler-dispatcher'
import { clampWindowX, groundedWindowY } from '../shared/spatial'
import { defaultHitboxPx } from '../shared/input'

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
const WINDOW_HEIGHT = 400
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
let commandDispatcher: SchedulerCommandDispatcher | null = null
let walkController: WalkController | null = null
/** 用户拖拽期间为 true：行走位移暂停，拖拽结束后恢复 */
let userDragging = false
let projectClips: readonly ClipMeta[] = []
let needRates: NeedRates = DEFAULT_NEED_RATES
let loopStartMs = 0
let lastTickMs = 0
/** IR-007 权重热更新：当前项目的行为配置与性格（rebuildScheduler 时缓存） */
let currentBehaviorConfig: BehaviorConfig | null = null
let currentPersonality: Personality | null = null
let lastWeightRefreshMs = 0
/** 渲染层就绪握手：宠物视图注册完调度监听器后为 true，此前不下发调度命令 */
let rendererReady = false
/** 渲染层就绪前需要补发的空素材引导（§13） */
let guidancePending = false

/**
 * 引导全部外壳组件。在 app ready 后调用。
 *
 * PETALIVE_VIEW=import-wizard 时只创建原样片段导入窗口。
 * 已不存在任何视频处理工具视图。
 */
async function bootstrap(): Promise<void> {
  // 会话级关闭内置拼写检查：应用无文本编辑场景。Chromium 的拼写词典
  // 下载器在 profile 初始化时即会请求 gvt1.com（早于任何 JS 拦截时机），
  // 该域名在部分网络握手失败并反复输出 SSL 错误日志；彻底消除需在
  // userData/Dictionaries 预置 en-US-10-1.bdic，详见 docs/VERIFICATION.md
  session.defaultSession.setSpellCheckerEnabled(false)

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
      // 自定义托盘菜单按打开时状态生成，profile 列表变化无需刷新
    },
    onNotify: (message) => console.log('[profile]', message),
  })

  // 0.5 渲染层就绪握手：宠物视图注册完监听器后通知主进程。
  // 必须早于窗口创建注册——首个 play 指令与页面加载存在竞态，
  // 早于监听器注册的 IPC 会被静默丢弃，宠物窗口将永远透明 (§13)。
  // dev 整页重载会再次触发：补发当前片段即可恢复画面。
  ipcMain.on(SCHEDULER_IPC.rendererReady, () => {
    rendererReady = true
    if (guidancePending) {
      guidancePending = false
      mainWindow?.webContents.send(SCHEDULER_IPC.guidance)
    } else {
      commandDispatcher?.replayToRenderer()
    }
    startSchedulerTick()
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

  // 3.5 启动时贴近底部 (§7.3：启动或显示器工作区变化时约束到可见区域并贴近底部)
  movePetToVisibleArea()

  // 3.7 行走位移控制器 (§7.3 行走移动)：walk 片段播放期间按墙钟恒速平移窗口
  walkController = new WalkController({
    getWindow: () => mainWindow,
    getWorkArea: () => {
      const bounds = displayManager?.getBounds()
      return bounds ?? { x: 0, y: 0, width: 0, height: 0 }
    },
    // 边缘钳制按精灵可见范围（与拖拽放置同口径），不按窗口矩形
    getSpriteBounds: () => defaultHitboxPx(WINDOW_WIDTH, WINDOW_HEIGHT),
  })

  // 3.6 可见性变化不再需要刷新托盘：自定义菜单按打开时状态生成

  // 4. 音频协调器（§11）：音频库在 rebuildScheduler 中注入 (§11.1)
  audioCoordinator = new AudioCoordinator(
    [],
    { rhythmConfig: DEFAULT_RHYTHM },
    (cmd: AudioPlayCommand) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (cmd.kind === 'play') {
          // 将文件名解析为项目 audio/ 目录的 petmedia:// URL
          // （dev http 源无法加载 file://，统一走特权媒体协议）
          const audioFile = activeProfile
            ? localPathToMediaUrl(join(activeProfile.dir, 'audio', cmd.file))
            : cmd.file
          mainWindow.webContents.send('audio:play', audioFile, cmd.volume)
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

  // 4.5 调度命令分发器 (IR-001/IR-003/IR-009)：tick 循环与交互抢占共用同一分发链路
  commandDispatcher = new SchedulerCommandDispatcher({
    getWindow: () => mainWindow,
    getProjectDir: () => activeProfile?.dir ?? null,
    onActionAudio: (state, clip) => audioCoordinator?.onActionTriggered(state, clip),
    onEmbeddedAudioEnded: () => audioCoordinator?.onEmbeddedAudioEnded(),
  })

  /**
   * 非循环视频自然结束时推进播放队列。
   * 只使用 ended 事件，不读取 currentTime 或计算窗口位移。
   */
  ipcMain.on('scheduler:clip-ended', (_event, clipId: string) => {
    const current = scheduler?.snapshot.cycle
    if (!scheduler || !current || current.queue.completed) return
    const activeItem = current.queue.items[current.queue.currentIndex]
    if (activeItem?.kind !== 'play' || activeItem.clip?.id !== clipId) return
    const result = scheduler.completeCurrentPlayback(Date.now())
    processSchedulerCommands(result.commands)
  })

  // 5. 系统托盘（§10、§12.2、§12.4）：右键弹出自定义菜单
  tray = createTray(trayCallbacks())

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
      onImportWizard: () => openImportWizard(),
      onFeed: () => {
        needsState = applyNeedDelta(needsState, { hunger: -40, happiness: 10 })
        void persistNeedsState()
        refreshBehaviorWeights()
      },
      onToy: () => {
        needsState = applyNeedDelta(needsState, { happiness: 20, attention: 20, fatigue: 5 })
        void persistNeedsState()
        refreshBehaviorWeights()
      },
      onDrink: () => {
        // 喂水：需求模型无口渴维度，按轻度缓解饥饿 + 愉悦小幅上升处理
        needsState = applyNeedDelta(needsState, { hunger: -10, happiness: 5 })
        void persistNeedsState()
        refreshBehaviorWeights()
      },
      // 用户拖拽不切换片段：仅暂停/恢复行走位移，避免窗口在被拖动时自主移动
      onUserDragStart: () => {
        userDragging = true
        walkController?.stop()
      },
      onUserDragEnd: () => {
        userDragging = false
        syncWalkMotion()
      },
    },
    { windowWidth: WINDOW_WIDTH, windowHeight: WINDOW_HEIGHT },
  )
  if (audioCoordinator) {
    mouseHandler.setAudioCoordinator(audioCoordinator)
  }
  // IR-001：抢占产生的渲染命令与 tick 循环走同一分发链路
  mouseHandler.setCommandDispatcher((commands) => processSchedulerCommands(commands))

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
      // 喂食 → 讨食片段（D 类），需求饥饿↓愉悦↑；无片段时仅需求生效
      preemptAction('beg_food')
      needsState = applyNeedDelta(needsState, { hunger: -40, happiness: 10 })
      void persistNeedsState()
      refreshBehaviorWeights()
    },
    onToy: () => {
      // 给玩具 → 求玩片段（D 类），需求愉悦↑注意力↑
      preemptAction('want_play')
      needsState = applyNeedDelta(needsState, { happiness: 20, attention: 20, fatigue: 5 })
      void persistNeedsState()
      refreshBehaviorWeights()
    },
    onDrink: () => {
      // 喂水 → 喝水片段（D 类）；需求模型无口渴维度，轻度缓解饥饿
      preemptAction('drink')
      needsState = applyNeedDelta(needsState, { hunger: -10, happiness: 5 })
      void persistNeedsState()
      refreshBehaviorWeights()
    },
    onCall: () => {
      // 呼唤宠物 → 被呼唤转身片段（B 类）
      preemptAction('called')
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
    onImportWizard: () => {
      openImportWizard()
    },
    onQuit: () => {
      app.quit()
    },
    onOpenMenu: () => {
      void openTrayMenu()
    },
  }
}

/**
 * 收集托盘菜单状态并弹出自定义菜单窗口（§10、§12.2）。
 * 状态按打开时快照生成：profile 列表、活跃项、静音、宠物可见性。
 */
async function openTrayMenu(): Promise<void> {
  if (!profileSwitcher) return
  const isPetVisible = mainWindow?.isVisible() ?? false
  const state = await profileSwitcher.getMenuState(audioCoordinator?.isMuted ?? false, isPetVisible)
  showTrayMenu(state, trayCallbacks())
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

/** FSM 权重热更新周期 (ms, IR-007)：需求/节律漂移最多 60s 内生效 */
const WEIGHT_REFRESH_MS = 60_000

/**
 * 需求/节律权重热更新 (§9.3/§9.4, IR-007)。
 *
 * 用当前 needsState 与当前小时重算 weightOverrides 并热更新 FSM 配置，
 * 同时刷新夜间需求速率调制。会话内"饿了更想讨食""入夜更想睡"实时生效，
 * 无需重建调度器（不打断当前调度周期）。
 */
function refreshBehaviorWeights(): void {
  if (!scheduler || !currentBehaviorConfig || !currentPersonality) return
  const hour = currentHour()
  const rhythmConfig = currentBehaviorConfig.rhythm
  const isNight = isNightTime(hour, rhythmConfig)
  const weightOverrides = mergeWeightOverrides(
    currentBehaviorConfig.weightOverrides,
    personalityWeightModifiers(currentPersonality),
    rhythmWeightModifiers(isNight, rhythmConfig),
    needWeightModifiers(needsState),
  )
  scheduler.updateFsmConfig({ ...currentBehaviorConfig, weightOverrides })
  // 夜间疲劳累积速率调制同步刷新 (§9.3)
  needRates = rhythmNeedRates(isNight, personalityNeedRates(currentPersonality))
  lastWeightRefreshMs = Date.now()
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
    sendGuidanceToRenderer()
  }
}

/**
 * 向宠物视图发送空素材引导；渲染层未就绪时挂起，就绪握手时补发。
 * webContents.send 不缓冲消息，直接发送会重蹈启动竞态 (§13)。
 */
function sendGuidanceToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!rendererReady) {
    guidancePending = true
    return
  }
  mainWindow.webContents.send(SCHEDULER_IPC.guidance)
}

/**
 * 用加载的项目数据重建调度器 (§9)。
 *
 * 应用离线推进 → 合并权重倍率 → 创建 FSM + scheduler → 注入 mouseHandler。
 * 片段已经由 loadProject 直接从 clips/ 扫描，不加载轨迹或媒体元数据。
 * 调度器替换后，tick 循环在下一个 interval 自动使用新实例。
 */
async function rebuildScheduler(data: ProjectData): Promise<void> {
  if (!displayManager) return

  // 换宠物/重建调度器时终止进行中的行走位移
  walkController?.stop()

  projectClips = data.clips

  // 注入音频素材库 (§11.1)：在 bootstrap 与 profile 切换时把 loadProject 得到的 AudioMeta[] 注入协调器
  audioCoordinator?.setLibrary(data.audio)

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

  // IR-007：缓存行为配置与性格，供运行中权重热更新
  currentBehaviorConfig = data.behaviorConfig
  currentPersonality = personality
  lastWeightRefreshMs = Date.now()

  // 夜间需求速率调制 (§9.3 疲劳夜间上升)
  needRates = rhythmNeedRates(isNight, needRates)

  // IR-015：音频昼夜节律与 FSM 使用同一份项目配置（替换构造期硬编码）
  audioCoordinator?.setRhythmConfig(rhythmConfig)

  const fsmConfig = { ...data.behaviorConfig, weightOverrides }
  const fsm = new BehaviorFsm({ config: fsmConfig, rng: createSeededRandom(Date.now()) })

  const deps: ClipSchedulerDeps = {
    fsm,
    clips: projectClips,
  }

  // §9.5 稀有动作候选 (IR-006)：招牌片段 (§4.4 C) 的状态集合
  const rareActions = [
    ...new Set(projectClips.filter((c) => c.signature && !isPlaceholderClip(c)).map((c) => c.state)),
  ]

  const config: ClipSchedulerConfig = {
    idleConfig: {
      idleIntervalMs: 8_000,
      activeIntervalMs: 3_000,
      exhaustionMultiplier: 1.5,
      exhaustionThreshold: 3,
    },
    planOptions: {},
    rng: createSeededRandom(Date.now() + 1),
    // §9.5 调度微随机化 (IR-006)：速率抖动 / 静止时长抖动 / 位置 x 抖动 / 变体洗牌 / 稀有动作
    microRandom: data.behaviorConfig.microRandom,
    personality,
    rareActions,
    // §9.4 情绪表达：需求高位/低位时插入讨食/喝水/开心/无聊/求玩片段
    needsProvider: () => needsState,
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
    sendGuidanceToRenderer()
  }
}

/**
 * 启动调度器 tick 循环 (§9)。
 *
 * 每个 tick：推进需求 → 处理循环完成 → 推进调度器 → 分发渲染命令。
 * 循环片段在 LOOP_CLIP_DURATION_MS 后通知调度器完成。
 * 渲染层就绪握手完成前不启动：首个播放指令不得早于监听器注册。
 */
function startSchedulerTick(): void {
  if (schedulerTimer || !rendererReady) return
  lastTickMs = Date.now()
  schedulerTimer = setInterval(() => {
    if (!scheduler) return
    const nowMs = Date.now()
    const elapsedSec = (nowMs - lastTickMs) / 1000
    lastTickMs = nowMs

    // 推进需求 (§9.4)：FSM 处于睡眠态时疲劳改为恢复（睡眠是疲劳唯一恢复路径）
    const sleeping = scheduler.snapshot.fsmState === 'sleep'
    needsState = advanceNeeds(
      needsState,
      elapsedSec,
      sleeping ? sleepingNeedRates(needRates) : needRates,
    )

    // 需求/节律权重热更新 (IR-007)：周期漂移 ≤60s 内反映到 FSM 权重
    if (nowMs - lastWeightRefreshMs >= WEIGHT_REFRESH_MS) {
      refreshBehaviorWeights()
    }

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
 * 统一委托给 SchedulerCommandDispatcher（IR-001：tick 循环与交互抢占共用）：
 * - play/fade_in/fade_out/easing → 最小播放载荷 IPC
 * - idle → 锚定片段保活重播
 * - play 携带真实片段触发动作声
 *
 * 渲染载荷不包含窗口坐标；行走位移由主进程的 WalkController
 * 按墙钟恒速执行（§7.3），不依赖媒体时间。
 */
function processSchedulerCommands(commands: readonly RenderCommand[]): void {
  commandDispatcher?.dispatch(commands)
  syncWalkMotion()
}

/**
 * 同步行走位移 (§7.3 行走移动)：调度器当前正在播放 walk 片段时
 * 按片段方向（无方向标记时用朝向记忆）恒速平移窗口，否则停止。
 * 每次命令分发后调用；周期完成或用户拖拽期间位移停止。
 * 用户拖拽结束后由 onUserDragEnd 再次调用以恢复行走。
 */
function syncWalkMotion(): void {
  if (!walkController) return
  if (userDragging) {
    walkController.stop()
    return
  }
  const snap = scheduler?.snapshot
  const item = snap?.cycle ? currentItem(snap.cycle.queue) : null
  const walkClip = item?.kind === 'play' ? item.clip : null
  if (walkClip && walkClip.state === 'walk') {
    walkController.start(walkClip.direction !== 'none' ? walkClip.direction : snap!.facing)
  } else {
    walkController.stop()
  }
}

/**
 * 以交互抢占方式触发一个动作状态（托盘/菜单/需求反应入口共用）。
 * 播放命令走与 tick 循环相同的分发链路；循环目标片段记录轮换起点。
 */
function preemptAction(state: string): void {
  if (!scheduler) return
  const nowMs = Date.now()
  const result = scheduler.preempt(state, nowMs)
  processSchedulerCommands(result.commands)
  audioCoordinator?.onActionTriggered(state, result.state.cycle?.targetClip ?? null)
  for (const cmd of result.commands) {
    if ((cmd.kind === 'play' || cmd.kind === 'fade_in') && cmd.clip?.loop) {
      loopStartMs = nowMs
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
 * 导入向导的桌面调试预览：让宠物按运行时链路播放指定片段。
 * 经调度器抢占（与交互抢占同一分发链路），非循环片段由 ended 事件
 * 自然推进，循环片段受整段循环停留时长约束，结束后均回锚定态。
 * 返回用户可读的错误消息；成功时返回 null。
 */
function previewClipOnDesktop(projectDir: string, fileName: string): string | null {
  if (!activeProfile || projectDir !== activeProfile.dir) {
    return '桌面预览只支持当前活跃宠物的项目，请先在托盘菜单中切换宠物'
  }
  if (!scheduler || !mainWindow || mainWindow.isDestroyed()) {
    return '宠物调度器尚未运行，无法在桌面预览'
  }
  const clip = clipFromFileName(fileName)
  if (!clip) return `该文件不是可识别的导入片段: ${fileName}`

  // 宠物可能被安全阀/托盘隐藏，预览前确保可见
  if (!mainWindow.isVisible()) mainWindow.show()

  const nowMs = Date.now()
  const result = scheduler.preemptClip(clip, nowMs)
  processSchedulerCommands(result.commands)
  for (const cmd of result.commands) {
    if ((cmd.kind === 'play' || cmd.kind === 'fade_in') && cmd.clip?.loop) {
      loopStartMs = nowMs
    }
  }
  return null
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
    sendGuidanceToRenderer()
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

/** 导入向导窗口引用 */
let importWizardWindow: BrowserWindow | null = null

/**
 * 打开清单引导式导入向导窗口 (§5.5)。
 * 导入向导默认指向活跃宠物目录。
 */
function openImportWizard(): void {
  if (importWizardWindow && !importWizardWindow.isDestroyed()) {
    importWizardWindow.focus()
    return
  }
  importWizardWindow = createImportWizardWindow()
  importWizardWindow.on('closed', () => {
    importWizardWindow = null
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
    const updated = await settingsStore.updatePersonality(changes)
    // 性格改变后重建调度器，使 weightOverrides/needRates 立即生效 (§9.6)
    // 无需重启或切换 profile 即可感知行为分布变化
    // 先持久化当前 needsState（内存中已推进），避免重建时从磁盘读取旧值并重复离线推进
    await persistNeedsState()
    await initScheduler()
    return updated
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

// 单实例锁：共享同一 userData 的第二个实例（dev 与安装版同源）不重复
// 创建宠物窗口与托盘，而是唤起已有窗口后自行退出；避免调度器、
// 快捷键注册与缓存目录互相冲突
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  })
} else {
  app.quit()
}

// 特权媒体协议声明须在 app ready 前完成
registerMediaScheme()

app.whenReady().then(() => {
  // 未取得单实例锁：app.quit() 已在途，不再引导任何窗口
  if (!gotSingleInstanceLock) return

  // 本地媒体 petmedia:// → 文件映射（导入向导/宠物窗口的 <video>/<audio>）
  handleMediaProtocol()

  /**
   * 注册原样片段复制入口。
   * 活跃项目复制完成后只重新扫描 clips/，不会启动媒体处理任务。
   */
  registerDirectImportIpcHandlers({
    onClipImported: (projectDir) => {
      if (activeProfile && projectDir === activeProfile.dir) {
        void initScheduler()
      }
    },
    getDefaultProjectDir: () => activeProfile?.dir ?? null,
    previewClip: previewClipOnDesktop,
  })

  bootstrap().catch((err) => console.error('[bootstrap] failed:', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootstrap().catch((err) => console.error('[bootstrap] failed:', err))
    }
  })
})

app.on('will-quit', () => {
  stopSchedulerTick()
  walkController?.dispose()
  hotkeyManager?.dispose()
  screenManager?.dispose()
  displayManager?.dispose()
  audioCoordinator?.dispose()
  closeContextMenu()
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
