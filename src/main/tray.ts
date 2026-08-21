/**
 * 系统托盘 (system tray)
 *
 * 创建托盘图标；右键不再弹出原生菜单，而是经回调 onOpenMenu
 * 打开自定义 HTML 菜单窗口（与宠物右键菜单同款玻璃拟态风格，
 * 见 input/context-menu 控制器）。菜单内容按打开时的状态生成，
 * profile/静音/可见性变化后无需重建。
 *
 * 运行于主进程。
 */

import { Tray, nativeImage } from 'electron'
import { join } from 'path'

import type { TrayMenuCallbacks } from './shell/profile-switcher'

export type { TrayMenuCallbacks, TrayMenuState } from './shell/profile-switcher'

/**
 * 创建系统托盘图标。
 *
 * @param callbacks 菜单回调（右键时使用 onOpenMenu，其余动作经菜单窗口回传）
 */
export function createTray(callbacks: TrayMenuCallbacks): Tray {
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)

  const tray = new Tray(icon)
  tray.setToolTip('PetAliveTools — 桌面宠物')
  tray.on('right-click', () => callbacks.onOpenMenu())
  return tray
}
