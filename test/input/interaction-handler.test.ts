/**
 * InteractionHandler（渲染层接线）回归测试。
 *
 * 场景复刻 src/renderer/main.ts 的构造方式：配置只提供 getHitboxPx 与
 * bufferPx，阈值依赖默认值。曾因可选配置以显式 undefined 展开，
 * 覆盖默认阈值导致抚摸/拖拽永不触发（运行时无法拖动宠物）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InteractionHandler } from '../../src/renderer/input/interaction'
import type { PixelRect } from '../../src/shared/input/hitbox'

const HITBOX_PX: PixelRect = { x: 40, y: 20, width: 320, height: 360 }

interface RecordedCalls {
  preempt: string[]
  dragMove: Array<[number, number]>
  enterInteractive: number
  exitInteractive: number
  endPreempt: number
}

let calls: RecordedCalls
let handler: InteractionHandler

function mouseEvent(x: number, y: number): MouseEvent {
  return { button: 0, clientX: x, clientY: y } as unknown as MouseEvent
}

beforeEach(() => {
  calls = {
    preempt: [],
    dragMove: [],
    enterInteractive: 0,
    exitInteractive: 0,
    endPreempt: 0,
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
        preempt: (interaction: string) => {
          calls.preempt.push(interaction)
        },
        endPreempt: () => {
          calls.endPreempt++
        },
        dragMove: (x: number, y: number) => {
          calls.dragMove.push([x, y])
        },
        contextMenu: () => {},
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
  it('按住命中盒 + 移动超过阈值 → preempt(dragged) + drag_move（拖拽回归）', () => {
    handler.handleMouseMove(mouseEvent(200, 200))
    handler.handleMouseDown(mouseEvent(200, 200))
    handler.handleMouseMove(mouseEvent(220, 210))

    expect(calls.preempt).toContain('dragged')
    expect(calls.dragMove.length).toBeGreaterThan(0)
    expect(calls.dragMove[calls.dragMove.length - 1]).toEqual([220, 210])
  })

  it('拖拽后松手 → endPreempt（拖拽收尾）', () => {
    handler.handleMouseMove(mouseEvent(200, 200))
    handler.handleMouseDown(mouseEvent(200, 200))
    handler.handleMouseMove(mouseEvent(220, 210))
    handler.handleMouseUp(mouseEvent(220, 210))

    expect(calls.endPreempt).toBeGreaterThan(0)
  })

  it('命中盒内累积移动 → preempt(petted)（抚摸回归）', () => {
    handler.handleMouseMove(mouseEvent(200, 200))
    handler.handleMouseMove(mouseEvent(202, 200))
    handler.handleMouseMove(mouseEvent(204, 200))

    expect(calls.preempt).toContain('petted')
  })
})
