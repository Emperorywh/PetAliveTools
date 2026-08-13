/**
 * 右键上下文菜单 (§10 右键菜单)
 *
 * 菜单项：喂食 / 给玩具 / 隐藏 / 设置 / 关于。
 * 在宠物窗口右键时弹出（交互态下由渲染进程触发）。
 *
 * 运行于主进程。
 */

import { Menu, BrowserWindow } from 'electron'

/** 上下文菜单回调 */
export interface ContextMenuCallbacks {
  /** 喂食（触发 eat 片段，道具类 §8.4，饥饿↓） */
  onFeed: () => void
  /** 给玩具（触发 play 片段，道具类 §8.4，愉悦↑） */
  onToy: () => void
  /** 切换静音 (§11.2 全局静音开关) */
  onToggleMute: () => void
  /** 暂时隐藏（安全阀的另一入口，§10） */
  onHide: () => void
  /** 设置面板（TASK-015） */
  onSettings: () => void
  /** 关于 */
  onAbout: () => void
}

/**
 * 在指定窗口的当前光标位置弹出右键上下文菜单 (§10)。
 *
 * 菜单结构：
 *   喂食
 *   给玩具
 *   静音/取消静音
 *   ────────
 *   隐藏
 *   设置
 *   ────────
 *   关于
 *
 * @param isMuted 当前是否已静音（用于菜单标签切换）
 */
export function showContextMenu(
  win: BrowserWindow,
  callbacks: ContextMenuCallbacks,
  isMuted = false,
): void {
  const menu = Menu.buildFromTemplate([
    { label: '喂食', click: () => callbacks.onFeed() },
    { label: '给玩具', click: () => callbacks.onToy() },
    { label: isMuted ? '取消静音' : '静音', click: () => callbacks.onToggleMute() },
    { type: 'separator' },
    { label: '隐藏', click: () => callbacks.onHide() },
    { label: '设置', click: () => callbacks.onSettings() },
    { type: 'separator' },
    { label: '关于', click: () => callbacks.onAbout() },
  ])
  menu.popup({ window: win })
}
