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
    category: 'basic',
    direction: 'none',
    anchor: 'sit',
    loop: false,
    loopInSec: null,
    loopOutSec: null,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: false,
    audio: null,
    scaleHint: 1.0,
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
    tracks: new Map(),
    getClipDurationSec: () => 2,
  }
  const config: ClipSchedulerConfig = {
    symmetrical: true,
    workArea: { x: 0, y: 0, width: 1920, height: 1040, groundLine: 1040 },
    windowWidth: 400,
    spriteBaseY: 380,
    displayedWidthPx: 200,
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
  clip({ id: 'idle_sit_01', state: 'idle_sit', loop: true, loopInSec: 0, loopOutSec: 3 }),
  clip({ id: 'petted_01', state: 'petted', category: 'interactive', loop: true, loopInSec: 0, loopOutSec: 2 }),
  clip({ id: 'clicked_01', state: 'clicked', category: 'interactive' }),
  clip({ id: 'eat_01', state: 'eat', category: 'interactive', prop: true }),
]

describe('MouseHandler (IR-001 抢占命令分发)', () => {
  beforeEach(() => {
    ipcOnHandlers.clear()
  })

  it('input:preempt IPC → 交互片段经分发链路实际上屏 (scheduler:play)', () => {
    const { win, send } = makeFakeWindow()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
    }, { windowWidth: 400, spriteBaseY: 380 })
    const scheduler = makeScheduler(CLIPS)
    const dispatcher = new SchedulerCommandDispatcher({
      getWindow: () => win,
      getProjectDir: () => '/proj/pet-a',
    })
    handler.setScheduler(scheduler)
    handler.setCommandDispatcher((commands) => dispatcher.dispatch(commands))

    const preempt = ipcOnHandlers.get('input:preempt')
    expect(preempt).toBeDefined()
    preempt!({} as unknown, 'petted')

    const playCalls = send.mock.calls.filter((c) => c[0] === 'scheduler:play')
    expect(playCalls.length).toBeGreaterThan(0)
    const payload = playCalls[0][1] as PlayClipPayload
    expect(payload.clipId).toBe('petted_01')
    expect(payload.clipUrl).toContain('petted_01.webm')

    handler.dispose()
  })

  it('未注入分发器时抢占不抛错（分发为可选增强）', () => {
    const { win } = makeFakeWindow()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
    }, { windowWidth: 400, spriteBaseY: 380 })
    handler.setScheduler(makeScheduler(CLIPS))
    expect(() => ipcOnHandlers.get('input:preempt')!({} as unknown, 'clicked')).not.toThrow()
    handler.dispose()
  })
})

describe('MouseHandler (IR-010/GAP-005 音频片段上下文)', () => {
  beforeEach(() => {
    ipcOnHandlers.clear()
  })

  it('抢占路径向音频协调器传真实片段（不再恒 null）', () => {
    const { win } = makeFakeWindow()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
    }, { windowWidth: 400, spriteBaseY: 380 })
    handler.setScheduler(makeScheduler(CLIPS))

    const onActionTriggered = vi.fn()
    handler.setAudioCoordinator({
      onActionTriggered,
      onEmbeddedAudioEnded: vi.fn(),
      toggleMute: () => false,
      isMuted: false,
    })

    ipcOnHandlers.get('input:preempt')!({} as unknown, 'petted')

    expect(onActionTriggered).toHaveBeenCalledTimes(1)
    const [action, clipArg] = onActionTriggered.mock.calls[0] as [string, ClipMeta]
    expect(action).toBe('petted')
    expect(clipArg?.id).toBe('petted_01')

    handler.dispose()
  })
})

describe('MouseHandler (IR-008 交互需求反馈)', () => {
  beforeEach(() => {
    ipcOnHandlers.clear()
  })

  it('抚摸/点击抢占触发 onInteractionNeeds 回调', () => {
    const { win } = makeFakeWindow()
    const onInteractionNeeds = vi.fn()
    const handler = new MouseHandler(win, {
      onHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
      onInteractionNeeds,
    }, { windowWidth: 400, spriteBaseY: 380 })
    handler.setScheduler(makeScheduler(CLIPS))

    ipcOnHandlers.get('input:preempt')!({} as unknown, 'petted')
    ipcOnHandlers.get('input:preempt')!({} as unknown, 'clicked')

    expect(onInteractionNeeds).toHaveBeenNthCalledWith(1, 'petted')
    expect(onInteractionNeeds).toHaveBeenNthCalledWith(2, 'clicked')

    handler.dispose()
  })
})
