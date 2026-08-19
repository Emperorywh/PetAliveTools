import { describe, expect, it } from 'vitest'

import {
  createWalkMotion,
  walkXAt,
  hasReachedWalkBound,
  DEFAULT_WALK_VELOCITY_PX_PER_SEC,
} from '../../src/shared/spatial/walk-motion'

/**
 * 行走位移是纯墙钟计算：不读视频时间、不逐帧跟踪，
 * 只按恒定速度与可见范围钳制推导窗口 x。
 */
describe('行走位移 (§7.3 行走移动)', () => {
  it('向右行走按恒定速度推进', () => {
    const motion = createWalkMotion({
      startMs: 0,
      originX: 500,
      direction: 'right',
      minX: 0,
      maxX: 2000,
    })
    expect(walkXAt(motion, 0)).toBe(500)
    expect(walkXAt(motion, 1_000)).toBeCloseTo(500 + DEFAULT_WALK_VELOCITY_PX_PER_SEC, 5)
    expect(walkXAt(motion, 2_500)).toBeCloseTo(500 + 2.5 * DEFAULT_WALK_VELOCITY_PX_PER_SEC, 5)
  })

  it('向左行走向负方向推进', () => {
    const motion = createWalkMotion({ startMs: 0, originX: 500, direction: 'left', minX: 0, maxX: 2000 })
    expect(walkXAt(motion, 1_000)).toBeCloseTo(500 - DEFAULT_WALK_VELOCITY_PX_PER_SEC, 5)
  })

  it('钳制到可见范围：抵达边缘后停在边缘', () => {
    const motion = createWalkMotion({ startMs: 0, originX: 1980, direction: 'right', minX: 0, maxX: 2000 })
    expect(walkXAt(motion, 10_000)).toBe(2000)
    expect(hasReachedWalkBound(motion, 10_000)).toBe(true)
    expect(hasReachedWalkBound(motion, 0)).toBe(false)
  })

  it('自定义速度生效且非法速度抛错', () => {
    const motion = createWalkMotion({
      startMs: 0,
      originX: 100,
      direction: 'right',
      velocityPxPerSec: 200,
      minX: 0,
      maxX: 1000,
    })
    expect(walkXAt(motion, 1_000)).toBeCloseTo(300, 5)
    expect(() =>
      createWalkMotion({ startMs: 0, originX: 0, direction: 'right', velocityPxPerSec: 0, minX: 0, maxX: 10 }),
    ).toThrow()
    expect(() =>
      createWalkMotion({ startMs: 0, originX: 0, direction: 'right', minX: 100, maxX: 50 }),
    ).toThrow()
  })

  it('起点之前的时间不产生负位移', () => {
    const motion = createWalkMotion({ startMs: 1_000, originX: 500, direction: 'right', minX: 0, maxX: 2000 })
    expect(walkXAt(motion, 500)).toBe(500)
  })
})
