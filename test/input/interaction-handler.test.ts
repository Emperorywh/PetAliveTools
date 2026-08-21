/**
 * InteractionHandler（渲染层接线）回归测试。
 *
 * 场景复刻 src/renderer/main.ts 的构造方式：配置只提供 getHitboxPx 与
 * bufferPx，阈值依赖默认值。曾因可选配置以显式 undefined 展开，
 * 覆盖默认阈值导致拖拽永不触发（运行时无法拖动宠物）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InteractionHandler } from '../../src/renderer/input/interaction'
import type { PixelRect } from '../../src/shared/input/hitbox'

const HITBOX_PX: PixelRect = { x: 40, y: 20, width: 320, height: 360 }

interface RecordedCalls {
  dragMove: Array<[number, number]>
  dragEnd: number
  dragEndHitbox: PixelRect | null
  enterInteractive: number
  exitInteractive: number
  contextMenu: number
}

let calls: RecordedCalls
let handler: InteractionHandler

function mouseEvent(x: number, y: number): MouseEvent {
  return { button: 0, clientX: x, clientY: y } as unknown as MouseEvent
}

/** contextmenu 事件（button=2 为右键） */
function contextMenuEvent(): MouseEvent {
  return { button: 2, clientX: 200, clientY: 200, preventDefault: () => {} } as unknown as MouseEvent
}

beforeEach(() => {
  calls = {
    dragMove: [],
    dragEnd: 0,
    dragEndHitbox: null,
    enterInteractive: 0,
    exitInteractive: 0,
    contextMenu: 0,
  }
  vi.stubGlobal('window', {
    petalive: {
      input: {
        enterInteractive: () => {
          calls.enterInteractive++
        },
        exitInteractive: () => {
          calls.exitInteractive++
        },
        dragMove: (x: number, y: number) => {
          calls.dragMove.push([x, y])
        },
        dragEnd: (hitbox?: PixelRect) => {
          calls.dragEnd++
          calls.dragEndHitbox = hitbox ?? null
        },
        contextMenu: () => {
          calls.contextMenu++
        },
      },
    },
  })
  handler = new InteractionHandler({
    getHitboxPx: () => HITBOX_PX,
    bufferPx: 10,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('InteractionHandler 默认阈值（未配置 threshold 的构造方式）', () => {
  it('按住命中盒 + 移动超过阈值 → drag_move（拖拽回归）', () => {
    handler.handleMouseMove(mouseEvent(200, 200))
    handler.handleMouseDown(mouseEvent(200, 200))
    handler.handleMouseMove(mouseEvent(220, 210))

    expect(calls.dragMove.length).toBeGreaterThan(0)
    expect(calls.dragMove[calls.dragMove.length - 1]).toEqual([220, 210])
  })

  it('拖拽后松手 → dragEnd（回传当前命中盒供放置钳制）', () => {
    handler.handleMouseMove(mouseEvent(200, 200))
    handler.handleMouseDown(mouseEvent(200, 200))
    handler.handleMouseMove(mouseEvent(220, 210))
    handler.handleMouseUp(mouseEvent(220, 210))

    expect(calls.dragEnd).toBe(1)
    expect(calls.dragEndHitbox).toEqual(HITBOX_PX)
  })

  it('命中盒内移动/点击不触发任何交互动作（交互不切换视频）', () => {
    handler.handleMouseMove(mouseEvent(200, 200))
    handler.handleMouseMove(mouseEvent(202, 200))
    handler.handleMouseUp(mouseEvent(204, 200))
    handler.handleMouseDown(mouseEvent(204, 200))
    handler.handleMouseUp(mouseEvent(204, 200))

    expect(calls.dragMove).toEqual([])
    expect(calls.dragEnd).toBe(0)
    expect(calls.enterInteractive).toBe(1)
  })
})

describe('InteractionHandler 右键菜单（contextmenu）', () => {
  it('悬停态右键 → 通知主进程弹出菜单', () => {
    handler.handleMouseMove(mouseEvent(200, 200))
    handler.handleContextMenu(contextMenuEvent())

    expect(calls.contextMenu).toBe(1)
  })

  it('拖拽进行中右键 → 不弹出菜单（避免与拖拽冲突）', () => {
    handler.handleMouseMove(mouseEvent(200, 200))
    handler.handleMouseDown(mouseEvent(200, 200))
    handler.handleMouseMove(mouseEvent(230, 210)) // 超过阈值进入 dragging
    handler.handleContextMenu(contextMenuEvent())

    expect(calls.dragMove.length).toBeGreaterThan(0)
    expect(calls.contextMenu).toBe(0)
  })
})
