import { describe, it, expect } from 'vitest'
import {
  buildPlaybackQueue,
  initPlaybackQueue,
  currentItem,
  isCurrentItemDone,
  advanceQueue,
  completeCurrentItem,
  createSchedulingCycle,
  type PlaybackItem,
} from '../../src/main/scheduler/lifecycle'
import { planStateTransition } from '../../src/main/behavior/anchor-transition'
import type { PlanContext } from '../../src/main/behavior/anchor-transition'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

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

function fullStore(): ClipMeta[] {
  return [
    clip({ id: 'idle_sit_01', state: 'idle_sit' }),
    clip({ id: 'stand_01', state: 'stand', anchor: 'stand' }),
    clip({ id: 'walk_left_01', state: 'walk', anchor: 'stand', direction: 'left' }),
    clip({ id: 'walk_right_01', state: 'walk', anchor: 'stand', direction: 'right' }),
    clip({ id: 'lie_01', state: 'lie', loop: true, anchor: 'none', loopInSec: 0, loopOutSec: 4 }),
    clip({ id: 'sleep_01', state: 'sleep', loop: true, anchor: 'none', loopInSec: 0, loopOutSec: 8 }),
    clip({ id: 'groom_01', state: 'groom', loop: true, anchor: 'none', loopInSec: 0, loopOutSec: 3 }),
    transitionClip('sit', 'stand'),
    transitionClip('stand', 'sit'),
    transitionClip('sit', 'lie'),
    transitionClip('lie', 'sit'),
    transitionClip('sit', 'sleep'),
    transitionClip('sleep', 'sit'),
  ]
}

function ctx(state: string, clip?: ClipMeta): PlanContext {
  return { state, clip: clip ?? null }
}

const durationProvider = (clipId: string): number => {
  if (clipId.startsWith('transition_')) return 0.5
  if (clipId.startsWith('walk_')) return 2.0
  if (clipId.startsWith('idle_sit')) return 3.0
  if (clipId.startsWith('stand')) return 2.0
  return 2.0
}

// —— buildPlaybackQueue —— //

describe('buildPlaybackQueue (§8, §9)', () => {
  it('converts same-anchor transition to single play step', () => {
    const plan = planStateTransition(ctx('idle_sit'), ctx('stand'), fullStore())
    const items = buildPlaybackQueue(plan, durationProvider)
    // idle_sit → stand: cross anchor, needs transition_sit_to_stand then target
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items.some((i) => i.kind === 'play')).toBe(true)
  })

  it('handles cross-anchor transition with intermediate clip', () => {
    const plan = planStateTransition(ctx('idle_sit'), ctx('walk'), fullStore())
    const items = buildPlaybackQueue(plan, durationProvider)
    // Should have: cross_anchor play (transition) + target play
    const playSteps = items.filter((i) => i.kind === 'play')
    expect(playSteps.length).toBeGreaterThanOrEqual(2)
  })

  it('sets durationMs for non-loop play items', () => {
    const plan = planStateTransition(ctx('idle_sit'), ctx('stand'), fullStore())
    const items = buildPlaybackQueue(plan, durationProvider)
    for (const item of items) {
      if (item.kind === 'play' && item.role !== 'target') {
        expect(item.durationMs).not.toBeNull()
      }
    }
  })

  it('sets durationMs=null for loop target items', () => {
    const plan = planStateTransition(ctx('idle_sit'), ctx('sleep'), fullStore())
    const items = buildPlaybackQueue(plan, durationProvider)
    const targetItem = items.find((i) => i.role === 'target')
    expect(targetItem).toBeDefined()
    expect(targetItem!.durationMs).toBeNull()
  })

  it('includes easing items for fallback', () => {
    const clipsNoTransition = [clip({ id: 'idle_sit_01', state: 'idle_sit' })]
    const plan = planStateTransition(ctx('idle_sit'), ctx('stand'), clipsNoTransition)
    const items = buildPlaybackQueue(plan, durationProvider)
    expect(items.some((i) => i.kind === 'easing')).toBe(true)
  })
})

// —— PlaybackQueue state machine —— //

