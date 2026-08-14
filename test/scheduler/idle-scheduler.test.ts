import { describe, it, expect } from 'vitest'
import {
  createVariantTracker,
  recordVariantUse,
  variantUsageCount,
  isVariantExhausted,
  mostUsedVariant,
  scheduleIdle,
  isIdleState,
  DEFAULT_IDLE_CONFIG,
  type IdleScheduleConfig,
} from '../../src/main/scheduler/idle-scheduler'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

// —— 测试辅助 —— //

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

function idleSitVariants(count: number): ClipMeta[] {
  const clips: ClipMeta[] = []
  for (let i = 1; i <= count; i++) {
    clips.push(clip({ id: `idle_sit_${String(i).padStart(2, '0')}`, state: 'idle_sit', variant: i, loop: true }))
  }
  return clips
}

const TEST_CONFIG: IdleScheduleConfig = {
  idleIntervalMs: 8_000,
  activeIntervalMs: 4_000,
  exhaustionMultiplier: 1.5,
  exhaustionThreshold: 3,
}

// —— isIdleState —— //

describe('isIdleState (§9.5)', () => {
  it('identifies idle states', () => {
    expect(isIdleState('idle_sit')).toBe(true)
    expect(isIdleState('lie')).toBe(true)
    expect(isIdleState('sleep')).toBe(true)
  })

  it('rejects active states', () => {
    expect(isIdleState('stand')).toBe(false)
    expect(isIdleState('walk')).toBe(false)
    expect(isIdleState('groom')).toBe(false)
    expect(isIdleState('turn')).toBe(false)
  })
})

// —— VariantTracker —— //

describe('VariantTracker', () => {
  it('starts empty', () => {
    const tracker = createVariantTracker()
    expect(variantUsageCount(tracker, 'idle_sit', 1)).toBe(0)
  })

  it('records usage and returns updated tracker', () => {
    let tracker = createVariantTracker()
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    expect(variantUsageCount(tracker, 'idle_sit', 1)).toBe(1)
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    expect(variantUsageCount(tracker, 'idle_sit', 1)).toBe(2)
  })

  it('tracks multiple variants independently', () => {
    let tracker = createVariantTracker()
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    tracker = recordVariantUse(tracker, 'idle_sit', 2)
    expect(variantUsageCount(tracker, 'idle_sit', 1)).toBe(2)
    expect(variantUsageCount(tracker, 'idle_sit', 2)).toBe(1)
  })

  it('is immutable (does not mutate original)', () => {
    const tracker = createVariantTracker()
    const updated = recordVariantUse(tracker, 'idle_sit', 1)
    expect(variantUsageCount(tracker, 'idle_sit', 1)).toBe(0)
    expect(variantUsageCount(updated, 'idle_sit', 1)).toBe(1)
  })
})

// —— isVariantExhausted —— //

describe('isVariantExhausted (§9.5)', () => {
  const clips = idleSitVariants(3)

  it('returns false when not all variants used enough', () => {
    let tracker = createVariantTracker()
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    // variant 1 exhausted but variants 2,3 not
    expect(isVariantExhausted(tracker, 'idle_sit', clips, 3)).toBe(false)
  })

  it('returns true when all variants used threshold times', () => {
    let tracker = createVariantTracker()
    for (let v = 1; v <= 3; v++) {
      for (let i = 0; i < 3; i++) {
        tracker = recordVariantUse(tracker, 'idle_sit', v)
      }
    }
    expect(isVariantExhausted(tracker, 'idle_sit', clips, 3)).toBe(true)
  })

  it('returns false for single-variant states', () => {
    const singleClips = idleSitVariants(1)
    let tracker = createVariantTracker()
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    expect(isVariantExhausted(tracker, 'idle_sit', singleClips, 3)).toBe(false)
  })
})

// —— mostUsedVariant —— //

