import { describe, it, expect } from 'vitest'
import {
  NEED_KEYS,
  DEFAULT_NEED_RATES,
  clampNeed,
  clampNeeds,
  advanceNeeds,
  applyNeedDelta,
  getHighNeeds,
  needWeightModifiers,
  emotionCandidateGroups,
  EMOTION_HIGH_THRESHOLD,
  EMOTION_LOW_THRESHOLD,
  EMOTION_HAPPY_THRESHOLD,
  type NeedRates,
} from '../../src/main/behavior/needs'
import type { NeedsState } from '../../src/shared/types/needs-state'

const midState: NeedsState = {
  hunger: 50,
  fatigue: 30,
  happiness: 70,
  attention: 50,
}

describe('NEED_KEYS (§9.4)', () => {
  it('contains exactly the four need dimensions', () => {
    expect([...NEED_KEYS]).toEqual(['hunger', 'fatigue', 'happiness', 'attention'])
  })
})

describe('clampNeed', () => {
  it('clamps to [0, 100]', () => {
    expect(clampNeed(-5)).toBe(0)
    expect(clampNeed(0)).toBe(0)
    expect(clampNeed(50)).toBe(50)
    expect(clampNeed(100)).toBe(100)
    expect(clampNeed(150)).toBe(100)
  })

  it('preserves valid values exactly', () => {
    expect(clampNeed(42.7)).toBe(42.7)
  })
})

describe('clampNeeds', () => {
  it('clamps all four dimensions independently', () => {
    const result = clampNeeds({
      hunger: -10,
      fatigue: 200,
      happiness: 50,
      attention: 0,
    })
    expect(result).toEqual({
      hunger: 0,
      fatigue: 100,
      happiness: 50,
      attention: 0,
    })
  })
})

describe('advanceNeeds (§9.4 real-time progression)', () => {
  it('advances hunger upward over time', () => {
    const result = advanceNeeds(midState, 1000, DEFAULT_NEED_RATES)
    // hunger should increase
    expect(result.hunger).toBeGreaterThan(midState.hunger)
    expect(result.fatigue).toBeGreaterThan(midState.fatigue)
    // happiness and attention should decrease
    expect(result.happiness).toBeLessThan(midState.happiness)
    expect(result.attention).toBeLessThan(midState.attention)
  })

  it('respects upper bound at 100 for rising needs', () => {
    const highState: NeedsState = { hunger: 99.9, fatigue: 99.9, happiness: 50, attention: 50 }
    const result = advanceNeeds(highState, 100000, DEFAULT_NEED_RATES)
    expect(result.hunger).toBeLessThanOrEqual(100)
    expect(result.fatigue).toBeLessThanOrEqual(100)
  })

  it('respects lower bound at 0 for declining needs', () => {
    const lowState: NeedsState = { hunger: 50, fatigue: 50, happiness: 0.1, attention: 0.1 }
    const result = advanceNeeds(lowState, 100000, DEFAULT_NEED_RATES)
    expect(result.happiness).toBeGreaterThanOrEqual(0)
    expect(result.attention).toBeGreaterThanOrEqual(0)
  })

  it('with zero elapsed time returns the same state', () => {
    const result = advanceNeeds(midState, 0, DEFAULT_NEED_RATES)
    expect(result).toEqual(midState)
  })

  it('supports custom rates', () => {
    const customRates: NeedRates = {
      hunger: 0.01,
      fatigue: 0,
      happiness: 0,
      attention: 0,
    }
    const result = advanceNeeds(midState, 100, customRates)
    expect(result.hunger).toBeCloseTo(51, 0)
    expect(result.fatigue).toBe(midState.fatigue)
    expect(result.happiness).toBe(midState.happiness)
    expect(result.attention).toBe(midState.attention)
  })

  it('is deterministic for same inputs', () => {
    const r1 = advanceNeeds(midState, 600, DEFAULT_NEED_RATES)
    const r2 = advanceNeeds(midState, 600, DEFAULT_NEED_RATES)
    expect(r1).toEqual(r2)
  })
})

describe('applyNeedDelta (§9.4 interactions)', () => {
  it('applies positive deltas', () => {
    const result = applyNeedDelta(midState, { happiness: 20 })
    expect(result.happiness).toBe(90)
    expect(result.hunger).toBe(midState.hunger)
  })

  it('applies negative deltas', () => {
    const result = applyNeedDelta(midState, { hunger: -30 })
    expect(result.hunger).toBe(20)
  })

  it('clamps after delta', () => {
    const result = applyNeedDelta(midState, { happiness: 100 })
    expect(result.happiness).toBe(100)
  })

  it('applies multiple deltas at once', () => {
    const result = applyNeedDelta(midState, {
      hunger: -20,
      happiness: 10,
      attention: 20,
      fatigue: 5,
    })
    expect(result).toEqual({
      hunger: 30,
      fatigue: 35,
      happiness: 80,
      attention: 70,
    })
  })

  it('handles empty delta as no-op', () => {
    const result = applyNeedDelta(midState, {})
    expect(result).toEqual(midState)
  })
})

