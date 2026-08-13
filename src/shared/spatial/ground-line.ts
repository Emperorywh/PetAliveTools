/**
 * 地面线 (§7.1)
 *
 * 地面线 = 工作区（workArea）底边——自动兼容任务栏在任意边、
 * 任务栏自动隐藏、多显示器布局（Electron screen 模块直接提供）。
 * 宠物足部始终贴合地面线；宠物在地面线上方区域活动。
 *
 * 窗口贴合：精灵锚点（足部/臀部着地点，§6.2）在窗口内位于
 * spriteBaseY（CSS 像素）；使锚点落在地面线上，窗口需下移至
 * groundLine − spriteBaseY。分辨率/显示器变化时重算（§13）。
 *
 * 纯计算，无平台依赖。
 */

/** 矩形区域（与 Electron Rectangle 同构） */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 工作区边界 + 地面线。
 * groundLine = workArea 底边 (§7.1)，宠物足部始终贴合此线。
 */
export interface WorkAreaBounds extends Rect {
  /** 地面线 = workArea.y + workArea.height (§7.1) */
  groundLine: number
}

/**
 * 从工作区矩形计算边界与地面线（纯函数，便于单元测试）。
 */
export function computeGroundLine(workArea: Rect): WorkAreaBounds {
  return {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    groundLine: workArea.y + workArea.height
  }
}

/**
 * 计算窗口的 y 坐标，使精灵锚点（足部）贴合地面线 (§7.1)。
 *
 * @param groundLine 地面线屏幕坐标（= workArea 底边）
 * @param spriteBaseY 精灵锚点在窗口内的 y（CSS 像素，与 DIP 同构）
 */
export function groundedWindowY(groundLine: number, spriteBaseY: number): number {
  if (!Number.isFinite(groundLine)) {
    throw new Error(`invalid groundLine: ${groundLine}`)
  }
  if (!Number.isFinite(spriteBaseY) || spriteBaseY < 0) {
    throw new Error(`invalid spriteBaseY: ${spriteBaseY}`)
  }
  return groundLine - spriteBaseY
}

/**
 * 把窗口 x 钳制到工作区可见范围内（§13：异常位置启动时校正回可见区）。
 *
 * 窗口宽于工作区时贴左边缘（DIP 坐标系下正常不会发生）。
 *
 * @param workArea 工作区矩形
 * @param windowX 期望的窗口 x
 * @param windowWidth 窗口宽度
 */
export function clampWindowX(workArea: Rect, windowX: number, windowWidth: number): number {
  if (!Number.isFinite(windowX)) {
    throw new Error(`invalid windowX: ${windowX}`)
  }
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) {
    throw new Error(`invalid windowWidth: ${windowWidth}`)
  }
  const minX = workArea.x
  const maxX = workArea.x + workArea.width - windowWidth
  if (maxX <= minX) {
    return minX
  }
  return Math.min(Math.max(windowX, minX), maxX)
}
