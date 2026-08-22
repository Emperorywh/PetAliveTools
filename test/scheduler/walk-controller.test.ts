import { describe, expect, it, vi, afterEach } from 'vitest'

import { WalkController } from '../../src/main/scheduler/walk-controller'
import type { Rect, SpriteBounds } from '../../src/shared/spatial'

/** 假窗口：记录 setBounds 调用（DIP 坐标）；getBounds 尺寸恒为固定 400×400 */
function makeFakeWindow(initialX = 500) {
  const state = { x: initialX, y: 600, destroyed: false, moved: 0 }
  const win = {
    isDestroyed: () => state.destroyed,
    getPosition: (): [number, number] => [state.x, state.y],
    getBounds: () => ({ x: state.x, y: state.y, width: 400, height: 400 }),
    setBounds: (b: { x: number; y: number; width: number; height: number }) => {
      state.x = b.x
      state.y = b.y
      state.moved += 1
    },
  }
  return { win: win as never, state }
}

const WORK_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

/** 默认命中盒 [0.1, 0.05, 0.8, 0.9] 在 400×400 窗口内的精灵包围盒 */
const SPRITE: SpriteBounds = { x: 40, y: 20, width: 320, height: 360 }

afterEach(() => {
  vi.useRealTimers()
})

describe('WalkController（行走位移控制器）', () => {
  it('start 后按墙钟恒速平移窗口，stop 后停止', () => {
    vi.useFakeTimers()
    const { win, state } = makeFakeWindow(500)
    let clock = 0
    const controller = new WalkController({
      getWindow: () => win,
      getWorkArea: () => WORK_AREA,
      getSpriteBounds: () => SPRITE,
      now: () => clock,
    })

    controller.start('right')
    clock = 1_000
    vi.advanceTimersByTime(16)
    // 1 秒后右移 DEFAULT_WALK_VELOCITY_PX_PER_SEC（60px）
    expect(state.x).toBeGreaterThanOrEqual(560 - 1)
    expect(state.x).toBeLessThanOrEqual(560 + 1)
    const movedBefore = state.moved

    controller.stop()
    clock = 2_000
    vi.advanceTimersByTime(64)
    expect(state.moved).toBe(movedBefore)

    controller.dispose()
  })

  it('同方向重复 start 幂等，方向变化从当前位置重新起算', () => {
    vi.useFakeTimers()
    const { win, state } = makeFakeWindow(500)
    let clock = 0
    const controller = new WalkController({
      getWindow: () => win,
      getWorkArea: () => WORK_AREA,
      getSpriteBounds: () => SPRITE,
      now: () => clock,
    })

    controller.start('right')
    controller.start('right') // 幂等：不重置起点
    clock = 1_000
    vi.advanceTimersByTime(16)
    expect(state.x).toBeCloseTo(560, 0)

    controller.start('left') // 换向：从 560 重新起算
    clock = 2_000
    vi.advanceTimersByTime(16)
    expect(state.x).toBeCloseTo(500, 0)
    controller.dispose()
  })

  it('右缘钳制：精灵可见范围不移出工作区（窗口可越出屏幕边缘）', () => {
    vi.useFakeTimers()
    const { win, state } = makeFakeWindow(1_400)
    let clock = 0
    const controller = new WalkController({
      getWindow: () => win,
      getWorkArea: () => WORK_AREA,
      getSpriteBounds: () => SPRITE,
      now: () => clock,
    })

    controller.start('right')
    clock = 30_000
    vi.advanceTimersByTime(16)
    // 精灵右缘贴屏幕右缘：1920 - 360 = 1560（窗口右缘可越过 1920）
    expect(state.x).toBe(1_560)
    controller.dispose()
  })

  it('左缘钳制：从贴边放置位置起步不跳变（口径与拖拽放置一致）', () => {
    vi.useFakeTimers()
    // 拖拽放置允许窗口越出左缘（精灵 x=40 → 窗口最小 -40）
    const { win, state } = makeFakeWindow(-40)
    let clock = 0
    const controller = new WalkController({
      getWindow: () => win,
      getWorkArea: () => WORK_AREA,
      getSpriteBounds: () => SPRITE,
      now: () => clock,
    })

    controller.start('left')
    clock = 1_000
    vi.advanceTimersByTime(16)
    // 已在左缘：保持 -40，不会被窗口级钳制拉回 0
    expect(state.x).toBe(-40)
    controller.dispose()
  })

  it('窗口销毁时自动停止位移', () => {
    vi.useFakeTimers()
    const { win, state } = makeFakeWindow(500)
    let clock = 0
    const controller = new WalkController({
      getWindow: () => win,
      getWorkArea: () => WORK_AREA,
      getSpriteBounds: () => SPRITE,
      now: () => clock,
    })

    controller.start('right')
    state.destroyed = true
    clock = 1_000
    vi.advanceTimersByTime(16)
    expect(controller.isActive).toBe(false)
    expect(state.moved).toBe(0)
    controller.dispose()
  })
})
