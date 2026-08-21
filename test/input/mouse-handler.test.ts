import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

// —— electron 与窗口/菜单模块 mock（node 环境下无真实 electron 运行时） —— //

const ipcOnHandlers = new Map<string, (...args: unknown[]) => void>()

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, fn: (...args: unknown[]) => void) => {
      ipcOnHandlers.set(channel, fn)
    }),
    removeAllListeners: vi.fn(),
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    getDisplayNearestPoint: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }),
  },
}))

vi.mock('../../src/main/window', () => ({ setInteractive: vi.fn() }))
vi.mock('../../src/main/input/context-menu', () => ({ showContextMenu: vi.fn() }))

import { MouseHandler } from '../../src/main/input/mouse-handler'
import { showContextMenu } from '../../src/main/input/context-menu'
import type { ContextMenuCallbacks } from '../../src/main/input/context-menu'
import {
  ClipScheduler,
  type ClipSchedulerConfig,
  type ClipSchedulerDeps,
} from '../../src/main/scheduler/clip-scheduler'
import { SchedulerCommandDispatcher } from '../../src/main/dispatch/scheduler-dispatcher'
import { BehaviorFsm } from '../../src/main/behavior/fsm'
import { createSeededRandom } from '../../src/main/behavior/transitions'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { PlayClipPayload } from '../../src/shared/types/play-command'

// —— 测试辅助 —— //

function clip(overrides: Partial<ClipMeta> & Pick<ClipMeta, 'id' | 'state'>): ClipMeta {
  return {
    fileName: `${overrides.id}.webm`,
    category: 'basic',
    direction: 'none',
    anchor: 'sit',
    loop: false,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: false,
    audio: null,
    hitbox: [0.1, 0.05, 0.8, 0.9],
    ...overrides,
  }
}

function makeFakeWindow() {
  const send = vi.fn()
  const win = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 500, y: 600, width: 400, height: 400 }),
    setPosition: vi.fn(),
    webContents: { send },
  } as unknown as BrowserWindow
  return { win, send }
}

function makeScheduler(clips: ClipMeta[]): ClipScheduler {
  const deps: ClipSchedulerDeps = {
    fsm: new BehaviorFsm({ rng: createSeededRandom(42) }),
    clips,
  }
  const config: ClipSchedulerConfig = {
    idleConfig: {
      idleIntervalMs: 8_000,
      activeIntervalMs: 3_000,
      exhaustionMultiplier: 1.5,
      exhaustionThreshold: 3,
    },
    planOptions: {},
    rng: createSeededRandom(43),
  }
  return new ClipScheduler(deps, config)
}

const CLIPS: ClipMeta[] = [
  clip({ id: 'idle_sit_01', state: 'idle_sit', loop: true }),
  clip({ id: 'called_01', state: 'called', category: 'interactive' }),
  clip({ id: 'drink_01', state: 'drink', category: 'interactive' }),
]

/** 通过右键菜单回调驱动显式动作抢占（鼠标交互本身不再抢占） */
function invokeMenuAction(action: keyof ContextMenuCallbacks): void {
  ipcOnHandlers.get('input:context-menu')!({} as unknown)
  const callbacks = vi.mocked(showContextMenu).mock.calls[0]![1]
  ;(callbacks[action] as () => void)()
}

