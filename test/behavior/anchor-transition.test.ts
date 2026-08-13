import { describe, it, expect } from 'vitest'
import {
  STATE_ANCHORS,
  ANCHOR_STATE,
  LOOP_FRAGMENT_STATES,
  isLoopFragmentState,
  resolveAnchorPose,
  FALLBACK_EASING_MS_RANGE,
  DEFAULT_FALLBACK_EASING_MS,
  PROP_FADE_MS_RANGE,
  DEFAULT_PROP_FADE_MS,
  clampFallbackEasingMs,
  clampPropFadeMs,
  planStateTransition,
} from '../../src/main/behavior/anchor-transition'
import type { TransitionPlan, PlanContext } from '../../src/main/behavior/anchor-transition'
import { isPlaceholderClip } from '../../src/main/persistence/placeholder'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

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

/** 完整素材库：全部基础状态 + §4.4 过渡项 + 一个道具片段 */
function fullStore(): ClipMeta[] {
  return [
    clip({ id: 'idle_sit_01', state: 'idle_sit' }),
    clip({ id: 'stand_01', state: 'stand', anchor: 'stand' }),
    clip({ id: 'walk_left_01', state: 'walk', anchor: 'stand', direction: 'left' }),
    clip({ id: 'turn_01', state: 'turn', anchor: 'stand', direction: 'left' }),
    clip({ id: 'lie_01', state: 'lie', loop: true, anchor: 'none', loopInSec: 0, loopOutSec: 4 }),
    clip({ id: 'sleep_01', state: 'sleep', loop: true, anchor: 'none', loopInSec: 0, loopOutSec: 8 }),
    clip({ id: 'groom_01', state: 'groom', loop: true, anchor: 'none', loopInSec: 0, loopOutSec: 3 }),
    transitionClip('sit', 'stand'),
    transitionClip('stand', 'sit'),
    transitionClip('sit', 'lie'),
    transitionClip('lie', 'sit'),
    transitionClip('sit', 'sleep'),
    transitionClip('sleep', 'sit'),
    transitionClip('sit', 'groom'),
    transitionClip('groom', 'sit'),
    clip({ id: 'beg_food_01', state: 'beg_food', prop: true, category: 'emotion' }),
  ]
}

function ctx(state: string, clip?: ClipMeta): PlanContext {
  return { state, clip: clip ?? null }
}

function plan(from: string, to: string, clips: ClipMeta[] = fullStore()): TransitionPlan {
  return planStateTransition(ctx(from), ctx(to), clips)
}

describe('anchor classification (§4.2 / §8.2)', () => {
  it('STATE_ANCHORS maps basic states to their mediation anchor', () => {
    expect(STATE_ANCHORS.idle_sit).toBe('sit')
    expect(STATE_ANCHORS.stand).toBe('stand')
    expect(STATE_ANCHORS.walk).toBe('stand')
    expect(STATE_ANCHORS.turn).toBe('stand')
    expect(STATE_ANCHORS.lie).toBe('sit')
    expect(STATE_ANCHORS.sleep).toBe('sit')
    expect(STATE_ANCHORS.groom).toBe('sit')
  })

  it('ANCHOR_STATE maps poses back to anchor states', () => {
    expect(ANCHOR_STATE.sit).toBe('idle_sit')
    expect(ANCHOR_STATE.stand).toBe('stand')
  })

  it('loop fragment states are exactly lie / sleep / groom (§8.2)', () => {
    expect([...LOOP_FRAGMENT_STATES].sort()).toEqual(['groom', 'lie', 'sleep'])
    expect(isLoopFragmentState('lie')).toBe(true)
    expect(isLoopFragmentState('idle_sit')).toBe(false)
    expect(isLoopFragmentState('walk')).toBe(false)
  })

  it('resolveAnchorPose uses clip anchor for non-basic states and defaults to sit', () => {
    expect(resolveAnchorPose('petted', clip({ id: 'p1', state: 'petted', anchor: 'sit' }))).toBe('sit')
    expect(resolveAnchorPose('unknown', clip({ id: 'u1', state: 'unknown', anchor: 'stand' }))).toBe('stand')
    expect(resolveAnchorPose('unknown', clip({ id: 'u2', state: 'unknown', anchor: 'none' }))).toBe('sit')
  })
})

