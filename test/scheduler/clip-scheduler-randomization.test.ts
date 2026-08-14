import { describe, it, expect } from 'vitest'
import {
  ClipScheduler,
  type ClipSchedulerConfig,
  type ClipSchedulerDeps,
  type RenderCommand,
} from '../../src/main/scheduler/clip-scheduler'
import { BehaviorFsm } from '../../src/main/behavior/fsm'
import { createSeededRandom } from '../../src/main/behavior/transitions'
import type { BehaviorConfig } from '../../src/shared/types/behavior-config'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { Personality } from '../../src/shared/types/persona'

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

const NEUTRAL_PERSONALITY: Personality = {
  liveliness: 0.5,
  laziness: 0.5,
  clinginess: 0.5,
  timidity: 0.5,
  curiosity: 0.5,
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

function makeScheduler(opts: {
  clips: ClipMeta[]
  weightOverrides?: Record<string, Record<string, number>>
  config?: Partial<ClipSchedulerConfig>
  seed?: number
}): { scheduler: ClipScheduler; fsm: BehaviorFsm } {
  const fsm = new BehaviorFsm({
    config: opts.weightOverrides ? behaviorConfig(opts.weightOverrides) : undefined,
    rng: createSeededRandom(opts.seed ?? 7),
  })
  const deps: ClipSchedulerDeps = {
    fsm,
    clips: opts.clips,
    tracks: new Map(),
    getClipDurationSec: () => 0.5,
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
    rng: createSeededRandom((opts.seed ?? 7) + 1),
    ...opts.config,
  }
  return { scheduler: new ClipScheduler(deps, config), fsm }
}

/** 驱动调度器 N 个周期，返回全部命令与状态快照序列 */
function driveCycles(
  scheduler: ClipScheduler,
  maxMs: number,
  onTick?: (result: ReturnType<ClipScheduler['tick']>, nowMs: number) => void,
): RenderCommand[] {
  const commands: RenderCommand[] = []
  for (let t = 0; t <= maxMs; t += 50) {
    const result = scheduler.tick(t)
    commands.push(...result.commands)
    onTick?.(result, t)
  }
  return commands
}

const MICRO = { rateJitter: 0.05, idleJitterSec: 2, signatureProbability: 0.05 }

/** 强制 FSM 停留 idle_sit（全部出边权重 0 → step 保持原状态） */
const STAY_IDLE: Record<string, Record<string, number>> = {
  idle_sit: { lie: 0, stand: 0, groom: 0 },
}

describe('IR-006 调度微随机化接入', () => {
  it('播放速率抖动随 play 命令下发（±5% 且有分布）', () => {
    const clips = [
      clip({ id: 'idle_sit_01', state: 'idle_sit', variant: 1 }),
      clip({ id: 'idle_sit_02', state: 'idle_sit', variant: 2 }),
    ]
    const { scheduler } = makeScheduler({
      clips,
      weightOverrides: STAY_IDLE,
      config: {
        microRandom: { ...MICRO, signatureProbability: 0 },
        idleConfig: { idleIntervalMs: 200, activeIntervalMs: 200, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 },
      },
    })

    const commands = driveCycles(scheduler, 60_000)
    const rates = commands
      .filter((c): c is Extract<RenderCommand, { kind: 'play' }> => c.kind === 'play')
      .map((c) => c.playbackRate)

    expect(rates.length).toBeGreaterThan(10)
    for (const r of rates) {
      expect(r).toBeGreaterThanOrEqual(0.95)
      expect(r).toBeLessThanOrEqual(1.05)
    }
    // 速率确实在抖动（非恒 1.0）
    expect(new Set(rates).size).toBeGreaterThan(3)
  })

  it('未启用微随机时 playbackRate 恒 1.0', () => {
    const clips = [clip({ id: 'idle_sit_01', state: 'idle_sit' })]
    const { scheduler } = makeScheduler({
      clips,
      weightOverrides: STAY_IDLE,
      config: { idleConfig: { idleIntervalMs: 200, activeIntervalMs: 200, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 } },
    })
    const commands = driveCycles(scheduler, 20_000)
    const rates = commands
      .filter((c): c is Extract<RenderCommand, { kind: 'play' }> => c.kind === 'play')
      .map((c) => c.playbackRate)
    expect(rates.length).toBeGreaterThan(0)
    expect(new Set(rates)).toEqual(new Set([1]))
  })

  it('静止时长抖动：空闲间隔在 [base−jitter, base+jitter] 内分布', () => {
    const clips = [clip({ id: 'idle_sit_01', state: 'idle_sit' })]
    const { scheduler } = makeScheduler({
      clips,
      weightOverrides: STAY_IDLE,
      config: {
        microRandom: { rateJitter: 0.05, idleJitterSec: 1, signatureProbability: 0 },
        idleConfig: { idleIntervalMs: 5_000, activeIntervalMs: 5_000, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 },
      },
    })

    // 周期完成时刻记录 idleUntilMs - nowMs（即本周期后空闲间隔）
    const intervals: number[] = []
    driveCycles(scheduler, 300_000, (result, nowMs) => {
      if (result.cycleCompleted) {
        intervals.push(result.state.idleUntilMs - nowMs)
      }
    })

    expect(intervals.length).toBeGreaterThan(10)
    for (const iv of intervals) {
      expect(iv).toBeGreaterThanOrEqual(4_000)
      expect(iv).toBeLessThanOrEqual(6_000)
    }
    expect(new Set(intervals).size).toBeGreaterThan(3)
  })

  it('变体洗牌：同状态多变体不立即重复（洗牌袋）', () => {
    const clips = [
      clip({ id: 'idle_sit_01', state: 'idle_sit', variant: 1 }),
      clip({ id: 'idle_sit_02', state: 'idle_sit', variant: 2 }),
      clip({ id: 'idle_sit_03', state: 'idle_sit', variant: 3 }),
    ]
    const { scheduler } = makeScheduler({
      clips,
      weightOverrides: STAY_IDLE,
      config: {
        microRandom: { ...MICRO, signatureProbability: 0 },
        idleConfig: { idleIntervalMs: 100, activeIntervalMs: 100, exhaustionMultiplier: 1.5, exhaustionThreshold: 99 },
      },
      seed: 99,
    })

    const commands = driveCycles(scheduler, 120_000)
    const played = commands
      .filter((c): c is Extract<RenderCommand, { kind: 'play' }> => c.kind === 'play')
      .map((c) => c.clip.id)

    expect(played.length).toBeGreaterThan(10)
    // 洗牌袋语义：相邻两次抽取不相同
    for (let i = 1; i < played.length; i++) {
      expect(played[i]).not.toBe(played[i - 1])
    }
    // 多变体确实都被抽到
    expect(new Set(played).size).toBe(3)
  })

  it('稀有动作插入：按概率出现且 FSM 状态不被插入污染', () => {
    const clips = [
      clip({ id: 'idle_sit_01', state: 'idle_sit' }),
      clip({ id: 'yawn_01', state: 'yawn', signature: true, category: 'signature' }),
    ]
    const { scheduler, fsm } = makeScheduler({
      clips,
      weightOverrides: STAY_IDLE,
      config: {
        microRandom: { rateJitter: 0.05, idleJitterSec: 0.5, signatureProbability: 0.08 },
        rareActions: ['yawn'],
        idleConfig: { idleIntervalMs: 100, activeIntervalMs: 100, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 },
      },
      seed: 1234,
    })

    const commands = driveCycles(scheduler, 600_000)
    const yawnPlays = commands.filter(
      (c): c is Extract<RenderCommand, { kind: 'play' }> => c.kind === 'play' && c.clip.id === 'yawn_01',
    )

    // 8% 概率 × ~3000 周期 → 必然出现；范围断言避免脆性
    expect(yawnPlays.length).toBeGreaterThan(10)
    // preserveFsm：FSM 从未离开 idle_sit（稀有动作不消耗 FSM 转移）
    expect(fsm.state).toBe('idle_sit')
    expect(fsm.snapshot.transitionCount).toBe(0)
  })

  it('稀有动作概率为 0 时从不插入', () => {
    const clips = [
      clip({ id: 'idle_sit_01', state: 'idle_sit' }),
      clip({ id: 'yawn_01', state: 'yawn', signature: true, category: 'signature' }),
    ]
    const { scheduler } = makeScheduler({
      clips,
      weightOverrides: STAY_IDLE,
      config: {
        microRandom: { ...MICRO, signatureProbability: 0 },
        rareActions: ['yawn'],
        idleConfig: { idleIntervalMs: 100, activeIntervalMs: 100, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 },
      },
    })

    const commands = driveCycles(scheduler, 60_000)
    expect(commands.some((c) => c.kind === 'play' && c.clip.id === 'yawn_01')).toBe(false)
  })

  it('稀有动作候选无真实片段时落回常规调度', () => {
    const clips = [clip({ id: 'idle_sit_01', state: 'idle_sit' })]
    const { scheduler } = makeScheduler({
      clips,
      weightOverrides: STAY_IDLE,
      config: {
        microRandom: { ...MICRO, signatureProbability: 0.08 },
        rareActions: ['yawn'], // 无 yawn 片段
        idleConfig: { idleIntervalMs: 100, activeIntervalMs: 100, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 },
      },
    })
    const commands = driveCycles(scheduler, 30_000)
    const plays = commands.filter((c) => c.kind === 'play')
    expect(plays.length).toBeGreaterThan(0)
    expect(plays.every((c) => c.kind === 'play' && c.clip.id === 'idle_sit_01')).toBe(true)
  })

  it('出现位置 x 抖动：周期起步时窗口位置逐周期微移（≤抖动幅度）', () => {
    const clips = [clip({ id: 'idle_sit_01', state: 'idle_sit' })]
    const { scheduler } = makeScheduler({
      clips,
      weightOverrides: STAY_IDLE,
      config: {
        microRandom: { ...MICRO, signatureProbability: 0 },
        positionJitterPx: 30,
        idleConfig: { idleIntervalMs: 100, activeIntervalMs: 100, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 },
      },
      seed: 555,
    })

    const commands = driveCycles(scheduler, 60_000)
    const positions = commands
      .filter((c): c is Extract<RenderCommand, { kind: 'update_position' }> => c.kind === 'update_position')
      .map((c) => c.x)

    expect(positions.length).toBeGreaterThan(5)
    // 每周期抖动 ≤ positionJitterPx（逐周期增量有界）
    for (let i = 1; i < positions.length; i++) {
      expect(Math.abs(positions[i] - positions[i - 1])).toBeLessThanOrEqual(30 + 0.5)
    }
    // 位置确实在变化
    expect(new Set(positions).size).toBeGreaterThan(2)
    // 始终在工作区内
    for (const x of positions) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1920 - 400)
    }
  })

  it('性格好奇调制稀有动作概率 (§9.6)：好奇 1.0 比 0.0 插入更多', () => {
    const mkClips = () => [
      clip({ id: 'idle_sit_01', state: 'idle_sit' }),
      clip({ id: 'yawn_01', state: 'yawn', signature: true, category: 'signature' }),
    ]
    const countYawns = (curiosity: number, seed: number): number => {
      const { scheduler } = makeScheduler({
        clips: mkClips(),
        weightOverrides: STAY_IDLE,
        config: {
          microRandom: { rateJitter: 0.05, idleJitterSec: 0.5, signatureProbability: 0.08 },
          personality: { ...NEUTRAL_PERSONALITY, curiosity },
          rareActions: ['yawn'],
          idleConfig: { idleIntervalMs: 100, activeIntervalMs: 100, exhaustionMultiplier: 1.5, exhaustionThreshold: 3 },
        },
        seed,
      })
      const commands = driveCycles(scheduler, 600_000)
      return commands.filter((c) => c.kind === 'play' && c.clip.id === 'yawn_01').length
    }

    // 同种子对比：curiosity=1.0 (×1.6) 应多于 curiosity=0.0 (×0.4)
    const curious = countYawns(1.0, 777)
    const incurious = countYawns(0.0, 777)
    expect(curious).toBeGreaterThan(incurious)
  })
})
