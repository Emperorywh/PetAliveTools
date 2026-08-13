/**
 * 可配置全局快捷键 (hotkey config) — §10
 *
 * 安全阀快捷键（隐藏/恢复宠物窗口）可在设置面板中重新配置。
 * 支持注销旧快捷键、注册新快捷键。
 *
 * 运行于主进程。
 */

import { globalShortcut, BrowserWindow } from 'electron'

/** 默认快捷键 accelerator (§10) */
export const DEFAULT_HIDE_HOTKEY = 'CommandOrControl+Shift+H'

/**
 * 快捷键管理器：注册/注销安全阀快捷键，支持运行时重配置。
 *
 * 使用方式：
 *   const mgr = new HotkeyManager(getWindow)
 *   mgr.register('CommandOrControl+Shift+H')
 *   mgr.reregister('CommandOrControl+Shift+J')
 *   mgr.unregister()
 */
export class HotkeyManager {
  private currentAccelerator: string | null = null

  /**
   * @param getWindow 返回当前宠物窗口（可能已被销毁）
   * @param onToggle 快捷键按下时的回调（默认：切换窗口可见性）
   */
  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly onToggle?: (win: BrowserWindow) => void,
  ) {}

  /**
   * 注册快捷键。若已有注册则先注销。
   *
   * @returns 是否注册成功（失败可能因快捷键被其他应用占用）
   */
  register(accelerator: string): boolean {
    this.unregister()
    const success = globalShortcut.register(accelerator, () => {
      const win = this.getWindow()
      if (!win || win.isDestroyed()) return
      if (this.onToggle) {
        this.onToggle(win)
      } else {
        if (win.isVisible()) {
          win.hide()
        } else {
          win.show()
        }
      }
    })
    if (success) {
      this.currentAccelerator = accelerator
    }
    return success
  }

  /** 重新注册为新快捷键。若失败则恢复旧快捷键。 */
  reregister(newAccelerator: string): { success: boolean; activeAccelerator: string | null } {
    const old = this.currentAccelerator
    const success = this.register(newAccelerator)
    if (!success && old) {
      // 恢复旧快捷键
      this.register(old)
      return { success: false, activeAccelerator: old }
    }
    return { success, activeAccelerator: this.currentAccelerator }
  }

  /** 注销当前快捷键 */
  unregister(): void {
    if (this.currentAccelerator) {
      globalShortcut.unregister(this.currentAccelerator)
      this.currentAccelerator = null
    }
  }

  /** 当前注册的快捷键（未注册则 null） */
  get accelerator(): string | null {
    return this.currentAccelerator
  }

  /** 注销全部（app will-quit 时调用） */
  dispose(): void {
    this.unregister()
  }
}

/**
 * 验证 accelerator 格式是否合法（基本非空检查）。
 *
 * Electron 的 globalShortcut.register 在格式非法时会抛异常，
 * 此函数提供前置校验避免 try/catch。
 */
export function isValidAccelerator(accelerator: string): boolean {
  if (typeof accelerator !== 'string' || accelerator.trim().length === 0) return false
  // accelerator 至少包含一个修饰键或一个键名
  return /[a-zA-Z0-9]/.test(accelerator)
}