describe('duration bounds (§8.3 / §8.4)', () => {
  it('fallback easing is clamped to 60–120ms', () => {
    expect(FALLBACK_EASING_MS_RANGE).toEqual([60, 120])
    expect(clampFallbackEasingMs(10)).toBe(60)
    expect(clampFallbackEasingMs(90)).toBe(90)
    expect(clampFallbackEasingMs(999)).toBe(120)
  })

  it('prop fade is clamped to 150–250ms', () => {
    expect(PROP_FADE_MS_RANGE).toEqual([150, 250])
    expect(clampPropFadeMs(50)).toBe(150)
    expect(clampPropFadeMs(200)).toBe(200)
    expect(clampPropFadeMs(1000)).toBe(250)
  })

  it('defaults sit inside the spec ranges', () => {
    expect(DEFAULT_FALLBACK_EASING_MS).toBeGreaterThanOrEqual(60)
    expect(DEFAULT_FALLBACK_EASING_MS).toBeLessThanOrEqual(120)
    expect(DEFAULT_PROP_FADE_MS).toBeGreaterThanOrEqual(150)
    expect(DEFAULT_PROP_FADE_MS).toBeLessThanOrEqual(250)
  })
})

describe('same-anchor transitions (§8.1)', () => {
  it('stand → walk plays the target clip directly', () => {
    const p = plan('stand', 'walk')
    expect(p.steps).toEqual([{ kind: 'play', role: 'target', clip: expect.objectContaining({ id: 'walk_left_01' }) }])
    expect(p.crossAnchor).toBe(false)
    expect(p.usedFallback).toBe(false)
    expect(p.anchors).toEqual({ from: 'stand', to: 'stand' })
  })

  it('walk → turn and walk → stay-at-stand need no transition clip', () => {
    expect(plan('walk', 'turn').steps).toHaveLength(1)
    expect(plan('walk', 'stand').steps).toHaveLength(1)
    expect(plan('walk', 'turn').crossAnchor).toBe(false)
  })
})

describe('cross-anchor transitions via transition clips (§8.1)', () => {
  it('idle_sit → walk plays sit→stand transition clip first', () => {
    const p = plan('idle_sit', 'walk')
    expect(p.crossAnchor).toBe(true)
    expect(p.anchors).toEqual({ from: 'sit', to: 'stand' })
    expect(p.steps.map((s) => [s.kind, s.role, s.clip?.id])).toEqual([
      ['play', 'cross_anchor', 'transition_sit_to_stand'],
      ['play', 'target', 'walk_left_01'],
    ])
  })

  it('idle_sit → stand crosses via the sit→stand transition clip', () => {
    const p = plan('idle_sit', 'stand')
    expect(p.crossAnchor).toBe(true)
    expect(p.steps[0].clip?.id).toBe('transition_sit_to_stand')
    expect(p.steps[1].clip?.id).toBe('stand_01')
  })

  it('stand → idle_sit crosses back via stand→sit', () => {
    const p = plan('stand', 'idle_sit')
    expect(p.crossAnchor).toBe(true)
    expect(p.steps[0].clip?.id).toBe('transition_stand_to_sit')
    expect(p.steps[1].clip?.id).toBe('idle_sit_01')
  })

  it('inserts an optional anchor hold between transition and target (§8.1 锚定可短暂停留)', () => {
    const p = planStateTransition(ctx('idle_sit'), ctx('walk'), fullStore(), { holdAnchorMs: 150 })
    expect(p.steps).toEqual([
      expect.objectContaining({ kind: 'play', role: 'cross_anchor' }),
      expect.objectContaining({ kind: 'hold', role: 'anchor_hold', anchor: 'stand', durationMs: 150 }),
      expect.objectContaining({ kind: 'play', role: 'target' }),
    ])
  })

  it('holdAnchorMs = 0 inserts no hold step', () => {
    const p = planStateTransition(ctx('idle_sit'), ctx('walk'), fullStore(), { holdAnchorMs: 0 })
    expect(p.steps.some((s) => s.kind === 'hold')).toBe(false)
  })
})

