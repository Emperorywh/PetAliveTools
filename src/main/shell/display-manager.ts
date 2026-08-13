/**
 * 多显示器管理 (display manager) — §6.4 多显示器/DPI, §13 显示变化处理
 *
 * 职责：
 *   - 枚举所有显示器（含 scaleFactor）
 *   - 选择目标显示器（默认主显示器）
 *   - DPI 感知尺度计算（高 DPI 下归一化渲染保证清晰，§6.4）
 *   - 监听热插拔 / 分辨率变化 / 任务栏移动，重算 workArea / 地面线 / 尺度
 *   - 宠物回到可见区域（§13）
 *
 * 运行于主进程。
 */

import { screen, type Display } from 'electron'
import {
  computeGroundLine,
  clampWindowX,
  groundedWindowY,
  computeNormalizedScale,
  SHOULDER_HEIGHT_FACTOR,
  type WorkAreaBounds,
  type Rect,
} from '../../shared/spatial'

/** 显示器信息（精简版，用于 UI 列表） */
export interface DisplayInfo {
  /** Electron Display.id */
  readonly id: number
  /** 缩放因子 (§6.4)：1.0 = 标准 DPI，2.0 = Retina/4K */
  readonly scaleFactor: number
  /** 显示器完整边界（屏幕坐标，DIP） */
  readonly bounds: Rect
  /** 工作区（排除任务栏） */
  readonly workArea: Rect
  /** 是否为主显示器 */
  readonly isPrimary: boolean
  /** 友好标签（如 "Display 1"） */
  readonly label: string
}

/** 显示变化事件：包含新的 workArea / groundLine / 显示器信息 */
export interface DisplayChangeEvent {
  /** 选中显示器的 workArea + groundLine */
  readonly bounds: WorkAreaBounds
  /** 当前选中显示器的 scaleFactor */
  readonly scaleFactor: number
  /** 当前选中显示器的 ID */
  readonly displayId: number
  /** 选中显示器是否发生了切换（如热插拔导致回退到主显示器） */
  readonly switched: boolean
}

export type DisplayChangeListener = (event: DisplayChangeEvent) => void

/**
 * 把 Electron Display 转为 DisplayInfo（纯映射函数）。
 */
export function toDisplayInfo(display: Display, index: number): DisplayInfo {
  const isPrimary = screen.getPrimaryDisplay().id === display.id
  return {
    id: display.id,
    scaleFactor: display.scaleFactor,
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
    isPrimary,
    label: `Display ${index + 1}${isPrimary ? ' (主)' : ''}`,
  }
}

/**
 * 枚举所有显示器（§6.4）。
 */
export function enumerateAllDisplays(): DisplayInfo[] {
  const all = screen.getAllDisplays()
  return all.map((d, i) => toDisplayInfo(d, i))
}

/**
 * 从显示器列表中解析选中的显示器（纯函数）。
 *
 * - displayId === null → 主显示器
 * - displayId 未找到 → 回退到主显示器（§13 安全行为）
 */
export function resolveSelectedDisplay(
  displays: readonly DisplayInfo[],
  displayId: number | null,
): { display: DisplayInfo; switched: boolean } {
  if (displayId !== null) {
    const found = displays.find((d) => d.id === displayId)
    if (found) {
      return { display: found, switched: false }
    }
  }
  // 回退到主显示器
  const primary = displays.find((d) => d.isPrimary) ?? displays[0]
  return { display: primary, switched: displayId !== null }
}

/**
 * 计算 DPI 感知的渲染尺度 (§6.4)。
 *
 * 高 DPI 显示器上 workArea.height 为 DIP（CSS 像素）；
 * 物理像素 = DIP × scaleFactor。归一化尺度基于 DIP 计算
 * （窗口定位用 DIP），但视频分辨率需 ≥ 物理像素才能保证清晰。
 *
 * @returns CSS transform scale 值
 */
export function computeDpiAwareScale(params: {
  /** 工作区高度 (DIP / CSS 像素) */
  readonly workAreaHeightDip: number
  /** 显示器缩放因子 */
  readonly scaleFactor: number
  /** 目标肩高占屏幕高度比例 (0–1) */
  readonly screenPercent: number
  /** 片段固有像素高度 */
  readonly clipHeightPx: number
  /** 片段相对基准的缩放系数 */
  readonly scaleHint: number
}): number {
  const { workAreaHeightDip, scaleFactor, screenPercent, clipHeightPx, scaleHint } = params
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new Error(`invalid scaleFactor: ${scaleFactor}`)
  }
  // 归一化尺度基于 DIP 高度（窗口定位使用 DIP）
  // scaleFactor 仅影响视频需要的最低编码分辨率（由转码管线保证）
  // 此处返回的 scale 直接用于 CSS transform
  return computeNormalizedScale({
    screenHeightPx: workAreaHeightDip,
    screenPercent,
    clipHeightPx,
    scaleHint,
  })
}

/**
 * 计算高 DPI 显示器所需的最低视频分辨率高度（像素）。
 *
 * 用于判断视频分辨率是否足以在高 DPI 下保持清晰（§6.4）。
 * 转码管线据此选择分辨率档位。
 */
