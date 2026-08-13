import { describe, it, expect } from 'vitest'
import {
  BEHAVIOR_STATES,
  STATE_ANCHOR_FOR,
  FSM_RECOVERY_STATE,
  BehaviorFsm,
} from '../../src/main/behavior/fsm'
import type { BehaviorState } from '../../src/main/behavior/fsm'
import { getNeighbors, isTransitionAllowed, createSeededRandom } from '../../src/main/behavior/transitions'
import type { BehaviorConfig } from '../../src/shared/types/behavior-config'

function configWith(overrides: BehaviorConfig['weightOverrides']): BehaviorConfig {
  return {
    weightOverrides: overrides,
    rhythm: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 },
    microRandom: { rateJitter: 0.05, idleJitterSec: 2, signatureProbability: 0.05 },
  }
}

describe('BEHAVIOR_STATES (§9.1)', () => {
  it('contains exactly the seven basic life states', () => {
    expect([...BEHAVIOR_STATES]).toEqual([
      'idle_sit',
      'stand',
      'walk',
      'lie',
      'sleep',
      'groom',
      'turn',
    ])
  })

  it('anchors match §4.2 start/end template', () => {
    expect(STATE_ANCHOR_FOR.idle_sit).toBe('sit')
    expect(STATE_ANCHOR_FOR.stand).toBe('stand')
    expect(STATE_ANCHOR_FOR.walk).toBe('stand')
    expect(STATE_ANCHOR_FOR.turn).toBe('stand')
    expect(STATE_ANCHOR_FOR.lie).toBe('sit')
    expect(STATE_ANCHOR_FOR.sleep).toBe('sit')
    expect(STATE_ANCHOR_FOR.groom).toBe('sit')
  })
})

describe('BehaviorFsm', () => {
  it('starts at the primary anchor idle_sit with sit pose', () => {
    const fsm = new BehaviorFsm()
    expect(fsm.state).toBe('idle_sit')
    expect(fsm.anchor).toBe('sit')
    expect(fsm.snapshot.transitionCount).toBe(0)
  })

  it('transitionTo applies legal edges and tracks anchor + count', () => {
    const fsm = new BehaviorFsm()
    expect(fsm.transitionTo('stand')).toEqual({ ok: true, state: 'stand' })
    expect(fsm.anchor).toBe('stand')
    expect(fsm.transitionTo('walk')).toEqual({ ok: true, state: 'walk' })
    expect(fsm.anchor).toBe('stand')
    expect(fsm.transitionTo('turn')).toEqual({ ok: true, state: 'turn' })
    expect(fsm.snapshot).toEqual({ state: 'turn', anchor: 'stand', transitionCount: 3 })
  })

  it('rejects illegal transitions and keeps state', () => {
    const fsm = new BehaviorFsm()
    const result = fsm.transitionTo('walk') // idle_sit 无 → walk 边
    expect(result.ok).toBe(false)
    expect(result.state).toBe('idle_sit')
    expect(result.reason).toContain('idle_sit -> walk')
    expect(fsm.state).toBe('idle_sit')
    expect(fsm.snapshot.transitionCount).toBe(0)
  })

  it('rejects transitions closed by zero override multiplier', () => {
    const fsm = new BehaviorFsm({ config: configWith({ idle_sit: { groom: 0 } }) })
    expect(fsm.transitionTo('groom').ok).toBe(false)
    expect(fsm.transitionTo('lie').ok).toBe(true)
  })

  it('step() always moves along a legal weighted edge', () => {
    const fsm = new BehaviorFsm({ rng: () => 0 })
    // rng=0 → 采样命中第一条出边：idle_sit → lie
    expect(fsm.step()).toBe('lie')
    // lie 出边顺序 idle_sit(3), sleep(2)，rng=0 → idle_sit
    expect(fsm.step()).toBe('idle_sit')
  })

  it('step() keeps state when all outgoing edges are pruned', () => {
    // walk 仅两条出边 stand/turn，全部关闭
    const fsm = new BehaviorFsm({
      config: configWith({ walk: { stand: 0, turn: 0 } }),
    })
    fsm.transitionTo('stand')
    fsm.transitionTo('walk')
    expect(fsm.step()).toBe('walk')
  })

  it('random walk over 1000 steps never leaves the edge table', () => {
    const fsm = new BehaviorFsm() // Math.random
    let prev = fsm.state
    for (let i = 0; i < 1000; i++) {
      const next = fsm.step()
      expect(isTransitionAllowed(prev, next)).toBe(true)
      prev = next
    }
    expect((BEHAVIOR_STATES as readonly string[]).includes(fsm.state)).toBe(true)
  })

  it('random walk visits multiple distinct states', () => {
    const fsm = new BehaviorFsm()
    const seen = new Set<BehaviorState>()
    for (let i = 0; i < 500; i++) {
      seen.add(fsm.step() as BehaviorState)
    }
    // 长随机游走应访问大多数状态（groom 权重 1/6 可能偶发未达，放宽到 ≥5）
    expect(seen.size).toBeGreaterThanOrEqual(5)
  })

  it('same seed reproduces the same state sequence (确定性状态机)', () => {
    const run = () => {
      const fsm = new BehaviorFsm({ rng: createSeededRandom(1234) })
      const path: BehaviorState[] = []
      for (let i = 0; i < 50; i++) path.push(fsm.step())
      return path
    }
    expect(run()).toEqual(run())
  })

  describe('crash recovery (§13)', () => {
    it('resetToAnchor returns to idle_sit from any state', () => {
      for (const state of BEHAVIOR_STATES) {
        const fsm = new BehaviorFsm()
        // 沿合法路径到达目标状态
        walkTo(fsm, state)
        expect(fsm.state).toBe(state)
        const snap = fsm.resetToAnchor()
        expect(snap).toEqual({ state: FSM_RECOVERY_STATE, anchor: 'sit', transitionCount: 0 })
        expect(fsm.state).toBe('idle_sit')
        expect(fsm.anchor).toBe('sit')
      }
    })

    it('restart constructs a fresh FSM at the anchor state, not the pre-crash state', () => {
      const crashed = new BehaviorFsm({ rng: createSeededRandom(7) })
      for (let i = 0; i < 20; i++) crashed.step()
      // 模拟崩溃后重启：新实例
      const restarted = new BehaviorFsm({ rng: createSeededRandom(7) })
      expect(restarted.state).toBe(FSM_RECOVERY_STATE)
      expect(restarted.anchor).toBe('sit')
      expect(restarted.snapshot.transitionCount).toBe(0)
      // 重新调度可用：step 正常出边
      expect(getNeighbors(restarted.state).length).toBeGreaterThan(0)
      restarted.step()
      expect(restarted.snapshot.transitionCount).toBe(1)
    })
  })
})

/** 到达目标状态的合法路径 BFS */
function walkTo(fsm: BehaviorFsm, target: BehaviorState): void {
  const start = fsm.state
  const prev = new Map<BehaviorState, BehaviorState>()
  const queue: BehaviorState[] = [start]
  while (queue.length > 0) {
    const s = queue.shift()!
    if (s === target) break
    for (const next of getNeighbors(s)) {
      if (!prev.has(next)) {
        prev.set(next, s)
        queue.push(next)
      }
    }
  }
  const path: BehaviorState[] = []
  let cur = target
  while (cur !== start) {
    path.unshift(cur)
    cur = prev.get(cur)!
  }
  for (const s of path) {
    const r = fsm.transitionTo(s)
    expect(r.ok).toBe(true)
  }
}