describe('loop fragment enter / exit via transition clips (§8.2)', () => {
  it('idle_sit → lie: sit→lie enter transition then the loop clip', () => {
    const p = plan('idle_sit', 'lie')
    expect(p.steps.map((s) => [s.role, s.clip?.id])).toEqual([
      ['enter_loop', 'transition_sit_to_lie'],
      ['target', 'lie_01'],
    ])
    expect(p.usedFallback).toBe(false)
    expect(p.anchors).toEqual({ from: 'sit', to: 'sit' })
  })

  it('lie → idle_sit: lie→sit exit transition then the anchor clip', () => {
    const p = plan('lie', 'idle_sit')
    expect(p.steps.map((s) => [s.role, s.clip?.id])).toEqual([
      ['exit_loop', 'transition_lie_to_sit'],
      ['target', 'idle_sit_01'],
    ])
  })

  it('idle_sit → sleep / groom use their dedicated enter transitions', () => {
    expect(plan('idle_sit', 'sleep').steps[0].clip?.id).toBe('transition_sit_to_sleep')
    expect(plan('idle_sit', 'groom').steps[0].clip?.id).toBe('transition_sit_to_groom')
  })

  it('sleep → lie chains exit then enter transitions around the loop switch', () => {
    const p = plan('sleep', 'lie')
    expect(p.steps.map((s) => [s.role, s.clip?.id])).toEqual([
      ['exit_loop', 'transition_sleep_to_sit'],
      ['enter_loop', 'transition_sit_to_lie'],
      ['target', 'lie_01'],
    ])
  })

  it('walk → lie first crosses stand→sit, then enters the loop', () => {
    const p = plan('walk', 'lie')
    expect(p.crossAnchor).toBe(true)
    expect(p.steps.map((s) => [s.role, s.clip?.id])).toEqual([
      ['cross_anchor', 'transition_stand_to_sit'],
      ['enter_loop', 'transition_sit_to_lie'],
      ['target', 'lie_01'],
    ])
  })

  it('groom → stand exits the loop then crosses sit→stand', () => {
    const p = plan('groom', 'stand')
    expect(p.steps.map((s) => [s.role, s.clip?.id])).toEqual([
      ['exit_loop', 'transition_groom_to_sit'],
      ['cross_anchor', 'transition_sit_to_stand'],
      ['target', 'stand_01'],
    ])
  })
})

describe('fallback easing when anchor transition is unavailable (§8.3)', () => {
  it('missing cross-anchor clip yields a 60–120ms easing step instead', () => {
    const empty: ClipMeta[] = []
    const p = planStateTransition(ctx('idle_sit'), ctx('walk'), empty)
    expect(p.usedFallback).toBe(true)
    expect(p.crossAnchor).toBe(true)
    expect(p.steps[0].kind).toBe('easing')
    expect(p.steps[0].role).toBe('fallback')
    expect(p.steps[0].durationMs).toBeGreaterThanOrEqual(60)
    expect(p.steps[0].durationMs).toBeLessThanOrEqual(120)
    expect(p.steps[0].reason).toContain('sit -> stand')
    // 第二步目标片段解析为占位片段（§5.5），不崩溃
    expect(isPlaceholderClip(p.steps[1].clip!)).toBe(true)
  })

  it('missing loop-enter clip yields an easing step before the loop clip', () => {
    const p = planStateTransition(ctx('idle_sit'), ctx('lie'), [])
    expect(p.usedFallback).toBe(true)
    expect(p.steps[0]).toMatchObject({ kind: 'easing', role: 'fallback' })
    expect(p.steps[0].reason).toContain('sit -> lie')
  })

  it('missing loop-exit clip yields an easing step when leaving a loop', () => {
    const p = planStateTransition(ctx('sleep'), ctx('idle_sit'), [])
    expect(p.usedFallback).toBe(true)
    expect(p.steps[0]).toMatchObject({ kind: 'easing', role: 'fallback' })
    expect(p.steps[0].reason).toContain('sleep -> sit')
  })

  it('custom easingMs is clamped into the 60–120ms band', () => {
    const p = planStateTransition(ctx('idle_sit'), ctx('walk'), [], { easingMs: 5000 })
    expect(p.steps[0].durationMs).toBe(120)
    const q = planStateTransition(ctx('idle_sit'), ctx('walk'), [], { easingMs: 1 })
    expect(q.steps[0].durationMs).toBe(60)
  })
})