describe('mostUsedVariant (§9.5)', () => {
  const clips = idleSitVariants(3)

  it('returns most used variant', () => {
    let tracker = createVariantTracker()
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    tracker = recordVariantUse(tracker, 'idle_sit', 2)
    tracker = recordVariantUse(tracker, 'idle_sit', 2)
    tracker = recordVariantUse(tracker, 'idle_sit', 2)
    expect(mostUsedVariant(tracker, 'idle_sit', clips)).toBe(2)
  })

  it('returns lowest variant number on tie', () => {
    let tracker = createVariantTracker()
    tracker = recordVariantUse(tracker, 'idle_sit', 1)
    tracker = recordVariantUse(tracker, 'idle_sit', 2)
    expect(mostUsedVariant(tracker, 'idle_sit', clips)).toBe(1)
  })

  it('returns 1 when no clips available', () => {
    const tracker = createVariantTracker()
    expect(mostUsedVariant(tracker, 'idle_sit', [])).toBe(1)
  })
})

// —— scheduleIdle —— //

describe('scheduleIdle (§9.5)', () => {
  it('uses long interval for idle states', () => {
    const clips = idleSitVariants(2)
    const tracker = createVariantTracker()
    const result = scheduleIdle('idle_sit', clips, tracker, TEST_CONFIG)
    expect(result.intervalMs).toBe(8_000)
  })

  it('uses short interval for active states', () => {
    const clips = [clip({ id: 'stand_01', state: 'stand', anchor: 'stand', variant: 1 })]
    const tracker = createVariantTracker()
    const result = scheduleIdle('stand', clips, tracker, TEST_CONFIG)
    expect(result.intervalMs).toBe(4_000)
  })

  it('returns placeholder for missing state (§5.5)', () => {
    const tracker = createVariantTracker()
    const result = scheduleIdle('nonexistent', [], tracker, TEST_CONFIG)
    expect(result.isPlaceholder).toBe(true)
    expect(result.clip.state).toBe('idle_sit')
    expect(result.variantExhausted).toBe(false)
  })

  it('lengthens interval when variant exhausted (§9.5)', () => {
    const clips = idleSitVariants(2)
    let tracker = createVariantTracker()
    // Exhaust both variants
    for (let v = 1; v <= 2; v++) {
      for (let i = 0; i < 3; i++) {
        tracker = recordVariantUse(tracker, 'idle_sit', v)
      }
    }
    const result = scheduleIdle('idle_sit', clips, tracker, TEST_CONFIG)
    expect(result.variantExhausted).toBe(true)
    // 8000 * 1.5 = 12000
    expect(result.intervalMs).toBe(12_000)
  })

  it('returns most common variant when exhausted', () => {
    const clips = idleSitVariants(3)
    let tracker = createVariantTracker()
    // Exhaust all variants, with variant 2 used most
    for (let i = 0; i < 3; i++) tracker = recordVariantUse(tracker, 'idle_sit', 1)
    for (let i = 0; i < 5; i++) tracker = recordVariantUse(tracker, 'idle_sit', 2)
    for (let i = 0; i < 3; i++) tracker = recordVariantUse(tracker, 'idle_sit', 3)
    const result = scheduleIdle('idle_sit', clips, tracker, TEST_CONFIG)
    expect(result.variantExhausted).toBe(true)
    expect(result.clip.variant).toBe(2)
  })

  it('uses variant picker for non-exhausted states', () => {
    const clips = idleSitVariants(3)
    const tracker = createVariantTracker()
    const result = scheduleIdle('idle_sit', clips, tracker, TEST_CONFIG, (vs) => vs[2])
    expect(result.clip.variant).toBe(3)
    expect(result.variantExhausted).toBe(false)
  })

  it('uses default config when not provided', () => {
    const clips = idleSitVariants(2)
    const tracker = createVariantTracker()
    const result = scheduleIdle('idle_sit', clips, tracker)
    expect(result.intervalMs).toBe(DEFAULT_IDLE_CONFIG.idleIntervalMs)
  })
})
