import { describe, expect, it, vi, afterEach } from 'vitest'

import { WalkController } from '../../src/main/scheduler/walk-controller'
import type { Rect } from '../../src/shared/spatial'

/** 假窗口：记录 setPosition 调用（DIP 坐标） */
function makeFakeWindow(initialX = 500) {
  const state = { x: initialX, y: 600, destroyed: false, moved: 0 }
  const win = {
    isDestroyed: () => state.destroyed,
    getPosition: (): [number, number] => [state.x, state.y],
    setPosition: (x: number, y: number) => {
      state.x = x
      state.y = y
      state.moved += 1
    },
  }
  return { win: win as never, state }
}

const WORK_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

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
      windowWidth: 400,
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
      windowWidth: 400,
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

  it('右缘钳制：窗口不会移出工作区', () => {
    vi.useFakeTimers()
    const { win, state } = makeFakeWindow(1_400)
    let clock = 0
    const controller = new WalkController({
      getWindow: () => win,
      getWorkArea: () => WORK_AREA,
      windowWidth: 400,
      now: () => clock,
    })

    controller.start('right')
    clock = 30_000
    vi.advanceTimersByTime(16)
    // 1920 - 400 = 1520 为右缘
    expect(state.x).toBe(1_520)
    controller.dispose()
  })

  it('窗口销毁时自动停止位移', () => {
    vi.useFakeTimers()
    const { win, state } = makeFakeWindow(500)
    let clock = 0
    const controller = new WalkController({
      getWindow: () => win,
      getWorkArea: () => WORK_AREA,
      windowWidth: 400,
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
