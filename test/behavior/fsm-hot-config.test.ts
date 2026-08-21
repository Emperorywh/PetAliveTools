import { describe, it, expect } from 'vitest'
import { BehaviorFsm } from '../../src/main/behavior/fsm'
import { applyNeedDelta } from '../../src/main/behavior/needs'
import type { BehaviorConfig } from '../../src/shared/types/behavior-config'
import type { NeedsState } from '../../src/shared/types/needs-state'

function behaviorConfig(weightOverrides: Record<string, Record<string, number>>): BehaviorConfig {
  return {
    weightOverrides,
    rhythm: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 },
    microRandom: { idleJitterSec: 2, signatureProbability: 0.05 },
    shell: {
      displayId: null,
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

describe('applyNeedDelta (菜单动作需求反馈)', () => {
  const base: NeedsState = { hunger: 50, fatigue: 50, happiness: 50, attention: 50 }

  it('喂食 → 饥饿↓愉悦↑', () => {
    const next = applyNeedDelta(base, { hunger: -40, happiness: 10 })
    expect(next.hunger).toBe(10)
    expect(next.happiness).toBe(60)
  })

  it('给玩具 → 愉悦↑注意力↑', () => {
    const next = applyNeedDelta(base, { happiness: 20, attention: 20, fatigue: 5 })
    expect(next.happiness).toBe(70)
    expect(next.attention).toBe(70)
  })

  it('喝水 → 轻度缓解饥饿、愉悦小幅↑（需求模型无口渴维度）', () => {
    const next = applyNeedDelta(base, { hunger: -10, happiness: 5 })
    expect(next.hunger).toBe(40)
    expect(next.happiness).toBe(55)
  })

  it('增量越过边界时钳制到 [0, 100]', () => {
    const high: NeedsState = { hunger: 50, fatigue: 50, happiness: 97, attention: 95 }
    const next = applyNeedDelta(high, { happiness: 10, attention: 10 })
    expect(next.happiness).toBe(100)
    expect(next.attention).toBe(100)
    const low: NeedsState = { hunger: 0, fatigue: 50, happiness: 1, attention: 50 }
    expect(applyNeedDelta(low, { hunger: -30, happiness: -3 }).hunger).toBe(0)
    expect(applyNeedDelta(low, { hunger: -30, happiness: -3 }).happiness).toBe(0)
  })
})
