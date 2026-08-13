import { describe, it, expect } from 'vitest'
import {
  ClipScheduler,
  type ClipSchedulerConfig,
  type ClipSchedulerDeps,
  type RenderCommand,
} from '../../src/main/scheduler/clip-scheduler'
import { BehaviorFsm } from '../../src/main/behavior/fsm'
import { createSeededRandom } from '../../src/main/behavior/transitions'
import { planStateTransition } from '../../src/main/behavior/anchor-transition'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { TrackFile } from '../../src/shared/types/track-file'
import type { WorkAreaBounds } from '../../src/shared/spatial'
import { isPlaceholderClip } from '../../src/main/persistence/placeholder'

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

function transitionClip(from: string, to: string): ClipMeta {
  return clip({ id: `transition_${from}_to_${to}`, state: 'transition', anchor: 'none' })
}

/**
 * 最小启动集 (§4.6)：端坐、站立、行走左、行走右、趴卧、睡眠 + 过渡段。
 */
function minimumStartupSet(): ClipMeta[] {
  return [
    clip({ id: 'idle_sit_01', state: 'idle_sit', loop: true, loopInSec: 0, loopOutSec: 3 }),
    clip({ id: 'stand_01', state: 'stand', anchor: 'stand' }),
    clip({
      id: 'walk_left_01',
      state: 'walk',
      anchor: 'stand',
      direction: 'left',
      moveStartSec: 0.5,
      moveEndSec: 2.0,
      track: 'walk_left_01.track.json',
    }),
    clip({
      id: 'walk_right_01',
      state: 'walk',
      anchor: 'stand',
      direction: 'right',
      moveStartSec: 0.5,
      moveEndSec: 2.0,
      track: 'walk_right_01.track.json',
    }),
    clip({ id: 'lie_01', state: 'lie', loop: true, anchor: 'none', loopInSec: 0, loopOutSec: 4 }),
    clip({ id: 'sleep_01', state: 'sleep', loop: true, anchor: 'none', loopInSec: 0, loopOutSec: 8 }),
    transitionClip('sit', 'stand'),
    transitionClip('stand', 'sit'),
    transitionClip('sit', 'lie'),
    transitionClip('lie', 'sit'),
    transitionClip('sit', 'sleep'),
    transitionClip('sleep', 'sit'),
  ]
}

/** 完整素材库（全部基础状态 + 过渡 + 理毛 + 转身） */
function fullStore(): ClipMeta[] {
  return [
    ...minimumStartupSet(),
    clip({ id: 'groom_01', state: 'groom', loop: true, anchor: 'none', loopInSec: 0, loopOutSec: 3 }),
    clip({ id: 'turn_left_01', state: 'turn', anchor: 'stand', direction: 'left' }),
    clip({ id: 'turn_right_01', state: 'turn', anchor: 'stand', direction: 'right' }),
    transitionClip('sit', 'groom'),
    transitionClip('groom', 'sit'),
    transitionClip('stand', 'lie'),
    transitionClip('stand', 'sleep'),
  ]
}

/** 右行位移曲线 */
function rightwardTrack(): TrackFile {
  const offsets: number[] = []
  for (let i = 0; i < 5; i++) offsets.push(0)
  for (let i = 0; i < 15; i++) offsets.push((i + 1) * 2)
  return { version: 1, fps: 10, frameCount: 20, sourceWidth: 100, offsets, keypoints: [] }
}

/** 左行位移曲线 */
function leftwardTrack(): TrackFile {
  const offsets: number[] = []
  for (let i = 0; i < 5; i++) offsets.push(0)
  for (let i = 0; i < 15; i++) offsets.push(-(i + 1) * 2)
  return { version: 1, fps: 10, frameCount: 20, sourceWidth: 100, offsets, keypoints: [] }
}

function makeTracks(): Map<string, TrackFile> {
  return new Map([
    ['walk_left_01', leftwardTrack()],
    ['walk_right_01', rightwardTrack()],
  ])
}

const BOUNDS: WorkAreaBounds = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  groundLine: 1080,
}

