/**
 * 系统托盘 (system tray)
 *
 * 创建托盘图标与上下文菜单（§10、§12.4）。
 * 菜单项：喂食 / 给玩具 / 隐藏 / 设置 / 关于 / 退出。
 *
 * 运行于主进程。
 */

import { app, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'

/** 托盘菜单回调 */
export interface TrayMenuCallbacks {
  /** 喂食（触发 eat 片段，道具类，§8.4） */
  onFeed: () => void
  /** 给玩具（触发 play 片段） */
  onToy: () => void
  /** 切换静音 (§11.2 全局静音开关) */
  onToggleMute: () => void
  /** 暂时隐藏（安全阀的另一入口，§10） */
  onToggleHide: () => void
  /** 设置面板（TASK-015） */
  onSettings: () => void
  /** 关于 */
  onAbout: () => void
}

/**
 * 创建系统托盘图标与右键菜单。
 *
 * 菜单结构（§10）：
 *   喂食
 *   给玩具
 *   静音/取消静音
 *   ────────
 *   隐藏
 *   设置
 *   ────────
 *   关于
 *   退出
 *
 * @param isMuted 当前是否已静音（用于菜单标签切换）
 */
export function createTray(callbacks: TrayMenuCallbacks, isMuted = false): Tray {
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)

  const tray = new Tray(icon)
  tray.setToolTip('PetAliveTools — 桌面宠物')

  const contextMenu = Menu.buildFromTemplate([
    { label: '喂食', click: () => callbacks.onFeed() },
    { label: '给玩具', click: () => callbacks.onToy() },
    { label: isMuted ? '取消静音' : '静音', click: () => callbacks.onToggleMute() },
    { type: 'separator' },
    { label: '隐藏', click: () => callbacks.onToggleHide() },
    { label: '设置', click: () => callbacks.onSettings() },
    { type: 'separator' },
    { label: '关于', click: () => callbacks.onAbout() },
    { label: '退出', click: () => app.quit() }
  ])

  tray.setContextMenu(contextMenu)
  return tray
}
