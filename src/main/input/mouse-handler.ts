/**
 * 鼠标交互处理器 (§10 交互层主进程端)
 *
 * 接收来自渲染进程的交互动作（IPC），执行窗口操作与调度抢占：
 *   - enter/exit interactive → setIgnoreMouseEvents 切换 (§6.1)
 *   - preempt → ClipScheduler.preempt() 抢占交互片段 (§10)
 *   - end_preempt → ClipScheduler.endPreempt() 结束循环交互片段
 *   - drag_move → 窗口跟随光标 (§7.5，使用 spatial/drag 纯逻辑)
 *   - context_menu → 弹出右键菜单 (§10)
 *
 * 渲染进程负责检测交互类型（抚摸/点击/拖拽）并发出动作；
 * 主进程负责执行窗口操作、调度抢占与拖拽窗口位移。
 *
 * 运行于主进程。
 */

import { ipcMain, BrowserWindow, screen } from 'electron'
import { setInteractive } from '../window'
import { showContextMenu } from './context-menu'
import { computeGroundLine } from '../../shared/spatial'
import {
  createDragState,
  pickupDrag,
  dragFollow,
  releaseDrag,
  stepReturn,
  type DragState,
  type DragGeometry,
} from '../../shared/spatial'

/** 鼠标处理器回调 */
export interface MouseHandlerCallbacks {
  /** 暂时隐藏（安全阀的另一入口，§10） */
  onHide: () => void
  /** 设置面板（TASK-015） */
  onSettings: () => void
  /** 关于 */
  onAbout: () => void
  /** 喂食后的需求变更回调 (§10 饥饿↓愉悦↑)，在片段抢占+音频触发后调用 */
  onFeed?: () => void
  /** 给玩具后的需求变更回调 (§10 愉悦↑注意力↑) */
  onToy?: () => void
}

/** 音频协调器接口（最小依赖，便于解耦注入） */
export interface AudioCoordinatorLike {
  onActionTriggered(action: string, clip: import('../../shared/types/clip-meta').ClipMeta | null): void
  onEmbeddedAudioEnded(): void
  toggleMute(): boolean
  readonly isMuted: boolean
}

/** IPC 频道名 */
const IPC = {
  enterInteractive: 'input:enter-interactive',
  exitInteractive: 'input:exit-interactive',
  preempt: 'input:preempt',
  endPreempt: 'input:end-preempt',
  dragMove: 'input:drag-move',
  contextMenu: 'input:context-menu',
  toggleMute: 'audio:toggle-mute',
} as const

/**
 * 鼠标交互处理器。
 *
 * 使用方式：
 *   const handler = new MouseHandler(win, callbacks, dragGeometry)
 *   handler.setScheduler(scheduler)    // 调度器就绪后注入
 *   handler.dispose()                  // 应用退出时清理
 */
export class MouseHandler {
  private scheduler: { preempt(state: string, nowMs: number): unknown; endPreempt(nowMs: number): unknown } | null = null
  private audio: AudioCoordinatorLike | null = null
  private dragState: DragState | null = null

  constructor(
    private readonly window: BrowserWindow,
    private readonly callbacks: MouseHandlerCallbacks,
    private readonly dragGeometry: DragGeometry,
  ) {
    this.registerIpc()
  }

  /** 注入调度器（就绪后调用） */
  setScheduler(scheduler: MouseHandler['scheduler']): void {
    this.scheduler = scheduler
  }

  /** 注入音频协调器（就绪后调用） */
  setAudioCoordinator(audio: AudioCoordinatorLike): void {
    this.audio = audio
  }

