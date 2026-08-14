import { describe, it, expect, vi } from 'vitest'
import {
  ClipScheduler,
  type ClipSchedulerConfig,
  type ClipSchedulerDeps,
  type RenderCommand,
} from '../../src/main/scheduler/clip-scheduler'
import { BehaviorFsm } from '../../src/main/behavior/fsm'
import { createSeededRandom } from '../../src/main/behavior/transitions'
import { walkWindowX } from '../../src/shared/spatial'
import type { BehaviorConfig } from '../../src/shared/types/behavior-config'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { TrackFile } from '../../src/shared/types/track-file'

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

/** 固定 90 帧、每帧 +2 曲线像素的行走位移曲线（位移(t) = 60t 曲线像素） */
function makeTrack(): TrackFile {
  return {
    version: 1,
    fps: 30,
    frameCount: 90,
    sourceWidth: 320,
    offsets: Array.from({ length: 90 }, (_, i) => i * 2),
    keypoints: [],
  }
}

function behaviorConfig(weightOverrides: Record<string, Record<string, number>>): BehaviorConfig {
  return {
    weightOverrides,
    rhythm: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 },
    microRandom: { rateJitter: 0.05, idleJitterSec: 2, signatureProbability: 0.05 },
    shell: {
      displayId: null,
      screenPercent: 0.15,
      volume: 0.25,
      ambientFrequency: 1.0,
      autoLaunch: true,
      hideHotkey: 'CommandOrControl+Shift+H',
    },
  }
}

interface SchedulerHarness {
  scheduler: ClipScheduler
  fsm: BehaviorFsm
}

function makeScheduler(opts: {
  clips: ClipMeta[]
  tracks?: Map<string, TrackFile>
  weightOverrides?: Record<string, Record<string, number>>
  config?: Partial<ClipSchedulerConfig>
  seed?: number
}): SchedulerHarness {
  const fsm = new BehaviorFsm({
    config: opts.weightOverrides ? behaviorConfig(opts.weightOverrides) : undefined,
    rng: createSeededRandom(opts.seed ?? 42),
  })
  const deps: ClipSchedulerDeps = {
    fsm,
    clips: opts.clips,
    tracks: opts.tracks ?? new Map(),
    getClipDurationSec: (id) => (id.includes('walk') ? 3 : 0.5),
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
    rng: createSeededRandom((opts.seed ?? 42) + 1),
    ...opts.config,
  }
  return { scheduler: new ClipScheduler(deps, config), fsm }
}

/** 驱动调度器前进，收集全部渲染命令 */
function drive(
  scheduler: ClipScheduler,
  fromMs: number,
  toMs: number,
  stepMs = 50,
  onTick?: (result: ReturnType<ClipScheduler['tick']>, nowMs: number) => void,
): RenderCommand[] {
  const commands: RenderCommand[] = []
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const result = scheduler.tick(t)
    commands.push(...result.commands)
    onTick?.(result, t)
  }
  return commands
}

const WALK_CLIPS: ClipMeta[] = [
  clip({ id: 'idle_sit_01', state: 'idle_sit' }),
  clip({ id: 'stand_01', state: 'stand', anchor: 'stand' }),
  clip({
    id: 'walk_01',
    state: 'walk',
    anchor: 'stand',
    direction: 'right',
    moveStartSec: 0.5,
    moveEndSec: 2.0,
    track: 'walk_01.track.json',
  }),
]

/** 强制 FSM 路径：idle_sit → stand → walk → stand → walk … */
const WALK_FORCING_WEIGHTS: Record<string, Record<string, number>> = {
  idle_sit: { lie: 0, groom: 0 },
  stand: { idle_sit: 0 },
  walk: { turn: 0 },
}

function makeWalkScheduler(seed = 42): SchedulerHarness {
  return makeScheduler({
    clips: WALK_CLIPS,
    tracks: new Map([['walk_01', makeTrack()]]),
    weightOverrides: WALK_FORCING_WEIGHTS,
    config: { idleConfig: { idleIntervalMs: 100, activeIntervalMs: 100, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 } },
    seed,
  })
}

