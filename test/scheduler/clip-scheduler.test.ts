import { describe, expect, it } from 'vitest'

import { BehaviorFsm } from '../../src/main/behavior/fsm'
import {
  ClipScheduler,
  type ClipSchedulerConfig,
} from '../../src/main/scheduler/clip-scheduler'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

/**
 * 构造已从 clips/ 扫描出来的片段描述。
 * 调度器只能选择 fileName，不获得媒体时长、轨迹或画面变换参数。
 */
function clip(id: string, state: string, loop = false): ClipMeta {
  return {
    id,
    fileName: `${id}.webm`,
    state,
    category: state === 'petted' ? 'interactive' : 'basic',
    direction: 'none',
    anchor: 'sit',
    loop,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: true,
    audio: null,
    hitbox: [0.1, 0.05, 0.8, 0.9],
  }
}

/**
 * 使用确定性随机源创建调度器。
 * 配置只包含行为节奏，不包含任何视频处理或窗口运动参数。
 */
function scheduler(clips: readonly ClipMeta[]): ClipScheduler {
  const config: ClipSchedulerConfig = {
    idleConfig: {
      idleIntervalMs: 8_000,
      activeIntervalMs: 3_000,
      exhaustionMultiplier: 1.5,
      exhaustionThreshold: 3,
    },
    planOptions: {},
    rng: () => 0,
  }
  return new ClipScheduler({ fsm: new BehaviorFsm({ rng: () => 0 }), clips }, config)
}

describe('原样片段调度器', () => {
  it('交互抢占只发出最小文件播放命令', () => {
    const target = clip('petted__none__01', 'petted')
    const instance = scheduler([
      clip('idle_sit__none__01', 'idle_sit', true),
      target,
    ])
    const result = instance.preempt('petted', 100)
    const play = result.commands.find((command) => command.kind === 'play')

    expect(play).toEqual({ kind: 'play', clip: target, loop: false })
    expect(play).not.toHaveProperty('playbackRate')
    expect(play).not.toHaveProperty('mirrored')
    expect(play).not.toHaveProperty('walk')
  })

  it('墙钟推进不会猜测非循环视频已经结束', () => {
    const instance = scheduler([
      clip('idle_sit__none__01', 'idle_sit', true),
      clip('petted__none__01', 'petted'),
    ])
    instance.preempt('petted', 0)

    const afterLongWait = instance.tick(3_600_000)
    expect(afterLongWait.cycleCompleted).toBe(false)
    expect(instance.snapshot.phase).toBe('cycling')
  })

  it('只有 ended 对应的显式完成调用才推进非循环文件', () => {
    const instance = scheduler([
      clip('idle_sit__none__01', 'idle_sit', true),
      clip('petted__none__01', 'petted'),
    ])
    instance.preempt('petted', 0)
    const completed = instance.completeCurrentPlayback(1_000)

    expect(completed.cycleCompleted).toBe(true)
    expect(instance.snapshot.phase).toBe('idle')
  })

  it('循环标记只表示完整文件循环', () => {
    const instance = scheduler([
      clip('idle_sit__none__01', 'idle_sit', true),
      clip('petted__none__01', 'petted', true),
    ])
    instance.preempt('petted', 0)

    expect(instance.isPlayingLoop).toBe(true)
  })

  it('指定片段预览立即播放该文件本身，不做转移规划', () => {
    const variantA = clip('walk__left__01', 'walk')
    const variantB = clip('walk__left__02', 'walk')
    const instance = scheduler([
      clip('idle_sit__none__01', 'idle_sit', true),
      variantA,
      variantB,
    ])

    const result = instance.preemptClip(variantB, 100)

    expect(result.commands).toEqual([{ kind: 'play', clip: variantB, loop: false }])
  })

  it('指定片段预览结束后保持 FSM 状态并回到空闲', () => {
    const target = clip('sleep__none__01', 'sleep')
    const instance = scheduler([clip('idle_sit__none__01', 'idle_sit', true), target])
    const fsmBefore = instance.snapshot.fsmState

    instance.preemptClip(target, 0)
    const completed = instance.completeCurrentPlayback(1_000)

    expect(completed.cycleCompleted).toBe(true)
    expect(instance.snapshot.phase).toBe('idle')
    expect(instance.snapshot.fsmState).toBe(fsmBefore)
  })

  it('指定循环片段预览按整段循环播放', () => {
    const target = clip('idle_sit__none__02', 'idle_sit', true)
    const instance = scheduler([clip('idle_sit__none__01', 'idle_sit', true), target])

    instance.preemptClip(target, 0)

    expect(instance.isPlayingLoop).toBe(true)
  })
})