  private registerIpc(): void {
    ipcMain.on(IPC.enterInteractive, () => {
      if (!this.window.isDestroyed()) setInteractive(this.window, true)
    })

    ipcMain.on(IPC.exitInteractive, () => {
      if (!this.window.isDestroyed()) setInteractive(this.window, false)
    })

    ipcMain.on(IPC.preempt, (_e, interaction: string) => {
      if (interaction === 'dragged') this.startDrag()
      this.scheduler?.preempt(interaction, Date.now())
      this.audio?.onActionTriggered(interaction, null)
    })

    ipcMain.on(IPC.endPreempt, () => {
      this.endDrag()
      this.scheduler?.endPreempt(Date.now())
      this.audio?.onEmbeddedAudioEnded()
    })

    ipcMain.on(IPC.dragMove, (_e, x: number, y: number) => {
      this.handleDragMove(x, y)
    })

    ipcMain.on(IPC.contextMenu, () => {
      this.handleContextMenu()
    })

    ipcMain.on(IPC.toggleMute, () => {
      this.handleToggleMute()
    })
  }

  // —— 拖拽 —— //

  /** 开始拖拽：记录抓取偏移 (§7.5) */
  private startDrag(): void {
    if (this.dragState) return
    const cursor = screen.getCursorScreenPoint()
    const winBounds = this.window.getBounds()
    this.dragState = createDragState({ x: winBounds.x, y: winBounds.y })
    this.dragState = pickupDrag(this.dragState, { x: cursor.x, y: cursor.y })
  }

  /**
   * 拖拽跟随：窗口跟随光标 (§7.5)。
   *
   * 渲染进程发送光标在窗口内的局部坐标，主进程换算为屏幕坐标后
   * 使用 spatial/drag 的 dragFollow 计算窗口新位置。
   */
  private handleDragMove(localX: number, localY: number): void {
    if (!this.dragState || this.dragState.phase !== 'dragging') return

    // 局部坐标 → 屏幕坐标
    const winBounds = this.window.getBounds()
    const screenCursor = { x: winBounds.x + localX, y: winBounds.y + localY }

    this.dragState = dragFollow(this.dragState, screenCursor)
    this.window.setPosition(
      Math.round(this.dragState.windowPos.x),
      Math.round(this.dragState.windowPos.y),
    )
  }

  /** 结束拖拽：松手回地面线 (§7.5) */
  private endDrag(): void {
    if (!this.dragState || this.dragState.phase !== 'dragging') return

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const bounds = computeGroundLine(display.workArea)

    this.dragState = releaseDrag(this.dragState, bounds, this.dragGeometry)
    // Phase 2：松手后即刻回落到地面线
    this.dragState = stepReturn(this.dragState, bounds, this.dragGeometry, 1.0)

    if (this.dragState.phase === 'idle' && !this.window.isDestroyed()) {
      this.window.setPosition(
        Math.round(this.dragState.windowPos.x),
        Math.round(this.dragState.windowPos.y),
      )
    }

    this.dragState = null
  }

  // —— 右键菜单 —— //

  private handleContextMenu(): void {
    if (this.window.isDestroyed()) return
    showContextMenu(
      this.window,
      {
        onFeed: () => {
          this.scheduler?.preempt('eat', Date.now())
          this.audio?.onActionTriggered('eat', null)
          this.callbacks.onFeed?.()
        },
        onToy: () => {
          this.scheduler?.preempt('play', Date.now())
          this.audio?.onActionTriggered('play', null)
          this.callbacks.onToy?.()
        },
        onToggleMute: () => this.handleToggleMute(),
        onHide: () => this.callbacks.onHide(),
        onSettings: () => this.callbacks.onSettings(),
        onAbout: () => this.callbacks.onAbout(),
      },
      this.audio?.isMuted ?? false,
    )
  }

  /** 切换全局静音 (§11.2)：通知渲染进程更新状态 */
  private handleToggleMute(): void {
    const muted = this.audio?.toggleMute() ?? false
    if (!this.window.isDestroyed()) {
      this.window.webContents.send('audio:set-muted', muted)
    }
  }

  /** 清理 IPC 监听 */
  dispose(): void {
    for (const channel of Object.values(IPC)) {
      ipcMain.removeAllListeners(channel)
    }
  }
}
