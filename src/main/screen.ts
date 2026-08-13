/**
 * 屏幕管理 (screen integration)
 *
 * 职责：通过 Electron screen 模块获取主显示器工作区（workArea），
 * 计算地面线（§7.1），并在显示器热插拔 / 分辨率变化 / 任务栏重定位时
 * 自动重新计算（§13）。
 *
 * 运行于主进程。
 */

import { screen } from 'electron'
import { computeGroundLine, type WorkAreaBounds } from '../shared/spatial'

export type DisplayChangeListener = (bounds: WorkAreaBounds) => void

/**
 * 管理屏幕工作区与地面线。
 *
 * 使用方式：
 *   const mgr = new ScreenManager()
 *   const bounds = mgr.init()          // 初始化 + 注册事件
 *   mgr.onDisplayChange(console.log)   // 订阅变化
 *   mgr.dispose()                      // 注销事件监听
 */
export class ScreenManager {
  private listeners = new Set<DisplayChangeListener>()
  private currentBounds: WorkAreaBounds | null = null
  private started = false

  /** 初始化：计算首次 bounds 并注册 display 事件监听。必须在 app ready 后调用。 */
  init(): WorkAreaBounds {
    if (this.started) return this.currentBounds!

    this.recalculate()
    screen.on('display-added', this.handleDisplayChange)
    screen.on('display-removed', this.handleDisplayChange)
    screen.on('display-metrics-changed', this.handleDisplayMetricsChanged)
    this.started = true
    return this.currentBounds!
  }

  /** 获取当前工作区与地面线。若未 init 则即时计算一次。 */
  getBounds(): WorkAreaBounds {
    if (this.currentBounds) return this.currentBounds
    this.recalculate()
    return this.currentBounds!
  }

  /** 订阅显示器变化回调，返回取消订阅函数。 */
  onDisplayChange(listener: DisplayChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 注销所有事件监听。 */
  dispose(): void {
    if (!this.started) return
    screen.off('display-added', this.handleDisplayChange)
    screen.off('display-removed', this.handleDisplayChange)
    screen.off('display-metrics-changed', this.handleDisplayMetricsChanged)
    this.listeners.clear()
    this.started = false
  }

  // ---- internal ----

  private recalculate(): void {
    const primary = screen.getPrimaryDisplay()
    this.currentBounds = computeGroundLine(primary.workArea)
  }

  private notifyListeners(): void {
    if (!this.currentBounds) return
    for (const listener of this.listeners) {
      listener(this.currentBounds)
    }
  }

  private handleDisplayChange = (): void => {
    this.recalculate()
    this.notifyListeners()
  }

  private handleDisplayMetricsChanged = (): void => {
    this.recalculate()
    this.notifyListeners()
  }
}
