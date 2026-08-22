import { describe, it, expect, vi } from 'vitest'

// node 环境无真实 electron 运行时；window.ts 顶层不调用任何 electron API
vi.mock('electron', () => ({}))

import { setPetWindowPosition } from '../../src/main/window'

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** 假窗口：getBounds 返回当前状态，setBounds 记录调用并更新状态 */
function makeFakeWindow(initial: Bounds) {
  const state = { bounds: { ...initial } }
  const calls: Bounds[] = []
  const win = {
    getBounds: (): Bounds => ({ ...state.bounds }),
    setBounds: (b: Bounds) => {
      state.bounds = { ...b }
      calls.push({ ...b })
    },
  }
  return { win: win as never, state, calls }
}

describe('setPetWindowPosition（分数缩放下防窗口撑大）', () => {
  it('位置与尺寸均已正确时跳过 native 调用（长按不动零窗口消息 churn）', () => {
    const { win, calls } = makeFakeWindow({ x: 500, y: 600, width: 400, height: 400 })

    setPetWindowPosition(win, 500, 600)
    setPetWindowPosition(win, 500, 600)

    expect(calls.length).toBe(0)
  })

  it('位置变化时经 setBounds 移动并显式钉住 400×400', () => {
    const { win, state, calls } = makeFakeWindow({ x: 500, y: 600, width: 400, height: 400 })

    setPetWindowPosition(win, 640, 600)

    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual({ x: 640, y: 600, width: 400, height: 400 })
    expect(state.bounds).toEqual({ x: 640, y: 600, width: 400, height: 400 })
  })

  it('窗口已被撑大时自愈回 400×400（即使位置未变也纠正尺寸）', () => {
    // 分数缩放下裸 setPosition 会把宽度逐次撑大（如 400 → 460）
    const { win, state, calls } = makeFakeWindow({ x: 500, y: 600, width: 460, height: 400 })

    setPetWindowPosition(win, 500, 600)

    expect(calls.length).toBe(1)
    expect(state.bounds.width).toBe(400)
    expect(state.bounds.height).toBe(400)
  })

  it('目标坐标先取整再比较/下发（DIP 小数不触发多余调用）', () => {
    const { win, calls } = makeFakeWindow({ x: 500, y: 600, width: 400, height: 400 })

    setPetWindowPosition(win, 500.4, 600.4)
    expect(calls.length).toBe(0)

    setPetWindowPosition(win, 500.6, 600)
    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual({ x: 501, y: 600, width: 400, height: 400 })
  })
})
