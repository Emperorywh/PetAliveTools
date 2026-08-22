/**
 * 行走位移控制器 (§7.3 行走移动)
 *
 * FSM 播放 walk 片段期间，按墙钟恒速水平移动宠物窗口：
 *   - 方向来自行走片段的左右标记（或调度器朝向记忆）；
 *   - 速度恒定，不随视频内容变化，也不读取媒体时间；
 *   - 每次更新按精灵可见范围钳制到当前工作区（与拖拽放置同口径，
 *     窗口透明区域允许越出屏幕边缘）；
 *   - 片段结束（ended 推进周期）或任何非行走片段开始时停止位移。
 *
 * 运行于主进程；纯计算见 shared/spatial/walk-motion。
 */

import type { BrowserWindow } from 'electron'

import { setPetWindowPosition } from '../window'
import {
  walkXAt,
  DEFAULT_WALK_VELOCITY_PX_PER_SEC,
  type WalkDirection,
} from '../../shared/spatial/walk-motion'
import type { Rect, SpriteBounds } from '../../shared/spatial'

/** 控制器依赖（便于测试注入） */
export interface WalkControllerDeps {
  readonly getWindow: () => BrowserWindow | null
  /** 当前工作区（显示器变化后每 tick 重新取用） */
  readonly getWorkArea: () => Rect
  /** 精灵可见包围盒（窗口局部像素），用于边缘钳制 */
  readonly getSpriteBounds: () => SpriteBounds
  /** 时钟注入，缺省 Date.now */
  readonly now?: () => number
}

/** 位移刷新间隔 (ms)：约 60fps，避免调度 tick 粒度带来的可见卡顿 */
const WALK_REFRESH_MS = 16

/** 进行中的位移参数（bounds 每 tick 重取，不固化在实例内） */
interface ActiveMotion {
  readonly startMs: number
  readonly originX: number
  readonly direction: WalkDirection
}

export class WalkController {
  private motion: ActiveMotion | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly deps: WalkControllerDeps,
    private readonly velocityPxPerSec: number = DEFAULT_WALK_VELOCITY_PX_PER_SEC,
  ) {}

  /** 当前是否正在位移 */
  get isActive(): boolean {
    return this.motion !== null
  }

  /**
   * 开始（或继续）向指定方向行走。
   * 同方向重复调用为幂等；方向变化时从当前位置重新起算。
   */
  start(direction: WalkDirection): void {
    if (this.motion?.direction === direction) return
    const win = this.deps.getWindow()
    if (!win || win.isDestroyed()) return
    const nowMs = this.deps.now?.() ?? Date.now()
    this.motion = { startMs: nowMs, originX: win.getPosition()[0], direction }
    if (this.timer === null) {
      this.timer = setInterval(() => this.tick(), WALK_REFRESH_MS)
    }
  }

  /** 停止位移（行走片段结束/被抢占/用户拖拽时调用） */
  stop(): void {
    this.motion = null
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 应用退出时清理定时器 */
  dispose(): void {
    this.stop()
  }

  private tick(): void {
    if (!this.motion) return
    const win = this.deps.getWindow()
    if (!win || win.isDestroyed()) {
      this.stop()
      return
    }
    const nowMs = this.deps.now?.() ?? Date.now()
    const workArea = this.deps.getWorkArea()
    const sprite = this.deps.getSpriteBounds()
    // 精灵留在工作区内；窗口透明区域可越出屏幕边缘（与拖拽放置同口径）
    const minX = workArea.x - sprite.x
    const maxX = workArea.x + workArea.width - (sprite.x + sprite.width)
    const x = walkXAt(
      {
        startMs: this.motion.startMs,
        originX: this.motion.originX,
        direction: this.motion.direction,
        velocityPxPerSec: this.velocityPxPerSec,
        minX,
        maxX,
      },
      nowMs,
    )
    // 60fps 连续移动必须钉住窗口尺寸：分数缩放下裸 setPosition
    // 会逐次撑大窗口；位置/尺寸未变时 helper 自身跳过调用
    setPetWindowPosition(win, x, win.getBounds().y)
  }
}