describe('情绪动作插入 (§9.4 情绪表达)', () => {
  function emotionScheduler(
    clips: readonly ClipMeta[],
    needs: { hunger: number; fatigue: number; happiness: number; attention: number } | null,
    overrides: Partial<ClipSchedulerConfig> = {},
  ): ClipScheduler {
    const config: ClipSchedulerConfig = {
      idleConfig: {
        idleIntervalMs: 8_000,
        activeIntervalMs: 3_000,
        exhaustionMultiplier: 1.5,
        exhaustionThreshold: 3,
      },
      planOptions: {},
      rng: () => 0,
      needsProvider: () => needs,
      ...overrides,
    }
    return new ClipScheduler({ fsm: new BehaviorFsm({ rng: () => 0 }), clips }, config)
  }

  it('饥饿高位时插入讨食片段且不推进 FSM', () => {
    const hungry = { hunger: 90, fatigue: 20, happiness: 70, attention: 70 }
    const instance = emotionScheduler(
      [clip('idle_sit__none__01', 'idle_sit', true), clip('beg_food__none__01', 'beg_food')],
      hungry,
    )

    const result = instance.tick(0)

    expect(result.cycleStarted).toBe(true)
    expect(result.commands).toContainEqual({
      kind: 'play',
      clip: clip('beg_food__none__01', 'beg_food'),
      loop: false,
    })
    // 插入周期 preserveFsm：FSM 状态保持 idle_sit
    expect(instance.snapshot.fsmState).toBe('idle_sit')
    expect(instance.snapshot.cycle?.preserveFsm).toBe(true)
  })

  it('候选组内只在有真实片段的状态中选择（讨食缺失时选喝水）', () => {
    const hungry = { hunger: 90, fatigue: 20, happiness: 70, attention: 70 }
    const instance = emotionScheduler(
      [clip('idle_sit__none__01', 'idle_sit', true), clip('drink__none__01', 'drink')],
      hungry,
    )

    const result = instance.tick(0)

    expect(result.commands.some((cmd) => cmd.kind === 'play' && cmd.clip.state === 'drink')).toBe(
      true,
    )
  })

  it('愉悦低位插入无聊、注意力低位插入求玩', () => {
    const boredState = { hunger: 20, fatigue: 20, happiness: 20, attention: 70 }
    const bored = emotionScheduler(
      [clip('idle_sit__none__01', 'idle_sit', true), clip('bored__none__01', 'bored', true)],
      boredState,
    )
    expect(
      bored.tick(0).commands.some((cmd) => cmd.kind === 'play' && cmd.clip.state === 'bored'),
    ).toBe(true)

    const lonely = { hunger: 20, fatigue: 20, happiness: 70, attention: 20 }
    const wantPlay = emotionScheduler(
      [clip('idle_sit__none__01', 'idle_sit', true), clip('want_play__none__01', 'want_play')],
      lonely,
    )
    expect(
      wantPlay
        .tick(0)
        .commands.some((cmd) => cmd.kind === 'play' && cmd.clip.state === 'want_play'),
    ).toBe(true)
  })

  it('冷却期内同一情绪不重复插入，走 FSM 常规路径', () => {
    const hungry = { hunger: 90, fatigue: 20, happiness: 70, attention: 70 }
    const instance = emotionScheduler(
      [clip('idle_sit__none__01', 'idle_sit', true), clip('beg_food__none__01', 'beg_food')],
      hungry,
      { emotionCooldownMs: 60_000 },
    )

    instance.tick(0)
    instance.completeCurrentPlayback(1_000)

    // 冷却内（t=2000 距插入 t=0 仅 2s）：不再插入 beg_food，走 FSM（→lie）
    const second = instance.tick(2_000)
    expect(second.cycleStarted).toBe(true)
    expect(instance.snapshot.cycle?.toState).not.toBe('beg_food')

    // 推完该周期（缺过渡 → 兜底缓动 + play 两项）
    instance.tick(2_100)
    instance.completeCurrentPlayback(3_000)

    // 冷却过后（t=61s）可再次插入
    instance.tick(61_000)
    expect(instance.snapshot.cycle?.toState).toBe('beg_food')
  })

  it('无需求提供者时不插入情绪动作', () => {
    const instance = emotionScheduler(
      [clip('idle_sit__none__01', 'idle_sit', true), clip('beg_food__none__01', 'beg_food')],
      null,
    )

    const result = instance.tick(0)

    expect(instance.snapshot.cycle?.toState).not.toBe('beg_food')
    expect(result.cycleStarted).toBe(true)
  })
})