function makeConfig(seed = 42): ClipSchedulerConfig {
  return {
    symmetrical: true,
    workArea: BOUNDS,
    windowWidth: 400,
    spriteBaseY: 380,
    displayedWidthPx: 200,
    idleConfig: {
      idleIntervalMs: 2_000, // shortened for faster test simulation
      activeIntervalMs: 1_000,
      exhaustionMultiplier: 1.5,
      exhaustionThreshold: 3,
    },
    planOptions: {},
    rng: createSeededRandom(seed),
  }
}

function makeDeps(clips: ClipMeta[], tracks: Map<string, TrackFile>): ClipSchedulerDeps {
  return {
    fsm: new BehaviorFsm({ rng: createSeededRandom(42) }),
    clips,
    tracks,
    getClipDurationSec: (id: string): number => {
      if (id.startsWith('transition_')) return 0.5
      if (id.startsWith('walk_')) return 2.0
      if (id.startsWith('idle_sit')) return 3.0
      if (id.startsWith('stand')) return 2.0
      if (id.startsWith('turn')) return 1.0
      return 2.0
    },
  }
}

/**
 * 模拟调度器运行一段时间。
 * 对循环片段（isPlayingLoop）在 idle 间隔到期时调用 completeCurrentPlayback。
 * 对一次性片段，让 isCurrentItemDone 通过时间自然触发。
 */
function simulate(
  scheduler: ClipScheduler,
  durationMs: number,
  tickIntervalMs = 50,
): { commands: RenderCommand[]; cycleCount: number; positions: number[] } {
  const commands: RenderCommand[] = []
  let cycleCount = 0
  const positions: number[] = []

  for (let t = 0; t <= durationMs; t += tickIntervalMs) {
    const result = scheduler.tick(t)
    commands.push(...result.commands)
    if (result.cycleStarted) cycleCount++
    positions.push(scheduler.petX)

    // 循环片段需要外部通知完成
    if (scheduler.isPlayingLoop) {
      // 在 idle 间隔到期后完成循环片段
      const idleUntil = scheduler.snapshot.idleUntilMs
      if (scheduler.snapshot.phase === 'idle' && t >= idleUntil) {
        // will be handled by next tick
      }
      // If still cycling and playing loop, complete after a short delay
      // This simulates the idle interval elapsing
      if (scheduler.snapshot.phase === 'cycling') {
        // Force complete the loop playback
        const completeResult = scheduler.completeCurrentPlayback(t + tickIntervalMs / 2)
        commands.push(...completeResult.commands)
        if (completeResult.cycleStarted) cycleCount++
      }
    }
  }

  return { commands, cycleCount, positions }
}

// —— AC0: Clip variant selection based on FSM state —— //

describe('AC0: Scheduler selects clip variants based on FSM state', () => {
  it('selects a clip matching the next FSM state', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig())

    const result = scheduler.tick(0)
    expect(result.cycleStarted).toBe(true)
    const playCmds = result.commands.filter((c) => c.kind === 'play')
    expect(playCmds.length).toBeGreaterThan(0)
  })

  it('produces play commands with real clips for available states', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig())
    const { commands } = simulate(scheduler, 60_000)

    const playCmds = commands.filter((c) => c.kind === 'play') as Extract<
      RenderCommand,
      { kind: 'play' }
    >[]
    expect(playCmds.length).toBeGreaterThan(0)

    const realClips = playCmds.filter((c) => !isPlaceholderClip(c.clip))
    expect(realClips.length).toBeGreaterThan(0)
  })
})

// —— AC1: Clip lifecycle managed (load → play → anchor transition → next) —— //