describe('MouseHandler (IR-001 菜单动作抢占命令分发)', () => {
  beforeEach(() => {
    ipcOnHandlers.clear()
    vi.mocked(showContextMenu).mockClear()
  })

  it('右键菜单呼唤 → called 片段经分发链路实际上屏 (scheduler:play)', () => {
    const { win, send } = makeFakeWindow()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
    }, { windowWidth: 400, windowHeight: 400 })
    const scheduler = makeScheduler(CLIPS)
    const dispatcher = new SchedulerCommandDispatcher({
      getWindow: () => win,
      getProjectDir: () => '/proj/pet-a',
    })
    handler.setScheduler(scheduler)
    handler.setCommandDispatcher((commands) => dispatcher.dispatch(commands))

    invokeMenuAction('onCall')

    const playCalls = send.mock.calls.filter((c) => c[0] === 'scheduler:play')
    expect(playCalls.length).toBeGreaterThan(0)
    const payload = playCalls[0][1] as PlayClipPayload
    expect(payload.clipId).toBe('called_01')
    expect(payload.clipUrl).toContain('called_01.webm')

    handler.dispose()
  })

  it('右键菜单喝水 → drink 片段实际上屏并触发 onDrink 需求回调', () => {
    const { win, send } = makeFakeWindow()
    const onDrink = vi.fn()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
      onDrink,
    }, { windowWidth: 400, windowHeight: 400 })
    const scheduler = makeScheduler(CLIPS)
    const dispatcher = new SchedulerCommandDispatcher({
      getWindow: () => win,
      getProjectDir: () => '/proj/pet-a',
    })
    handler.setScheduler(scheduler)
    handler.setCommandDispatcher((commands) => dispatcher.dispatch(commands))
    handler.setAudioCoordinator({
      onActionTriggered: vi.fn(),
      toggleMute: () => false,
      isMuted: false,
    })

    invokeMenuAction('onDrink')

    const playCalls = send.mock.calls.filter((c) => c[0] === 'scheduler:play')
    expect(playCalls.length).toBeGreaterThan(0)
    const payload = playCalls[0][1] as PlayClipPayload
    expect(payload.clipId).toBe('drink_01')
    expect(payload.clipUrl).toContain('drink_01.webm')
    expect(onDrink).toHaveBeenCalledTimes(1)

    handler.dispose()
  })

  it('未注入分发器/调度器时菜单动作不抛错（分发为可选增强）', () => {
    const { win } = makeFakeWindow()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
    }, { windowWidth: 400, windowHeight: 400 })
    expect(() => invokeMenuAction('onCall')).not.toThrow()
    handler.dispose()
  })
})

describe('MouseHandler (IR-010 音频片段上下文)', () => {
  beforeEach(() => {
    ipcOnHandlers.clear()
    vi.mocked(showContextMenu).mockClear()
  })

  it('菜单动作向音频协调器传真实片段（不再恒 null）', () => {
    const { win } = makeFakeWindow()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
    }, { windowWidth: 400, windowHeight: 400 })
    handler.setScheduler(makeScheduler(CLIPS))

    const onActionTriggered = vi.fn()
    handler.setAudioCoordinator({
      onActionTriggered,
      toggleMute: () => false,
      isMuted: false,
    })

    invokeMenuAction('onCall')

    expect(onActionTriggered).toHaveBeenCalledTimes(1)
    const [action, clipArg] = onActionTriggered.mock.calls[0] as [string, ClipMeta]
    expect(action).toBe('called')
    expect(clipArg?.id).toBe('called_01')

    handler.dispose()
  })
})

describe('MouseHandler 拖拽 IPC（交互不切换片段）', () => {
  beforeEach(() => {
    ipcOnHandlers.clear()
    vi.mocked(showContextMenu).mockClear()
  })

  it('不再注册 input:preempt / input:end-preempt 频道', () => {
    const { win } = makeFakeWindow()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
    }, { windowWidth: 400, windowHeight: 400 })
    expect(ipcOnHandlers.has('input:preempt')).toBe(false)
    expect(ipcOnHandlers.has('input:end-preempt')).toBe(false)
    expect(ipcOnHandlers.has('input:drag-end')).toBe(true)
    handler.dispose()
  })

  it('首个 drag-move 开始拖拽并移动窗口，触发 onUserDragStart 一次', () => {
    const { win } = makeFakeWindow()
    const onUserDragStart = vi.fn()
    const onUserDragEnd = vi.fn()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
      onUserDragStart,
      onUserDragEnd,
    }, { windowWidth: 400, windowHeight: 400 })

    ipcOnHandlers.get('input:drag-move')!({} as unknown, 50, 60)
    ipcOnHandlers.get('input:drag-move')!({} as unknown, 60, 70)

    expect(onUserDragStart).toHaveBeenCalledTimes(1)
    expect(onUserDragEnd).not.toHaveBeenCalled()
    expect(win.setPosition).toHaveBeenCalled()

    handler.dispose()
  })

  it('drag-end 结束拖拽（钳制放置）并触发 onUserDragEnd', () => {
    const { win } = makeFakeWindow()
    const onUserDragEnd = vi.fn()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
      onUserDragEnd,
    }, { windowWidth: 400, windowHeight: 400 })

    ipcOnHandlers.get('input:drag-move')!({} as unknown, 50, 60)
    const movesBeforeEnd = (win.setPosition as ReturnType<typeof vi.fn>).mock.calls.length
    ipcOnHandlers.get('input:drag-end')!({} as unknown, {
      x: 40,
      y: 20,
      width: 320,
      height: 360,
    })

    expect(onUserDragEnd).toHaveBeenCalledTimes(1)
    // 松手后窗口位置被钳制到可见区并落回地面线
    expect((win.setPosition as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      movesBeforeEnd + 1,
    )

    handler.dispose()
  })
})