describe('行走朝向连续性 (§9.5 方向变体)', () => {
  /** 带方向标记的片段（本文件基础 clip 助手固定 direction: none） */
  function dclip(id: string, state: string, direction: 'left' | 'right'): ClipMeta {
    return { ...clip(id, state), direction }
  }

  function facingScheduler(fsmRng: () => number, clips: readonly ClipMeta[]): ClipScheduler {
    const config: ClipSchedulerConfig = {
      idleConfig: {
        idleIntervalMs: 1,
        activeIntervalMs: 1,
        exhaustionMultiplier: 1.5,
        exhaustionThreshold: 3,
      },
      planOptions: {},
      rng: () => 0.9,
    }
    return new ClipScheduler({ fsm: new BehaviorFsm({ rng: fsmRng }), clips }, config)
  }

  /**
   * 驱动调度器完成当前周期回到 idle，并推进到下一个周期开始。
   * play 项以显式完成调用模拟 ended，计时项按时间推进。
   */
  function runCycle(instance: ClipScheduler, startMs: number): void {
    let nowMs = startMs
    instance.tick(nowMs)
    let guard = 0
    while (instance.snapshot.phase === 'cycling' && guard++ < 10) {
      const cycle = instance.snapshot.cycle
      if (!cycle || cycle.queue.completed) break
      const item = cycle.queue.items[cycle.queue.currentIndex]
      if (!item) break
      if (item.durationMs === null) {
        instance.completeCurrentPlayback(nowMs + 5_000)
        nowMs += 5_000
      } else {
        nowMs = cycle.queue.currentItemStartMs + item.durationMs + 1
        instance.tick(nowMs)
      }
    }
  }

  it('优先选择与当前朝向同向的行走片段，转身更新朝向后行走方向跟随', () => {
    const clips = [
      clip('idle_sit__none__01', 'idle_sit', true),
      clip('stand__none__01', 'stand'),
      dclip('walk__left__01', 'walk', 'left'),
      dclip('walk__right__01', 'walk', 'right'),
      dclip('turn__left__01', 'turn', 'left'),
    ]
    // FSM 随机源：首步 idle_sit→stand（0.5），此后 stand→walk、turn→walk 等
    // 全部命中 walk/turn 分支（0.9 / 0）
    let draw = 0
    const seq = [0.5, 0.9, 0.9, 0]
    const instance = facingScheduler(() => seq[draw++ % seq.length] ?? 0, clips)

    // 周期 1：idle_sit → stand（跨锚定走兜底缓动）
    runCycle(instance, 0)
    expect(instance.snapshot.fsmState).toBe('stand')

    // 周期 2：stand → walk。初始朝向 right → 应选向右片段
    runCycle(instance, 10_000)
    expect(instance.snapshot.fsmState).toBe('walk')
    expect(instance.snapshot.lastClip?.direction).toBe('right')
    expect(instance.snapshot.facing).toBe('right')

    // 周期 3：walk → turn（0.9*5=4.5 → turn）。仅有向左转身片段 → 朝向翻转为 left
    runCycle(instance, 20_000)
    expect(instance.snapshot.fsmState).toBe('turn')
    expect(instance.snapshot.lastClip?.direction).toBe('left')
    expect(instance.snapshot.facing).toBe('left')

    // 周期 4：turn → walk。朝向 left → 应选向左片段，位移方向与画面一致
    runCycle(instance, 30_000)
    expect(instance.snapshot.fsmState).toBe('walk')
    expect(instance.snapshot.lastClip?.direction).toBe('left')
    expect(instance.snapshot.facing).toBe('left')
  })

  it('左右转身片段齐备时转身选择异向片段，朝向随转身往复翻转', () => {
    const clips = [
      clip('idle_sit__none__01', 'idle_sit', true),
      clip('stand__none__01', 'stand'),
      dclip('walk__left__01', 'walk', 'left'),
      dclip('walk__right__01', 'walk', 'right'),
      dclip('turn__left__01', 'turn', 'left'),
      dclip('turn__right__01', 'turn', 'right'),
    ]
    // FSM 随机源循环 [0.5, 0.9, 0.9, 0]：stand→walk、walk→turn、turn→walk
    let draw = 0
    const seq = [0.5, 0.9, 0.9, 0]
    const instance = facingScheduler(() => seq[draw++ % seq.length] ?? 0, clips)

    // 周期 1：idle_sit → stand
    runCycle(instance, 0)

    // 周期 2：stand → walk。初始朝向 right → 选向右片段
    runCycle(instance, 10_000)
    expect(instance.snapshot.fsmState).toBe('walk')
    expect(instance.snapshot.lastClip?.direction).toBe('right')

    // 周期 3：walk → turn。朝向 right → 应选异向 turn__left 翻转朝向
    runCycle(instance, 20_000)
    expect(instance.snapshot.fsmState).toBe('turn')
    expect(instance.snapshot.lastClip?.direction).toBe('left')
    expect(instance.snapshot.facing).toBe('left')

    // 周期 4：turn → walk。朝向 left → 选向左片段
    runCycle(instance, 30_000)
    expect(instance.snapshot.lastClip?.direction).toBe('left')

    // 周期 5：walk → stand（0.5*5=2.5 → stand）
    runCycle(instance, 40_000)

    // 周期 6：stand → walk。朝向 left → 选向左片段
    runCycle(instance, 50_000)
    expect(instance.snapshot.lastClip?.direction).toBe('left')

    // 周期 7：walk → turn。朝向 left → 应选异向 turn__right 再度翻转
    runCycle(instance, 60_000)
    expect(instance.snapshot.fsmState).toBe('turn')
    expect(instance.snapshot.lastClip?.direction).toBe('right')
    expect(instance.snapshot.facing).toBe('right')

    // 周期 8：turn → walk。朝向 right → 选向右片段
    runCycle(instance, 70_000)
    expect(instance.snapshot.lastClip?.direction).toBe('right')
  })

  it('无同向片段时退回任意方向片段', () => {
    const clips = [
      clip('idle_sit__none__01', 'idle_sit', true),
      clip('stand__none__01', 'stand'),
      dclip('walk__left__01', 'walk', 'left'),
    ]
    let draw = 0
    const seq = [0.5, 0.9]
    const instance = facingScheduler(() => seq[draw++ % seq.length] ?? 0, clips)

    runCycle(instance, 0)
    runCycle(instance, 10_000)

    // 初始朝向 right 但只有向左片段 → 仍可播放，朝向跟随片段
    expect(instance.snapshot.fsmState).toBe('walk')
    expect(instance.snapshot.lastClip?.direction).toBe('left')
    expect(instance.snapshot.facing).toBe('left')
  })
})
