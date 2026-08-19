/**
 * 鼠标交互处理器 (§10 交互层主进程端)
 *
 * 接收来自渲染进程的交互动作（IPC），执行窗口操作与调度抢占：
 *   - enter/exit interactive → setIgnoreMouseEvents 切换 (§6.1)
 *   - preempt → ClipScheduler.preempt() 抢占交互片段 (§10)
 *   - end_preempt → ClipScheduler.endPreempt() 结束循环交互片段
 *   - drag_move → 窗口跟随光标 (§7.3，使用 spatial/drag 纯逻辑)
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
import { defaultHitboxPx } from '../../shared/input'
import type { PixelRect } from '../../shared/input'
import type { ClipMeta } from '../../shared/types/clip-meta'
import type { RenderCommand, TickResult } from '../scheduler/clip-scheduler'
import {
  createDragState,
  pickupDrag,
  dragFollow,
  releaseDrag,
  type DragState,
  type DragGeometry,
  type SpriteBounds,
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
  /** 打开导入向导（§5.5，向活跃宠物目录导入片段） */
  onImportWizard?: () => void
  /**
   * 交互需求反馈 (§10 交互表 / §9.4, IR-008)：
   * 抚摸/点击/拖拽抢占时调用，参数为交互类型 (petted/clicked/dragged)。
   */
  onInteractionNeeds?: (interaction: string) => void
}

/** 音频协调器接口（最小依赖，便于解耦注入） */
export interface AudioCoordinatorLike {
  onActionTriggered(action: string, clip: ClipMeta | null): void
  onEmbeddedAudioEnded(): void
  toggleMute(): boolean
  readonly isMuted: boolean
}

/** 调度器接口（IR-001：返回 TickResult 供命令分发） */
export interface PreemptableScheduler {
  preempt(state: string, nowMs: number): TickResult
  endPreempt(nowMs: number): TickResult
}

/** 渲染命令分发器 (IR-001)：与 tick 循环相同的 processSchedulerCommands 分发 */
export type CommandDispatcher = (commands: readonly RenderCommand[]) => void

/** IPC 频道名 */
const IPC = {
  enterInteractive: 'input:enter-interactive',
  exitInteractive: 'input:exit-interactive',
  preempt: 'input:preempt',
  endPreempt: 'input:end-preempt',
  dragMove: 'input:drag-move',
  contextMenu: 'input:context-menu',
} as const

/**
 * 鼠标交互处理器。
 *
 * 使用方式：
 *   const handler = new MouseHandler(win, callbacks, dragGeometry)
 *   handler.setScheduler(scheduler)            // 调度器就绪后注入
 *   handler.setCommandDispatcher(dispatch)     // IR-001：抢占命令分发（与 tick 同链路）
 *   handler.dispose()                          // 应用退出时清理
 */
export class MouseHandler {
  private scheduler: PreemptableScheduler | null = null
  private audio: AudioCoordinatorLike | null = null
  private dispatcher: CommandDispatcher | null = null
  private dragState: DragState | null = null

  constructor(
    private readonly window: BrowserWindow,
    private readonly callbacks: MouseHandlerCallbacks,
    private readonly dragGeometry: DragGeometry,
  ) {
    this.registerIpc()
  }

  /** 注入调度器（就绪后调用） */
  setScheduler(scheduler: PreemptableScheduler | null): void {
    this.scheduler = scheduler
  }