describe('PlaybackQueue state machine', () => {
  function makeQueue(items: PlaybackItem[], nowMs = 0) {
    return initPlaybackQueue(items, nowMs)
  }

  it('returns null currentItem when completed', () => {
    const queue = makeQueue([])
    expect(queue.completed).toBe(true)
    expect(currentItem(queue)).toBeNull()
  })

  it('returns first item as current', () => {
    const items: PlaybackItem[] = [
      { kind: 'hold', anchor: 'sit', durationMs: 100, role: 'anchor_hold' },
      { kind: 'easing', durationMs: 50, reason: 'test', role: 'fallback' },
    ]
    const queue = makeQueue(items)
    expect(currentItem(queue)?.kind).toBe('hold')
  })

  it('isCurrentItemDone returns false for zero elapsed', () => {
    const items: PlaybackItem[] = [
      { kind: 'hold', anchor: 'sit', durationMs: 100, role: 'anchor_hold' },
    ]
    const queue = makeQueue(items, 0)
    expect(isCurrentItemDone(queue, 0)).toBe(false)
  })

  it('isCurrentItemDone returns true after duration elapsed', () => {
    const items: PlaybackItem[] = [
      { kind: 'hold', anchor: 'sit', durationMs: 100, role: 'anchor_hold' },
    ]
    const queue = makeQueue(items, 0)
    expect(isCurrentItemDone(queue, 100)).toBe(true)
    expect(isCurrentItemDone(queue, 200)).toBe(true)
  })

  it('isCurrentItemDone returns false for durationMs=null items', () => {
    const items: PlaybackItem[] = [
      { kind: 'play', clip: clip({ id: 'x', state: 'idle_sit' }), durationMs: null, role: 'target' },
    ]
    const queue = makeQueue(items, 0)
    expect(isCurrentItemDone(queue, 99999)).toBe(false)
  })

  it('advanceQueue moves to next item', () => {
    const items: PlaybackItem[] = [
      { kind: 'hold', anchor: 'sit', durationMs: 100, role: 'anchor_hold' },
      { kind: 'easing', durationMs: 50, reason: 'test', role: 'fallback' },
    ]
    let queue = makeQueue(items, 0)
    queue = advanceQueue(queue, 100)
    expect(currentItem(queue)?.kind).toBe('easing')
    expect(queue.currentIndex).toBe(1)
  })

  it('advanceQueue marks completed on last item', () => {
    const items: PlaybackItem[] = [
      { kind: 'hold', anchor: 'sit', durationMs: 100, role: 'anchor_hold' },
    ]
    let queue = makeQueue(items, 0)
    queue = advanceQueue(queue, 100)
    expect(queue.completed).toBe(true)
  })

  it('completeCurrentItem advances queue for null-duration items', () => {
    const items: PlaybackItem[] = [
      { kind: 'play', clip: clip({ id: 'x', state: 'idle_sit' }), durationMs: null, role: 'target' },
      { kind: 'easing', durationMs: 50, reason: 'test', role: 'fallback' },
    ]
    let queue = makeQueue(items, 0)
    queue = completeCurrentItem(queue, 5000)
    expect(queue.currentIndex).toBe(1)
    expect(currentItem(queue)?.kind).toBe('easing')
  })
})

// —— createSchedulingCycle —— //

describe('createSchedulingCycle', () => {
  it('builds a complete cycle from plan + target info', () => {
    const plan = planStateTransition(ctx('idle_sit'), ctx('stand'), fullStore())
    const cycle = createSchedulingCycle({
      fromState: 'idle_sit',
      toState: 'stand',
      plan,
      targetClip: clip({ id: 'stand_01', state: 'stand', anchor: 'stand' }),
      getClipDurationSec: durationProvider,
      nowMs: 0,
      idleIntervalMs: 4000,
      isPlaceholder: false,
    })
    expect(cycle.fromState).toBe('idle_sit')
    expect(cycle.toState).toBe('stand')
    expect(cycle.idleIntervalMs).toBe(4000)
    expect(cycle.isPlaceholder).toBe(false)
    expect(cycle.queue.completed).toBe(false)
    expect(cycle.queue.items.length).toBeGreaterThanOrEqual(1)
  })
})
