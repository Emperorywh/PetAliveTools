import { describe, it, expect } from 'vitest'
import {
  resolveLoopSegment,
  decideReplayAction,
  fadeInPlan,
  fadeOutPlan,
  easingPlan,
  clampPlaybackRate,
} from '../../src/renderer/sprite/clip-playback'

describe('resolveLoopSegment (§5.3, IR-002)', () => {
  it('loop=true 且入/出点有效时返回循环段', () => {
    expect(resolveLoopSegment(true, 1.5, 4.0)).toEqual({ inSec: 1.5, outSec: 4.0 })
  })

  it('loop=false 时无循环段', () => {
    expect(resolveLoopSegment(false, 1.5, 4.0)).toBeNull()
  })

  it('入/出点缺失时退回整文件循环（null）', () => {
    expect(resolveLoopSegment(true, null, 4.0)).toBeNull()
    expect(resolveLoopSegment(true, 1.5, null)).toBeNull()
    expect(resolveLoopSegment(true, null, null)).toBeNull()
  })

  it('入点不早于出点时视为无效（null）', () => {
    expect(resolveLoopSegment(true, 4.0, 1.5)).toBeNull()
    expect(resolveLoopSegment(true, 2.0, 2.0)).toBeNull()
  })

  it('负入点视为无效', () => {
    expect(resolveLoopSegment(true, -0.5, 2.0)).toBeNull()
  })

  it('入点为 0 是有效循环段', () => {
    expect(resolveLoopSegment(true, 0, 3.0)).toEqual({ inSec: 0, outSec: 3.0 })
  })
})

describe('decideReplayAction (IR-005)', () => {
  it('src 变化 → load（加载新片段）', () => {
    expect(decideReplayAction(false, false, true, true)).toBe('load')
    expect(decideReplayAction(false, true, false, false)).toBe('load')
  })

  it('同 src 且循环 → none（循环自行维持）', () => {
    expect(decideReplayAction(true, true, false, false)).toBe('none')
    // 循环片段 paused 边界：loop 语义下也不重卷
    expect(decideReplayAction(true, true, true, false)).toBe('none')
  })

  it('同 src 非循环且已播毕/暂停 → restart（修复冻末帧）', () => {
    expect(decideReplayAction(true, false, true, true)).toBe('restart')
    expect(decideReplayAction(true, false, true, false)).toBe('restart')
    expect(decideReplayAction(true, false, false, true)).toBe('restart')
  })

  it('同 src 非循环但仍在播放 → none（fade_in→play 序列不重卷，IR-003）', () => {
    expect(decideReplayAction(true, false, false, false)).toBe('none')
  })
})

describe('淡化/缓动时序 (§8.3/§8.4, IR-003)', () => {
  it('fadeInPlan：opacity 0 → 1', () => {
    expect(fadeInPlan(200)).toEqual({ fromOpacity: 0, toOpacity: 1, durationMs: 200 })
  })

  it('fadeOutPlan：opacity 1 → 0', () => {
    expect(fadeOutPlan(150)).toEqual({ fromOpacity: 1, toOpacity: 0, durationMs: 150 })
  })

  it('负时长钳制为 0', () => {
    expect(fadeInPlan(-5).durationMs).toBe(0)
    expect(fadeOutPlan(-5).durationMs).toBe(0)
  })

  it('easingPlan：谷底 0.7，半程各 durationMs/2 (§8.3)', () => {
    expect(easingPlan(90)).toEqual({ dipOpacity: 0.7, halfMs: 45 })
    expect(easingPlan(120)).toEqual({ dipOpacity: 0.7, halfMs: 60 })
  })
})

describe('clampPlaybackRate (§9.5)', () => {
  it('正常速率保持不变', () => {
    expect(clampPlaybackRate(1.0)).toBe(1.0)
    expect(clampPlaybackRate(1.05)).toBe(1.05)
    expect(clampPlaybackRate(0.95)).toBe(0.95)
  })

  it('异常速率钳制到 [0.5, 2]', () => {
    expect(clampPlaybackRate(10)).toBe(2)
    expect(clampPlaybackRate(0.1)).toBe(0.5)
    expect(clampPlaybackRate(0)).toBe(1)
    expect(clampPlaybackRate(-1)).toBe(1)
    expect(clampPlaybackRate(Number.NaN)).toBe(1)
  })
})