  /** 注入命令分发器 (IR-001)：preempt/endPreempt 的渲染命令经此上屏 */
  setCommandDispatcher(dispatcher: CommandDispatcher): void {
    this.dispatcher = dispatcher
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
      const result = this.scheduler?.preempt(interaction, Date.now())
      // IR-001：抢占产生的渲染命令送入与 tick 循环相同的分发链路
      this.dispatch(result?.commands)
      // IR-010 / GAP-005：传递抢占选中的真实片段，embeddedAudio/clip.audio 判定可达
      this.audio?.onActionTriggered(interaction, this.preemptTargetClip(result))
      // IR-008：抚摸/点击/拖拽的需求反馈 (§10 交互表)
      this.callbacks.onInteractionNeeds?.(interaction)
    })

    ipcMain.on(IPC.endPreempt, (_e, hitbox?: PixelRect) => {
      this.endDrag(hitbox)
      const result = this.scheduler?.endPreempt(Date.now())
      this.dispatch(result?.commands)
      this.audio?.onEmbeddedAudioEnded()
    })

    ipcMain.on(IPC.dragMove, (_e, x: number, y: number) => {
      this.handleDragMove(x, y)
    })

    ipcMain.on(IPC.contextMenu, () => {
      this.handleContextMenu()
    })
  }

  /** 分发渲染命令 (IR-001) */
  private dispatch(commands: readonly RenderCommand[] | undefined): void {
    if (commands && commands.length > 0) {
      this.dispatcher?.(commands)
    }
  }

  /** 从抢占结果中取目标片段（无调度器/无周期时为 null） */
  private preemptTargetClip(result: TickResult | undefined): ClipMeta | null {
    return result?.state.cycle?.targetClip ?? null
  }

  // —— 拖拽 —— //

  /** 开始拖拽：记录抓取偏移 (§7.3) */
  private startDrag(): void {
    if (this.dragState) return
    const cursor = screen.getCursorScreenPoint()
    const winBounds = this.window.getBounds()
    this.dragState = createDragState({ x: winBounds.x, y: winBounds.y })
    this.dragState = pickupDrag(this.dragState, { x: cursor.x, y: cursor.y })
  }

  /**
   * 拖拽跟随：窗口跟随光标 (§7.3)。
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

  /**
   * 结束拖拽：松手后按精灵可见范围钳制 x、足部落回地面线 (§7.3/§7.1)。
   *
   * @param hitbox 渲染进程在结束抢占时回传的当前命中盒（窗口局部像素）
   */
  private endDrag(hitbox?: PixelRect): void {
    if (!this.dragState || this.dragState.phase !== 'dragging') return

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const bounds = computeGroundLine(display.workArea)

    this.dragState = releaseDrag(this.dragState, bounds, this.resolveSpriteBounds(hitbox))

    if (!this.window.isDestroyed()) {
      this.window.setPosition(
        Math.round(this.dragState.windowPos.x),
        Math.round(this.dragState.windowPos.y),
      )
    }

    this.dragState = null
  }

  /**
   * 渲染进程回传的命中盒 → 精灵包围盒。
   * 缺失或非法（IPC 载荷异常）时回落到窗口默认命中区域，
   * 与渲染进程 getHitboxPx 的初始口径一致。
   */
  private resolveSpriteBounds(hitbox?: PixelRect): SpriteBounds {
    if (
      hitbox &&
      Number.isFinite(hitbox.x) &&
      Number.isFinite(hitbox.y) &&
      Number.isFinite(hitbox.width) &&
      Number.isFinite(hitbox.height) &&
      hitbox.width > 0 &&
      hitbox.height > 0
    ) {
      return hitbox
    }
    return defaultHitboxPx(this.dragGeometry.windowWidth, this.dragGeometry.windowHeight)
  }

  // —— 右键菜单 —— //

  private handleContextMenu(): void {
    if (this.window.isDestroyed()) return
    showContextMenu(
      this.window,
      {
        onFeed: () => {
          // 喂食 → 讨食片段（D 类 beg_food；无片段时仅需求生效）
          const result = this.scheduler?.preempt('beg_food', Date.now())
          this.dispatch(result?.commands)
          this.audio?.onActionTriggered('beg_food', this.preemptTargetClip(result))
          this.callbacks.onFeed?.()
        },
        onToy: () => {
          // 给玩具 → 求玩片段（D 类 want_play）
          const result = this.scheduler?.preempt('want_play', Date.now())
          this.dispatch(result?.commands)
          this.audio?.onActionTriggered('want_play', this.preemptTargetClip(result))
          this.callbacks.onToy?.()
        },
        onCall: () => {
          // 呼唤 → 被呼唤转身片段（B 类 called）
          const result = this.scheduler?.preempt('called', Date.now())
          this.dispatch(result?.commands)
          this.audio?.onActionTriggered('called', this.preemptTargetClip(result))
        },
        onToggleMute: () => this.handleToggleMute(),
        onHide: () => this.callbacks.onHide(),
        onSettings: () => this.callbacks.onSettings(),
        onAbout: () => this.callbacks.onAbout(),
        onImportWizard: () => this.callbacks.onImportWizard?.(),
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
