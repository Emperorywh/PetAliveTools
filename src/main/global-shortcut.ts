/**
 * 全局快捷键 (global shortcut)
 *
 * 注册安全阀快捷键 Ctrl+Shift+H，临时隐藏/恢复宠物窗口（§10）。
 *
 * 运行于主进程。
 */

import { globalShortcut, BrowserWindow } from 'electron'

/** 安全阀快捷键（§10），可在设置中修改 */
export const HIDE_SHORTCUT = 'CommandOrControl+Shift+H'

/**
 * 注册隐藏/恢复快捷键。
 *
 * 按下时：若窗口可见则隐藏，若隐藏则恢复（§10 安全阀）。
 *
 * @param getWindow 返回当前宠物窗口（可能已被销毁）
 * @returns 是否注册成功
 */
export function registerHideShortcut(getWindow: () => BrowserWindow | null): boolean {
  return globalShortcut.register(HIDE_SHORTCUT, () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return

    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
    }
  })
}

/** 注销隐藏快捷键。应在 app 'will-quit' 时调用。 */
export function unregisterHideShortcut(): void {
  globalShortcut.unregister(HIDE_SHORTCUT)
}