/** 驱动到 walk 片段开始播放，返回 (进入 walk 的时间, walk 映射) */
function driveToWalk(scheduler: ClipScheduler): { walkStartMs: number } {
  for (let t = 0; t <= 20_000; t += 50) {
    const result = scheduler.tick(t)
    const play = result.commands.find(
      (c): c is Extract<RenderCommand, { kind: 'play' }> => c.kind === 'play' && c.clip.state === 'walk',
    )
    if (play) return { walkStartMs: t }
  }
  throw new Error('walk clip never played within 20s simulated')
}

describe('IR-004 行走位移接入视频时钟', () => {

  it('媒体时间上报驱动窗口平移（与 video.currentTime 一致）', () => {
    const { scheduler } = makeWalkScheduler()
    const { walkStartMs } = driveToWalk(scheduler)

    const mapping = scheduler.snapshot.cycle?.walkPlan?.mapping
    expect(mapping).toBeDefined()

    // 上报媒体时间 1.0s（处于行走子段 [0.5, 2.0] 内）
    scheduler.updateMediaTime('walk_01', 1.0, walkStartMs + 50)
    const result = scheduler.tick(walkStartMs + 50)
    const pos = result.commands.find((c) => c.kind === 'update_position')
    expect(pos).toBeDefined()
    const expected = walkWindowX(mapping!, 1.0)
    expect(Math.abs((pos as { x: number }).x - expected)).toBeLessThan(0.5)
  })

  it('视频暂停（媒体时间不变）时窗口不漂移', () => {
    const { scheduler } = makeWalkScheduler()
    const { walkStartMs } = driveToWalk(scheduler)

    // 连续上报同一媒体时间（模拟视频暂停/加载停滞）
    scheduler.updateMediaTime('walk_01', 1.2, walkStartMs + 50)
    const r1 = scheduler.tick(walkStartMs + 50)
    scheduler.updateMediaTime('walk_01', 1.2, walkStartMs + 150)
    const r2 = scheduler.tick(walkStartMs + 150)

    const x1 = r1.commands.find((c) => c.kind === 'update_position') as { x: number } | undefined
    const x2 = r2.commands.find((c) => c.kind === 'update_position')
    // 第一次到位后，媒体时间不变 → 不再产生位移命令
    expect(x1).toBeDefined()
    expect(x2).toBeUndefined()
    expect(scheduler.petX).toBeCloseTo(x1!.x, 5)
  })

  it('上报失效（>300ms）回退墙钟并记日志', () => {
    const { scheduler } = makeWalkScheduler()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { walkStartMs } = driveToWalk(scheduler)
    const mapping = scheduler.snapshot.cycle!.walkPlan!.mapping

    // 一次性上报后不再上报
    scheduler.updateMediaTime('walk_01', 1.0, walkStartMs + 50)
    scheduler.tick(walkStartMs + 50)

    // 500ms 后上报已失效（阈值 300ms）→ 墙钟
    const t = walkStartMs + 550
    const result = scheduler.tick(t)
    const pos = result.commands.find((c) => c.kind === 'update_position') as { x: number } | undefined
    const wallElapsedSec = (t - walkStartMs) / 1000
    const expectedWall = walkWindowX(mapping, wallElapsedSec)
    expect(pos).toBeDefined()
    expect(Math.abs(pos!.x - expectedWall)).toBeLessThan(0.5)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('媒体时间滞后于墙钟时，窗口跟随媒体时间（纠正加载延迟滑步）', () => {
    const { scheduler } = makeWalkScheduler()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { walkStartMs } = driveToWalk(scheduler)
    const mapping = scheduler.snapshot.cycle!.walkPlan!.mapping

    // 无上报：墙钟驱动，窗口走到 0.7s 对应位置
    const t1 = walkStartMs + 700
    const r1 = scheduler.tick(t1)
    const wallPos = r1.commands.find((c) => c.kind === 'update_position') as { x: number } | undefined
    const wallX = walkWindowX(mapping, 0.7)
    expect(wallPos).toBeDefined()
    expect(Math.abs(wallPos!.x - wallX)).toBeLessThan(0.5)

    // 视频加载延迟：媒体时间才 0.05s（站定段内）→ 窗口回到媒体时间对应位置
    const t2 = walkStartMs + 800
    scheduler.updateMediaTime('walk_01', 0.05, t2)
    const r2 = scheduler.tick(t2)
    const mediaPos = r2.commands.find((c) => c.kind === 'update_position') as { x: number } | undefined

    const mediaX = walkWindowX(mapping, 0.05)
    expect(mediaX).toBeLessThan(wallX) // 0.05s < moveStartSec 0.5 → 站定段无位移
    expect(mediaPos).toBeDefined()
    expect(Math.abs(mediaPos!.x - mediaX)).toBeLessThan(0.5)
    vi.restoreAllMocks()
  })
})

describe('IR-014 空闲保活目标片段', () => {
  it('行走周期结束后 idle 命令携带锚定片段（而非行走片段，避免太空步）', () => {
    const { scheduler } = makeWalkScheduler()
    const { walkStartMs } = driveToWalk(scheduler)

    // 行走片段时长 3s：驶过整个行走周期进入空闲
    const commands = drive(scheduler, walkStartMs + 50, walkStartMs + 3400)
    const idleCmds = commands.filter(
      (c): c is Extract<RenderCommand, { kind: 'idle' }> => c.kind === 'idle',
    )
    expect(idleCmds.length).toBeGreaterThan(0)
    for (const cmd of idleCmds) {
      expect(cmd.clip.id).toBe('stand_01') // ANCHOR_STATE['stand'] → stand 片段
      expect(cmd.clip.id).not.toBe('walk_01')
    }
  })

  it('循环片段周期结束后 idle 命令携带原循环片段（保活为空操作）', () => {
    const clips = [
      clip({ id: 'idle_sit_01', state: 'idle_sit', loop: true, loopInSec: 0, loopOutSec: 3 }),
    ]
    const { scheduler } = makeScheduler({
      clips,
      weightOverrides: { idle_sit: { lie: 0, stand: 0, groom: 0 } },
      config: { idleConfig: { idleIntervalMs: 100, activeIntervalMs: 100, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 } },
    })

    // 首个周期：idle_sit 循环片段（durationMs=null，需外部完成通知）
    const r0 = scheduler.tick(0)
    expect(r0.commands.some((c) => c.kind === 'play' && c.clip.id === 'idle_sit_01')).toBe(true)
    // 外部通知循环完成 → 进入空闲（idleUntilMs = 500 + 100 = 600）
    scheduler.completeCurrentPlayback(500)
    const r1 = scheduler.tick(599) // 间隔未到期 → idle 命令
    const idleCmd = r1.commands.find((c) => c.kind === 'idle')
    expect(idleCmd).toBeDefined()
    expect((idleCmd as Extract<RenderCommand, { kind: 'idle' }>).clip.id).toBe('idle_sit_01')
  })
})

describe('IR-002 play 命令携带锚点与速率', () => {
  it('play/fade_in 命令包含 anchor 与 playbackRate 字段', () => {
    const clips = [
      clip({ id: 'idle_sit_01', state: 'idle_sit' }),
      clip({ id: 'stand_01', state: 'stand', anchor: 'stand' }),
    ]
    const { scheduler } = makeScheduler({
      clips,
      weightOverrides: { idle_sit: { lie: 0, groom: 0 } }, // idle_sit → stand
      config: { idleConfig: { idleIntervalMs: 50, activeIntervalMs: 50, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 } },
    })
    const commands = drive(scheduler, 0, 5_000)
    const plays = commands.filter((c): c is Extract<RenderCommand, { kind: 'play' }> => c.kind === 'play')
    expect(plays.length).toBeGreaterThan(0)
    for (const p of plays) {
      expect(p.anchor === 'sit' || p.anchor === 'stand').toBe(true)
      expect(p.playbackRate).toBe(1) // 未启用微随机时恒 1.0
    }
    // stand 片段按 stand 锚点渲染
    const standPlay = plays.find((p) => p.clip.id === 'stand_01')
    expect(standPlay?.anchor).toBe('stand')
  })
})
