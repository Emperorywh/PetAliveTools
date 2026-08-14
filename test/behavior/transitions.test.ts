import { describe, it, expect } from 'vitest'
import {
  TRANSITION_WEIGHTS,
  getNeighbors,
  getOutgoingEdges,
  isTransitionAllowed,
  createSeededRandom,
  sampleWeightedEdge,
} from '../../src/main/behavior/transitions'
import { BEHAVIOR_STATES } from '../../src/main/behavior/fsm'
import type { BehaviorState } from '../../src/main/behavior/fsm'
import type { BehaviorConfig } from '../../src/shared/types/behavior-config'

/** §9.2 主干图的期望邻接（附录 A 起止锚定 + walk→stand 站定） */
const EXPECTED_ADJACENCY: Readonly<Record<BehaviorState, readonly BehaviorState[]>> = {
  sleep: ['lie'],
  lie: ['idle_sit', 'sleep'],
  idle_sit: ['lie', 'stand', 'groom'],
  stand: ['idle_sit', 'walk'],
  walk: ['stand', 'turn'],
  turn: ['walk'],
  groom: ['idle_sit'],
}

function configWith(overrides: BehaviorConfig['weightOverrides']): BehaviorConfig {
  return {
    weightOverrides: overrides,
    rhythm: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 },
    microRandom: { idleJitterSec: 2, signatureProbability: 0.05 },
    shell: { displayId: null, volume: 0.25, ambientFrequency: 1.0, autoLaunch: true, hideHotkey: 'CommandOrControl+Shift+H' },
  }
}

describe('TRANSITION_WEIGHTS (§9.2)', () => {
  it('covers all seven basic life states', () => {
    expect(Object.keys(TRANSITION_WEIGHTS).sort()).toEqual([...BEHAVIOR_STATES].sort())
  })

  it('every state has at least one outgoing edge with positive weight', () => {
    for (const state of BEHAVIOR_STATES) {
      const table = TRANSITION_WEIGHTS[state]
      expect(Object.keys(table).length).toBeGreaterThan(0)
      for (const weight of Object.values(table)) {
        expect(weight).toBeGreaterThan(0)
      }
    }
  })

  it('edge table matches the §9.2 FSM backbone exactly', () => {
    for (const state of BEHAVIOR_STATES) {
      expect(getNeighbors(state)).toEqual(EXPECTED_ADJACENCY[state])
    }
  })

  it('is strongly connected: every state is reachable from idle_sit and can return', () => {
    const reachable = new Set<BehaviorState>(['idle_sit'])
    let grew = true
    while (grew) {
      grew = false
      for (const state of [...reachable]) {
        for (const next of getNeighbors(state)) {
          if (!reachable.has(next)) {
            reachable.add(next)
            grew = true
          }
        }
      }
    }
    expect(reachable.size).toBe(BEHAVIOR_STATES.length)
    // 每个状态也都能回到 idle_sit（反向可达）
    for (const state of BEHAVIOR_STATES) {
      const visited = new Set<BehaviorState>()
      const queue: BehaviorState[] = [state]
      let backToAnchor = false
      while (queue.length > 0) {
        const s = queue.shift()!
        if (visited.has(s)) continue
        visited.add(s)
        if (s === 'idle_sit') backToAnchor = true
        queue.push(...getNeighbors(s))
      }
      expect(backToAnchor).toBe(true)
    }
  })
})

describe('getOutgoingEdges / isTransitionAllowed (§9.3 权重调制)', () => {
  it('returns base weights without config', () => {
    const edges = getOutgoingEdges('idle_sit')
    expect(edges).toEqual([
      { target: 'lie', weight: 2 },
      { target: 'stand', weight: 3 },
      { target: 'groom', weight: 1 },
    ])
  })

  it('applies weightOverrides as multipliers', () => {
    const config = configWith({ idle_sit: { walk: 99, lie: 0.5 } })
    // walk 不是 idle_sit 的合法边：倍率不能创造新边
    expect(getOutgoingEdges('idle_sit', config)).toEqual([
      { target: 'lie', weight: 1 },
      { target: 'stand', weight: 3 },
      { target: 'groom', weight: 1 },
    ])
  })

  it('zero multiplier prunes the edge (关闭该转移)', () => {
    const config = configWith({ idle_sit: { groom: 0 } })
    const targets = getOutgoingEdges('idle_sit', config).map((e) => e.target)
    expect(targets).not.toContain('groom')
    expect(isTransitionAllowed('idle_sit', 'groom', config)).toBe(false)
    expect(isTransitionAllowed('idle_sit', 'lie', config)).toBe(true)
  })

  it('rejects transitions outside the edge table regardless of config', () => {
    expect(isTransitionAllowed('idle_sit', 'walk')).toBe(false)
    expect(isTransitionAllowed('idle_sit', 'walk', configWith({ idle_sit: { walk: 5 } }))).toBe(false)
    expect(isTransitionAllowed('sleep', 'idle_sit')).toBe(false)
    expect(isTransitionAllowed('turn', 'stand')).toBe(false)
    expect(isTransitionAllowed('stand', 'idle_sit')).toBe(true)
    expect(isTransitionAllowed('walk', 'turn')).toBe(true)
    expect(isTransitionAllowed('lie', 'sleep')).toBe(true)
    expect(isTransitionAllowed('groom', 'idle_sit')).toBe(true)
  })
})

describe('createSeededRandom', () => {
  it('same seed produces identical sequences', () => {
    const a = createSeededRandom(42)
    const b = createSeededRandom(42)
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b())
    }
  })

  it('yields values in [0, 1)', () => {
    const rng = createSeededRandom(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('sampleWeightedEdge (§9.3 概率转移)', () => {
  const edges = getOutgoingEdges('idle_sit') // 2 / 3 / 1，总权重 6

  it('returns null for empty edges', () => {
    expect(sampleWeightedEdge([], createSeededRandom(1))).toBeNull()
  })

  it('picks deterministically from rng value', () => {
    // r=0.0 → 累计区间 [0,2) 命中 lie；r=0.5×6=3 → [2,5) 命中 stand；r≈1 → [5,6) 命中 groom
    expect(sampleWeightedEdge(edges, () => 0)?.target).toBe('lie')
    expect(sampleWeightedEdge(edges, () => 0.5)?.target).toBe('stand')
    expect(sampleWeightedEdge(edges, () => 0.99)?.target).toBe('groom')
  })

  it('always samples a legal edge over long seeded runs', () => {
    const rng = createSeededRandom(2026)
    const legal = new Set(edges.map((e) => e.target))
    for (let i = 0; i < 500; i++) {
      expect(legal.has(sampleWeightedEdge(edges, rng)!.target)).toBe(true)
    }
  })

  it('sample frequencies approximate weights', () => {
    const rng = createSeededRandom(99)
    const counts: Record<string, number> = { lie: 0, stand: 0, groom: 0 }
    const N = 6000
    for (let i = 0; i < N; i++) {
      counts[sampleWeightedEdge(edges, rng)!.target] += 1
    }
    // 权重 2:3:1 → 期望 1/3, 1/2, 1/6，容差 ±5 个百分点
    expect(Math.abs(counts.lie / N - 2 / 6)).toBeLessThan(0.05)
    expect(Math.abs(counts.stand / N - 3 / 6)).toBeLessThan(0.05)
    expect(Math.abs(counts.groom / N - 1 / 6)).toBeLessThan(0.05)
  })
})
