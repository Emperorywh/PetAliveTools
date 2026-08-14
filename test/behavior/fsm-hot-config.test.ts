import { describe, it, expect } from 'vitest'
import { BehaviorFsm } from '../../src/main/behavior/fsm'
import { applyNeedDelta, INTERACTION_NEED_DELTAS } from '../../src/main/behavior/needs'
import type { BehaviorConfig } from '../../src/shared/types/behavior-config'
import type { NeedsState } from '../../src/shared/types/needs-state'

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

describe('BehaviorFsm.updateConfig (IR-007 权重热更新)', () => {
  it('热更新配置后 step 按新权重转移（无需重建 FSM）', () => {
    // 初始：idle_sit → stand 唯一可行（其余出边倍率 0）
    const fsm = new BehaviorFsm({
      config: behaviorConfig({ idle_sit: { lie: 0, groom: 0 } }),
      rng: () => 0.5,
    })
    expect(fsm.step()).toBe('stand')

    // 热更新：stand → idle_sit 唯一可行
    fsm.updateConfig(behaviorConfig({ stand: { walk: 0 } }))
    expect(fsm.step()).toBe('idle_sit')

    // 热更新：idle_sit → lie 唯一可行
    fsm.updateConfig(behaviorConfig({ idle_sit: { stand: 0, groom: 0 } }))
    expect(fsm.step()).toBe('lie')
  })

  it('热更新不打断当前状态与锚定（无重建语义）', () => {
    const fsm = new BehaviorFsm({ rng: () => 0.5 })
    fsm.transitionTo('stand')
    const before = fsm.snapshot
    fsm.updateConfig(behaviorConfig({}))
    const after = fsm.snapshot
    expect(after.state).toBe(before.state)
    expect(after.anchor).toBe(before.anchor)
    expect(after.transitionCount).toBe(before.transitionCount)
  })
})

describe('INTERACTION_NEED_DELTAS (IR-008 交互需求反馈)', () => {
  const base: NeedsState = { hunger: 50, fatigue: 50, happiness: 50, attention: 50 }

  it('抚摸 → 愉悦↑ (§10)', () => {
    const next = applyNeedDelta(base, INTERACTION_NEED_DELTAS['petted']!)
    expect(next.happiness).toBe(58)
  })

  it('点击 → 注意力↑ (§10)', () => {
    const next = applyNeedDelta(base, INTERACTION_NEED_DELTAS['clicked']!)
    expect(next.attention).toBe(60)
  })

  it('拖拽 → 愉悦小幅↓ (§10)', () => {
    const next = applyNeedDelta(base, INTERACTION_NEED_DELTAS['dragged']!)
    expect(next.happiness).toBe(47)
  })

  it('增量越过边界时钳制到 [0, 100]', () => {
    const high: NeedsState = { hunger: 50, fatigue: 50, happiness: 97, attention: 95 }
    const next = applyNeedDelta(high, INTERACTION_NEED_DELTAS['petted']!)
    expect(next.happiness).toBe(100)
    const low: NeedsState = { hunger: 50, fatigue: 50, happiness: 1, attention: 50 }
    expect(applyNeedDelta(low, INTERACTION_NEED_DELTAS['dragged']!).happiness).toBe(0)
  })
})