export function minVideoResolutionForDpi(
  workAreaHeightDip: number,
  scaleFactor: number,
): number {
  return Math.ceil(workAreaHeightDip * scaleFactor)
}

/**
 * 管理多显示器选择与显示变化处理。
 *
 * 使用方式：
 *   const mgr = new DisplayManager()
 *   mgr.init(null)                    // 初始化（null = 主显示器）
 *   const infos = mgr.enumerate()     // 枚举所有显示器
 *   mgr.selectDisplay(id)             // 切换到指定显示器
 *   mgr.onDisplayChange(handler)      // 订阅变化
 *   mgr.dispose()                     // 清理
 */
export class DisplayManager {
  private listeners = new Set<DisplayChangeListener>()
  private selectedDisplayId: number | null = null
  private currentBounds: WorkAreaBounds | null = null
  private currentScaleFactor = 1
  private currentDisplayId = 0
  private started = false

  /** 初始化：计算首次状态并注册事件监听。必须在 app ready 后调用。 */
  init(displayId: number | null): DisplayChangeEvent {
    if (this.started) return this.buildEvent(false)
    this.selectedDisplayId = displayId
    this.recalculate()
    screen.on('display-added', this.handleDisplayChange)
    screen.on('display-removed', this.handleDisplayRemoved)
    screen.on('display-metrics-changed', this.handleDisplayMetricsChanged)
    this.started = true
    return this.buildEvent(false)
  }

  /** 枚举所有显示器 */
  enumerate(): DisplayInfo[] {
    return enumerateAllDisplays()
  }

  /** 获取当前选中的 displayId（null = 主显示器） */
  getSelectedDisplayId(): number | null {
    return this.selectedDisplayId
  }

  /** 选择显示器。返回新状态。 */
  selectDisplay(displayId: number | null): DisplayChangeEvent {
    this.selectedDisplayId = displayId
    this.recalculate()
    const event = this.buildEvent(false)
    this.notifyListeners(event)
    return event
  }

  /** 获取当前 workArea + groundLine */
  getBounds(): WorkAreaBounds {
    if (!this.currentBounds) this.recalculate()
    return this.currentBounds!
  }

  /** 获取当前 scaleFactor */
  getScaleFactor(): number {
    return this.currentScaleFactor
  }

  /** 订阅显示器变化回调，返回取消订阅函数。 */
  onDisplayChange(listener: DisplayChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 将窗口位置校正到当前显示器的可见区域 (§13)。
   *
   * @param windowX 窗口当前 x
   * @param windowWidth 窗口宽度
   * @param spriteBaseY 精灵锚点在窗口内的 y
   * @returns { x, y } 校正后的窗口坐标
   */
  clampToVisibleArea(
    windowX: number,
    windowWidth: number,
    spriteBaseY: number,
  ): { x: number; y: number } {
    const bounds = this.getBounds()
    const x = clampWindowX(bounds, windowX, windowWidth)
    const y = groundedWindowY(bounds.groundLine, spriteBaseY)
    return { x, y }
  }

  /** 注销所有事件监听。 */
  dispose(): void {
    if (!this.started) return
    screen.off('display-added', this.handleDisplayChange)
    screen.off('display-removed', this.handleDisplayRemoved)
    screen.off('display-metrics-changed', this.handleDisplayMetricsChanged)
    this.listeners.clear()
    this.started = false
  }

  // ---- internal ----

  private recalculate(): void {
    const all = screen.getAllDisplays()
    const infos = all.map((d, i) => toDisplayInfo(d, i))
    const { display, switched: didSwitch } = resolveSelectedDisplay(infos, this.selectedDisplayId)

    this.currentBounds = computeGroundLine(display.workArea)
    this.currentScaleFactor = display.scaleFactor
    this.currentDisplayId = display.id
    if (didSwitch) {
      // 选中的显示器不存在了，更新 selectedDisplayId
      this.selectedDisplayId = null
    }
  }

  private buildEvent(switched: boolean): DisplayChangeEvent {
    if (!this.currentBounds) this.recalculate()
    return {
      bounds: this.currentBounds!,
      scaleFactor: this.currentScaleFactor,
      displayId: this.currentDisplayId,
      switched,
    }
  }

  private notifyListeners(event: DisplayChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private handleDisplayChange = (): void => {
    this.recalculate()
    this.notifyListeners(this.buildEvent(false))
  }

  private handleDisplayRemoved = (): void => {
    // 选中的显示器可能已被移除，recalculate 会回退到主显示器
    const prevId = this.currentDisplayId
    this.recalculate()
    const event = this.buildEvent(this.currentDisplayId !== prevId)
    this.notifyListeners(event)
  }

  private handleDisplayMetricsChanged = (): void => {
    // 分辨率/缩放/任务栏变化 (§13)
    this.recalculate()
    this.notifyListeners(this.buildEvent(false))
  }
}

/** 重新导出 spatial 常量供调用方使用 */
export { SHOULDER_HEIGHT_FACTOR }