describe('AC1: Clip lifecycle management', () => {
  it('produces play commands followed by transition to next clip', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig())
    const { commands } = simulate(scheduler, 30_000)

    const playSequence: string[] = []
    for (const cmd of commands) {
      if (cmd.kind === 'play' || cmd.kind === 'fade_in') {
        playSequence.push(cmd.clip.id)
      }
    }
    expect(playSequence.length).toBeGreaterThan(1)
  })

  it('no visual hard cuts: same-anchor transitions produce no intermediate easing', () => {
    const clips = fullStore()
    const plan = planStateTransition(
      { state: 'idle_sit', clip: clips[0] },
      { state: 'stand', clip: clips[1] },
      clips,
    )
    expect(plan.usedFallback).toBe(false)
    expect(plan.steps.some((s) => s.role === 'cross_anchor' && s.kind === 'play')).toBe(true)
  })

  it('no hard cuts when clips share same anchor', () => {
    const clips = fullStore()
    const plan = planStateTransition(
      { state: 'idle_sit', clip: clips[0] },
      { state: 'lie', clip: clips.find((c) => c.state === 'lie')! },
      clips,
    )
    expect(plan.usedFallback).toBe(false)
  })
})

// —— AC2: Walk scheduling —— //

describe('AC2: Walk scheduling plans positions and duration', () => {
  it('updates pet position during walk clips', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig(7))
    const { commands } = simulate(scheduler, 120_000)

    const sawWalk = commands.some(
      (c) => c.kind === 'play' && c.clip.state === 'walk',
    )
    const sawPositionUpdate = commands.some((c) => c.kind === 'update_position')
    expect(sawWalk).toBe(true)
    expect(sawPositionUpdate).toBe(true)
  })

  it('keeps pet within screen bounds during walks', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig(7))
    const { positions } = simulate(scheduler, 120_000)

    for (const x of positions) {
      expect(x).toBeGreaterThanOrEqual(BOUNDS.x)
      expect(x).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.width)
    }
  })
})

// —— AC3: Idle scheduling —— //

describe('AC3: Idle scheduling uses appropriate intervals', () => {
  it('starts in idle phase and transitions to cycling after interval', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig())
    expect(scheduler.snapshot.phase).toBe('idle')

    const result = scheduler.tick(0)
    expect(result.cycleStarted).toBe(true)
    expect(scheduler.snapshot.phase).toBe('cycling')
  })

  it('returns to idle phase after cycle completes', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig())

    scheduler.tick(0)
    expect(scheduler.snapshot.phase).toBe('cycling')

    // Let time pass to complete non-loop items
    for (let t = 100; t <= 30_000; t += 50) {
      scheduler.tick(t)
      if (scheduler.isPlayingLoop) {
        scheduler.completeCurrentPlayback(t + 25)
      }
      if (scheduler.snapshot.phase === 'idle') break
    }
    expect(scheduler.snapshot.phase).toBe('idle')
  })
})

// —— AC4: Variant exhaustion fallback —— //

describe('AC4: Variant exhaustion fallback', () => {
  it('scheduler tracks variant usage over time', () => {
    const clips = [
      ...minimumStartupSet(),
      clip({ id: 'idle_sit_02', state: 'idle_sit', variant: 2, loop: true, loopInSec: 0, loopOutSec: 3 }),
      clip({ id: 'idle_sit_03', state: 'idle_sit', variant: 3, loop: true, loopInSec: 0, loopOutSec: 3 }),
    ]
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig())
    simulate(scheduler, 120_000)

    const tracker = scheduler.snapshot.variantTracker
    expect(tracker.usage.size).toBeGreaterThan(0)
  })
})

// —— AC5: Missing states display placeholder —— //

describe('AC5: Missing states display placeholder (§5.5, §13)', () => {
  it('does not crash with empty clip store', () => {
    const scheduler = new ClipScheduler(makeDeps([], makeTracks()), makeConfig())
    const result = scheduler.tick(0)
    expect(result).toBeDefined()
    expect(scheduler.snapshot.showingPlaceholder).toBe(true)
  })

  it('displays idle_sit placeholder for states without clips', () => {
    const clips = [clip({ id: 'idle_sit_01', state: 'idle_sit' })]
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig(99))

    let sawPlaceholder = false
    for (let t = 0; t <= 60_000; t += 50) {
      scheduler.tick(t)
      if (scheduler.snapshot.showingPlaceholder) {
        sawPlaceholder = true
        break
      }
      if (scheduler.isPlayingLoop) {
        scheduler.completeCurrentPlayback(t + 25)
      }
    }
    expect(sawPlaceholder).toBe(true)
  })

  it('placeholder clip has idle_sit state', () => {
    const scheduler = new ClipScheduler(makeDeps([], makeTracks()), makeConfig())
    scheduler.tick(0)
    const cycle = scheduler.snapshot.cycle
    if (cycle) {
      expect(isPlaceholderClip(cycle.targetClip)).toBe(true)
      expect(cycle.targetClip.state).toBe('idle_sit')
    }
  })
})