describe('getHighNeeds (§9.4 high-value triggers)', () => {
  it('detects high hunger and fatigue', () => {
    const state: NeedsState = { hunger: 80, fatigue: 75, happiness: 70, attention: 50 }
    const flags = getHighNeeds(state)
    expect(flags.hungry).toBe(true)
    expect(flags.tired).toBe(true)
    expect(flags.bored).toBe(false)
    expect(flags.wantsAttention).toBe(false)
  })

  it('detects low happiness and attention', () => {
    const state: NeedsState = { hunger: 30, fatigue: 20, happiness: 20, attention: 15 }
    const flags = getHighNeeds(state)
    expect(flags.hungry).toBe(false)
    expect(flags.tired).toBe(false)
    expect(flags.bored).toBe(true)
    expect(flags.wantsAttention).toBe(true)
  })

  it('respects custom thresholds', () => {
    const state: NeedsState = { hunger: 60, fatigue: 20, happiness: 60, attention: 40 }
    const flags = getHighNeeds(state, 60, 50)
    expect(flags.hungry).toBe(true)
    expect(flags.bored).toBe(false) // 60 > 50
    expect(flags.wantsAttention).toBe(true) // 40 <= 50
  })
})

describe('needWeightModifiers (§9.3 need-driven transition)', () => {
  it('returns empty when all needs are neutral', () => {
    const state: NeedsState = { hunger: 30, fatigue: 20, happiness: 70, attention: 70 }
    const mods = needWeightModifiers(state)
    expect(Object.keys(mods)).toHaveLength(0)
  })

  it('情绪动作（beg_food/bored/want_play）不在边表内，不再产生无效权重倍率', () => {
    // 回归：这些状态不在 FSM 边表中，倍率无法造边，只会被静默忽略；
    // 情绪表达改由调度器的 emotionCandidateGroups 插入路径触发。
    const state: NeedsState = { hunger: 90, fatigue: 20, happiness: 10, attention: 10 }
    const mods = needWeightModifiers(state)
    expect(mods['idle_sit']).toBeUndefined()
  })

  it('boosts sleep when fatigue is high', () => {
    const state: NeedsState = { hunger: 20, fatigue: 90, happiness: 70, attention: 70 }
    const mods = needWeightModifiers(state)
    expect(mods['idle_sit']['sleep']).toBeGreaterThan(1)
    expect(mods['lie']['sleep']).toBeGreaterThan(1)
  })

  it('increases sleep modifier with fatigue severity', () => {
    const low = needWeightModifiers({ hunger: 20, fatigue: 60, happiness: 70, attention: 70 })
    const high = needWeightModifiers({ hunger: 20, fatigue: 95, happiness: 70, attention: 70 })
    expect(high['idle_sit']['sleep']).toBeGreaterThan(low['idle_sit']['sleep'])
  })
})

describe('emotionCandidateGroups (§9.4 情绪表达插入)', () => {
  it('中性需求不产生情绪候选', () => {
    const state: NeedsState = { hunger: 30, fatigue: 20, happiness: 70, attention: 70 }
    expect(emotionCandidateGroups(state)).toEqual([])
  })

  it('饥饿高位 → 讨食/喝水候选组', () => {
    const state: NeedsState = { hunger: EMOTION_HIGH_THRESHOLD, fatigue: 20, happiness: 70, attention: 70 }
    expect(emotionCandidateGroups(state)).toEqual([['beg_food', 'drink']])
  })

  it('愉悦极高 → 开心候选', () => {
    const state: NeedsState = { hunger: 20, fatigue: 20, happiness: EMOTION_HAPPY_THRESHOLD, attention: 70 }
    expect(emotionCandidateGroups(state)).toEqual([['happy']])
  })

  it('愉悦低位 → 无聊；注意力低位 → 求玩（按优先级排序）', () => {
    const state: NeedsState = { hunger: 20, fatigue: 20, happiness: EMOTION_LOW_THRESHOLD, attention: EMOTION_LOW_THRESHOLD }
    expect(emotionCandidateGroups(state)).toEqual([['bored'], ['want_play']])
  })

  it('支持自定义阈值', () => {
    const state: NeedsState = { hunger: 50, fatigue: 20, happiness: 70, attention: 70 }
    expect(emotionCandidateGroups(state, { high: 50 })).toEqual([['beg_food', 'drink']])
  })
})
