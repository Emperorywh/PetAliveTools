/**
 * 右键菜单窗口定位 (§10 右键菜单)
 *
 * 以光标为锚点放置菜单窗口，并钳制到显示器工作区：
 * 默认左上角对齐光标；超出工作区右/下边缘时向左/上翻转，
 * 翻转后仍越界（菜单比工作区大）时贴边钳制。
 *
 * 纯计算，无平台依赖。
 */

import type { Rect } from './ground-line'

/** 菜单定位输入 */
export interface MenuPositionInput {
  /** 光标屏幕坐标（DIP） */
  readonly cursor: { readonly x: number; readonly y: number }
  /** 菜单窗口尺寸（DIP） */
  readonly menuSize: { readonly width: number; readonly height: number }
  /** 光标所在显示器工作区（DIP） */
  readonly workArea: Rect
}

/**
 * 计算菜单窗口位置：光标锚定 + 工作区钳制。
 *
 * 与原生 Menu.popup 行为一致地以光标为菜单左上角；
 * 越界时优先翻转（向左/向上展开），保证菜单完整可见。
 */
export function clampMenuPosition(input: MenuPositionInput): {
  x: number
  y: number
} {
  const { cursor, menuSize, workArea } = input
  const right = workArea.x + workArea.width
  const bottom = workArea.y + workArea.height

  let x = cursor.x
  if (x + menuSize.width > right) {
    // 右侧放不下 → 向左翻转；翻转后仍越界则贴右边缘
    x = Math.max(workArea.x, cursor.x - menuSize.width)
    if (x + menuSize.width > right) x = right - menuSize.width
  }

  let y = cursor.y
  if (y + menuSize.height > bottom) {
    // 下方放不下 → 顶端贴工作区底边
    y = bottom - menuSize.height
  }
  if (y < workArea.y) y = workArea.y

  return { x: Math.round(x), y: Math.round(y) }
}
