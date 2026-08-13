/**
 * 系统托盘 (system tray)
 *
 * 创建托盘图标与上下文菜单（§10、§12.2、§12.4）。
 * 菜单模板由 profile-switcher 的纯函数构建（含宠物切换/导入导出区段），
 * profile 或静音状态变化后调用 rebuildTrayMenu 重建。
 *
 * 运行于主进程。
 */

import { Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'

import {
  buildTrayTemplate,
  type TrayMenuCallbacks,
  type TrayMenuState,
} from './shell/profile-switcher'

export type { TrayMenuCallbacks, TrayMenuState } from './shell/profile-switcher'

/**
 * 创建系统托盘图标与右键菜单。
 *
 * 初始菜单为无 profile 状态；接线完成后应调用 rebuildTrayMenu
 * 填入实际宠物列表。
 *
 * @param callbacks 菜单回调
 */
export function createTray(callbacks: TrayMenuCallbacks): Tray {
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)

  const tray = new Tray(icon)
  tray.setToolTip('PetAliveTools — 桌面宠物')
  rebuildTrayMenu(tray, { profiles: [], activeProfileId: null, isMuted: false }, callbacks)
  return tray
}

/**
 * 以给定状态重建托盘菜单（宠物列表/活跃项/静音标签）。
 *
 * @param tray 托盘实例
 * @param state 菜单状态
 * @param callbacks 菜单回调
 */
export function rebuildTrayMenu(
  tray: Tray,
  state: TrayMenuState,
  callbacks: TrayMenuCallbacks,
): void {
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayTemplate(state, callbacks)))
}
