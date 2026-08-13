/**
 * 渲染进程交互处理器 (§10 交互层渲染端)
 *
 * 在宠物窗口中监听鼠标事件，驱动交互状态机（src/shared/input），
 * 将状态机输出的动作通过 IPC 发送到主进程执行：
 *   - mousemove（穿透态下也由 forward:true 转发）→ 追踪光标、切换穿透/交互
 *   - mousedown/mouseup（交互态下）→ 抚摸/点击/拖拽检测
 *   - contextmenu（交互态下）→ 弹出右键菜单
 *
 * 命中盒像素坐标由调用方提供（从片段元数据 hitbox 归一化值换算，
 * §5.4/§6.1）。
 *
 * 运行于渲染进程。
 */

import {
  createInteractionState,
  createInteractionContext,
  processInput,
  type InteractionState,
  type InteractionContext,
  type InteractionAction,
  type MouseInputEvent,
} from '../../shared/input'
import type { PixelRect } from '../../shared/input'

/** 交互处理器配置 */
export interface InteractionHandlerConfig {
  /** 获取当前命中盒像素坐标（窗口局部坐标系） */
  readonly getHitboxPx: () => PixelRect
  /** 缓冲带像素 (§6.1: 8–12px)，默认 10 */
  readonly bufferPx?: number
  /** 抚摸触发移动阈值（累积像素），默认 3 */
  readonly pettingMoveThreshold?: number
  /** 拖拽触发移动阈值（距按下点的像素），默认 5 */
  readonly dragMoveThreshold?: number
}

/**
 * 交互处理器。
 *
 * 使用方式：
 *   const handler = new InteractionHandler({ getHitboxPx: () => currentHitbox })
 *   document.addEventListener('mousemove', (e) => handler.handleMouseMove(e))
 *   document.addEventListener('mousedown', (e) => handler.handleMouseDown(e))
 *   document.addEventListener('mouseup',   (e) => handler.handleMouseUp(e))
 *   document.addEventListener('contextmenu', (e) => handler.handleContextMenu(e))
 */
export class InteractionHandler {
  private state: InteractionState = createInteractionState()

  constructor(private readonly config: InteractionHandlerConfig) {}

  /** 当前阶段 */
  get phase(): InteractionState['phase'] {
    return this.state.phase
  }

  private get context(): InteractionContext {
    return createInteractionContext(this.config.getHitboxPx(), {
      bufferPx: this.config.bufferPx,
      pettingMoveThreshold: this.config.pettingMoveThreshold,
      dragMoveThreshold: this.config.dragMoveThreshold,
    })
  }

  /** 处理 mousemove 事件（穿透态下也由 forward:true 转发到渲染进程） */
  handleMouseMove(e: MouseEvent): void {
    this.process({ type: 'move', x: e.clientX, y: e.clientY })
  }

  /** 处理 mousedown 事件（仅左键） */
  handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    this.process({ type: 'down', x: e.clientX, y: e.clientY })
  }

  /** 处理 mouseup 事件（仅左键） */
  handleMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return
    this.process({ type: 'up', x: e.clientX, y: e.clientY })
  }

  /** 处理 contextmenu 事件 → 弹出右键菜单 (§10) */
  handleContextMenu(e: MouseEvent): void {
    e.preventDefault()
    window.petalive?.input?.contextMenu()
  }

  private process(event: MouseInputEvent): void {
    const result = processInput(this.state, event, this.context)
    this.state = result.state
    for (const action of result.actions) {
      this.executeAction(action)
    }
  }

  private executeAction(action: InteractionAction): void {
    const bridge = window.petalive?.input
    if (!bridge) return

    switch (action.kind) {
      case 'enter_interactive':
        bridge.enterInteractive()
        break
      case 'exit_interactive':
        bridge.exitInteractive()
        break
      case 'preempt':
        bridge.preempt(action.interaction)
        break
      case 'end_preempt':
        bridge.endPreempt()
        break
      case 'drag_move':
        bridge.dragMove(action.x, action.y)
        break
    }
  }
}