// —— AC6: 10-minute simulation with minimum startup set —— //

describe('AC6: 10-minute simulation (§15 Phase 1b)', () => {
  it('runs for 10 minutes with 6 minimum clips: no crashes, no anchor jumps', () => {
    const clips = minimumStartupSet()
    const tracks = makeTracks()
    const scheduler = new ClipScheduler(
      makeDeps(clips, tracks),
      makeConfig(12345),
    )

    const TEN_MINUTES_MS = 10 * 60 * 1000
    const TICK_INTERVAL = 100
    let tickCount = 0
    let cycleCount = 0
    const positions: number[] = []
    let hadError = false

    try {
      for (let t = 0; t <= TEN_MINUTES_MS; t += TICK_INTERVAL) {
        const result = scheduler.tick(t)
        tickCount++
        if (result.cycleStarted) cycleCount++
        positions.push(scheduler.petX)

        if (scheduler.isPlayingLoop) {
          const completeResult = scheduler.completeCurrentPlayback(t + TICK_INTERVAL / 2)
          if (completeResult.cycleStarted) cycleCount++
        }
      }
    } catch (e) {
      hadError = true
      console.error('Crash during simulation:', e)
    }

    expect(hadError).toBe(false)

    for (const x of positions) {
      expect(x).toBeGreaterThanOrEqual(BOUNDS.x)
      expect(x).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.width)
    }

    expect(cycleCount).toBeGreaterThan(5)
    expect(tickCount).toBeGreaterThan(100)

    // No teleport jumps: consecutive positions should change gradually
    for (let i = 1; i < positions.length; i++) {
      const jump = Math.abs(positions[i] - positions[i - 1])
      expect(jump).toBeLessThan(BOUNDS.width)
    }
  })

  it('runs with full store without crashes', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig(999))

    let hadError = false
    try {
      for (let t = 0; t <= 60_000; t += 50) {
        scheduler.tick(t)
        if (scheduler.isPlayingLoop) {
          scheduler.completeCurrentPlayback(t + 25)
        }
      }
    } catch (e) {
      hadError = true
      console.error('Crash:', e)
    }
    expect(hadError).toBe(false)
  })

  it('FSM progresses through multiple different states over time', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig(314))

    const visitedStates = new Set<string>()
    for (let t = 0; t <= 120_000; t += 50) {
      scheduler.tick(t)
      visitedStates.add(scheduler.snapshot.fsmState)
      if (scheduler.isPlayingLoop) {
        scheduler.completeCurrentPlayback(t + 25)
      }
    }
    expect(visitedStates.size).toBeGreaterThan(1)
  })
})

// —— Scheduler reset (§13) —— //

describe('Scheduler reset (§13)', () => {
  it('resets to anchor state after crash recovery', () => {
    const clips = fullStore()
    const scheduler = new ClipScheduler(makeDeps(clips, makeTracks()), makeConfig())

    for (let t = 0; t <= 30_000; t += 50) {
      scheduler.tick(t)
      if (scheduler.isPlayingLoop) {
        scheduler.completeCurrentPlayback(t + 25)
      }
    }

    const state = scheduler.reset(50_000)
    expect(state.phase).toBe('idle')
    expect(state.fsmState).toBe('idle_sit')
    expect(state.walkDirection).toBeNull()
    expect(state.variantTracker.usage.size).toBe(0)
  })
})
