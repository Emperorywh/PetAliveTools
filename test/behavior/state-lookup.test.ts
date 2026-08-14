import { describe, it, expect } from 'vitest'
import {
  TRANSITION_CLIP_STATE,
  ENDPOINTS,
  transitionClipId,
  parseTransitionClip,
  findTransitionClip,
  getClipVariants,
  selectClipForState,
} from '../../src/main/behavior/state-lookup'
import { isPlaceholderClip } from '../../src/main/persistence/placeholder'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

function clip(overrides: Partial<ClipMeta> & Pick<ClipMeta, 'id' | 'state'>): ClipMeta {
  return {
    fileName: 'test.webm',
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

function transitionClip(from: string, to: string): ClipMeta {
  return clip({ id: `transition_${from}_to_${to}`, state: TRANSITION_CLIP_STATE, anchor: 'none' })
}

describe('transition clip id convention (§4.4 过渡项)', () => {
  it('ENDPOINTS covers both anchors and the three loop fragments', () => {
    expect(ENDPOINTS).toEqual(['sit', 'stand', 'lie', 'sleep', 'groom'])
  })

  it('transitionClipId builds the canonical id', () => {
    expect(transitionClipId('sit', 'stand')).toBe('transition_sit_to_stand')
    expect(transitionClipId('lie', 'sit')).toBe('transition_lie_to_sit')
  })

  it('parses valid transition clips into endpoints', () => {
    expect(parseTransitionClip(transitionClip('sit', 'stand'))).toEqual({ from: 'sit', to: 'stand' })
    expect(parseTransitionClip(transitionClip('groom', 'sit'))).toEqual({ from: 'groom', to: 'sit' })
  })

  it('returns null for non-transition clips or malformed ids', () => {
    expect(parseTransitionClip(clip({ id: 'idle_sit_01', state: 'idle_sit' }))).toBeNull()
    expect(parseTransitionClip(transitionClip('sit', 'run'))).toBeNull()
    expect(parseTransitionClip(transitionClip('fly', 'sit'))).toBeNull()
    expect(parseTransitionClip(clip({ id: '起身过渡', state: TRANSITION_CLIP_STATE }))).toBeNull()
  })

  it('findTransitionClip matches only the exact endpoint pair', () => {
    const clips = [transitionClip('sit', 'stand'), transitionClip('stand', 'sit'), transitionClip('sit', 'lie')]
    expect(findTransitionClip('sit', 'stand', clips)?.id).toBe('transition_sit_to_stand')
    expect(findTransitionClip('stand', 'sit', clips)?.id).toBe('transition_stand_to_sit')
    expect(findTransitionClip('lie', 'sit', clips)).toBeUndefined()
  })
})

describe('getClipVariants (§9.5 多变体)', () => {
  it('returns state variants sorted by variant number ascending', () => {
    const clips = [
      clip({ id: 'idle_3', state: 'idle_sit', variant: 3 }),
      clip({ id: 'idle_1', state: 'idle_sit', variant: 1 }),
      clip({ id: 'idle_2', state: 'idle_sit', variant: 2 }),
      clip({ id: 'walk_l', state: 'walk', variant: 1 }),
    ]
    expect(getClipVariants('idle_sit', clips).map((c) => c.id)).toEqual(['idle_1', 'idle_2', 'idle_3'])
    expect(getClipVariants('walk', clips).map((c) => c.id)).toEqual(['walk_l'])
  })

  it('returns empty array for states without clips', () => {
    expect(getClipVariants('groom', [])).toEqual([])
  })
})

describe('selectClipForState (§5.5 占位兜底)', () => {
  it('defaults to the lowest-numbered variant', () => {
    const clips = [
      clip({ id: 'sleep_2', state: 'sleep', variant: 2, loop: true }),
      clip({ id: 'sleep_1', state: 'sleep', variant: 1, loop: true }),
    ]
    expect(selectClipForState('sleep', clips).id).toBe('sleep_1')
  })

  it('honors an injected variant picker', () => {
    const clips = [
      clip({ id: 'sleep_1', state: 'sleep', variant: 1 }),
      clip({ id: 'sleep_2', state: 'sleep', variant: 2 }),
    ]
    const last = selectClipForState('sleep', clips, (vs) => vs[vs.length - 1])
    expect(last.id).toBe('sleep_2')
  })

  it('falls back to the placeholder idle_sit clip for missing states', () => {
    const clips = [clip({ id: 'idle_1', state: 'idle_sit' })]
    for (const state of ['groom', 'turn', 'beg_food']) {
      const picked = selectClipForState(state, clips)
      expect(isPlaceholderClip(picked)).toBe(true)
      expect(picked.state).toBe('idle_sit')
    }
  })

  it('falls back to the placeholder when the store is empty', () => {
    const picked = selectClipForState('idle_sit', [])
    expect(isPlaceholderClip(picked)).toBe(true)
  })

  it('selects walk clips with direction metadata intact', () => {
    const clips = [
      clip({ id: 'walk_right_01', state: 'walk', direction: 'right', anchor: 'stand' }),
      clip({ id: 'walk_left_01', state: 'walk', direction: 'left', anchor: 'stand' }),
    ]
    const picked = selectClipForState('walk', clips)
    expect(picked.anchor).toBe('stand')
    expect(['left', 'right']).toContain(picked.direction)
  })
})
