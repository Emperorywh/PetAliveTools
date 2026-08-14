import { describe, expect, it } from 'vitest'

import {
  advanceQueue,
  buildPlaybackQueue,
  completeCurrentItem,
  createSchedulingCycle,
  currentItem,
  initPlaybackQueue,
  isCurrentItemDone,
  type PlaybackItem,
} from '../../src/main/scheduler/lifecycle'
import type { TransitionPlan } from '../../src/main/behavior/anchor-transition'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

/**
 * 构造仅用于调度测试的内存片段。
 * fileName 指向已经存在的原样媒体文件，不包含任何处理参数。
 */
function clip(id: string, loop = false): ClipMeta {
  return {
    id,
    fileName: `${id}.webm`,
    state: 'idle_sit',
    category: 'basic',
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
 * 构造一条最小转移计划。
 * 计划只引用完整媒体文件，不提供视频时长或循环区间。
 */
function plan(steps: TransitionPlan['steps']): TransitionPlan {
  return {
    from: 'idle_sit',
    to: 'idle_sit',
    steps,
    crossAnchor: false,
    anchors: { from: 'sit', to: 'sit' },
    usedFallback: false,
  }
}

describe('原样片段播放队列', () => {
  it('所有视频步骤都等待 ended，而不是依赖探测出的时长', () => {
    const source = clip('idle_sit__none__01')
    const items = buildPlaybackQueue(plan([
      { kind: 'play', role: 'target', clip: source },
    ]))

    expect(items).toEqual([
      { kind: 'play', role: 'target', clip: source, durationMs: null },
    ])
    const queue = initPlaybackQueue(items, 0)
    expect(isCurrentItemDone(queue, 60_000)).toBe(false)
  })

  it('ended 通知显式推进到下一个完整文件', () => {
    const items: PlaybackItem[] = [
      { kind: 'play', clip: clip('first'), durationMs: null, role: 'cross_anchor' },
      { kind: 'play', clip: clip('second'), durationMs: null, role: 'target' },
    ]
    const queue = completeCurrentItem(initPlaybackQueue(items, 0), 900)

    expect(queue.currentIndex).toBe(1)
    expect(currentItem(queue)?.clip?.id).toBe('second')
  })

  it('界面停留步骤仍按自身毫秒时长推进', () => {
    const items: PlaybackItem[] = [
      { kind: 'hold', anchor: 'sit', durationMs: 100, role: 'anchor_hold' },
    ]
    const queue = initPlaybackQueue(items, 20)

    expect(isCurrentItemDone(queue, 119)).toBe(false)
    expect(isCurrentItemDone(queue, 120)).toBe(true)
    expect(advanceQueue(queue, 120).completed).toBe(true)
  })

  it('调度周期不接收视频时长解析器', () => {
    const target = clip('idle_sit__none__01', true)
    const transition = plan([{ kind: 'play', role: 'target', clip: target }])
    const cycle = createSchedulingCycle({
      fromState: 'idle_sit',
      toState: 'idle_sit',
      plan: transition,
      targetClip: target,
      nowMs: 10,
      idleIntervalMs: 4_000,
      isPlaceholder: false,
    })

    expect(cycle.queue.items[0]?.durationMs).toBeNull()
    expect(cycle.targetClip.fileName).toBe('idle_sit__none__01.webm')
  })
})
