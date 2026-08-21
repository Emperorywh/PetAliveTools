import { describe, it, expect } from 'vitest'
import { clampMenuPosition } from '../../src/shared/spatial/menu-position'

/** 1920×1040 主屏工作区（与 mouse-handler 测试基线一致） */
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 }
const MENU = { width: 240, height: 376 }

describe('clampMenuPosition (右键菜单窗口定位)', () => {
  it('光标远离边缘 → 左上角对齐光标（原生菜单行为）', () => {
    const pos = clampMenuPosition({ cursor: { x: 800, y: 400 }, menuSize: MENU, workArea: WORK_AREA })
    expect(pos).toEqual({ x: 800, y: 400 })
  })

  it('右侧放不下 → 向左翻转，菜单右缘对齐光标', () => {
    const pos = clampMenuPosition({ cursor: { x: 1900, y: 400 }, menuSize: MENU, workArea: WORK_AREA })
    expect(pos.x).toBe(1900 - MENU.width)
    expect(pos.y).toBe(400)
  })

  it('下方放不下 → 底边贴工作区下缘', () => {
    const pos = clampMenuPosition({ cursor: { x: 800, y: 1020 }, menuSize: MENU, workArea: WORK_AREA })
    expect(pos.x).toBe(800)
    expect(pos.y).toBe(WORK_AREA.height - MENU.height)
  })

  it('右下角 → 同时向左翻转并贴底', () => {
    const pos = clampMenuPosition({ cursor: { x: 1910, y: 1030 }, menuSize: MENU, workArea: WORK_AREA })
    expect(pos.x).toBe(1910 - MENU.width)
    expect(pos.y).toBe(WORK_AREA.height - MENU.height)
  })

  it('光标在工作区上缘之上 → y 钳制到工作区顶部（副屏坐标偏移场景）', () => {
    const area = { x: 1920, y: -300, width: 1280, height: 900 }
    const pos = clampMenuPosition({ cursor: { x: 2400, y: -320 }, menuSize: MENU, workArea: area })
    expect(pos.y).toBe(-300)
    expect(pos.x).toBe(2400)
  })

  it('结果取整（窗口 setPosition 需整数坐标）', () => {
    const pos = clampMenuPosition({ cursor: { x: 100.6, y: 50.2 }, menuSize: MENU, workArea: WORK_AREA })
    expect(Number.isInteger(pos.x)).toBe(true)
    expect(Number.isInteger(pos.y)).toBe(true)
  })
})