describe('prop clip transitions (§8.4)', () => {
  it('entering a prop clip fades in for 150–250ms without anchor mediation', () => {
    const p = plan('idle_sit', 'beg_food')
    expect(p.crossAnchor).toBe(false)
    expect(p.steps.map((s) => s.kind)).toEqual(['fade_in', 'play'])
    const fade = p.steps[0]
    expect(fade.durationMs).toBeGreaterThanOrEqual(150)
    expect(fade.durationMs).toBeLessThanOrEqual(250)
    expect(fade.holdPosition).toBe(true) // 淡化期间窗口位置不动
    expect(p.steps[1].clip?.id).toBe('beg_food_01')
    expect(p.steps.some((s) => s.role === 'cross_anchor' || s.role === 'enter_loop')).toBe(false)
  })

  it('leaving a prop clip fades out, returns to the anchor, then continues', () => {
    const p = plan('beg_food', 'walk')
    expect(p.steps.map((s) => [s.kind, s.role, s.clip?.id])).toEqual([
      ['fade_out', 'return_to_anchor', 'beg_food_01'],
      ['play', 'return_to_anchor', 'idle_sit_01'],
      ['play', 'cross_anchor', 'transition_sit_to_stand'],
      ['play', 'target', 'walk_left_01'],
    ])
    expect(p.steps[0].holdPosition).toBe(true)
    expect(p.steps[0].durationMs).toBeGreaterThanOrEqual(150)
  })

  it('leaving a prop clip toward its anchor state plays the anchor clip directly after fade-out', () => {
    const p = plan('beg_food', 'idle_sit')
    expect(p.steps.map((s) => [s.kind, s.role])).toEqual([
      ['fade_out', 'return_to_anchor'],
      ['play', 'target'],
    ])
    expect(p.steps[1].clip?.id).toBe('idle_sit_01')
  })

  it('custom propFadeMs is clamped into the 150–250ms band', () => {
    const p = planStateTransition(ctx('idle_sit'), ctx('beg_food'), fullStore(), { propFadeMs: 10 })
    expect(p.steps[0].durationMs).toBe(150)
    const q = planStateTransition(ctx('idle_sit'), ctx('beg_food'), fullStore(), { propFadeMs: 9999 })
    expect(q.steps[0].durationMs).toBe(250)
  })

  it('prop → prop transition fades out to anchor then fades into the next prop', () => {
    const p = plan('beg_food', 'beg_food')
    expect(p.steps.map((s) => [s.kind, s.role, s.clip?.id])).toEqual([
      ['fade_out', 'return_to_anchor', 'beg_food_01'],
      ['play', 'return_to_anchor', 'idle_sit_01'],
      ['fade_in', 'target', 'beg_food_01'],
      ['play', 'target', 'beg_food_01'],
    ])
  })
})

describe('planner robustness (§5.5 占位兜底)', () => {
  it('resolves missing target states to placeholder clips instead of crashing', () => {
    const p = plan('idle_sit', 'turn', [clip({ id: 'idle_sit_01', state: 'idle_sit' })])
    expect(p.steps[p.steps.length - 1].kind).toBe('play')
    expect(isPlaceholderClip(p.steps[p.steps.length - 1].clip!)).toBe(true)
  })

  it('uses the provided playing clip instead of re-resolving from state', () => {
    const custom = clip({ id: 'walk_right_99', state: 'walk', anchor: 'stand', direction: 'right' })
    const p = planStateTransition({ state: 'stand', clip: null }, { state: 'walk', clip: custom }, fullStore())
    expect(p.steps[0].clip?.id).toBe('walk_right_99')
  })
})
