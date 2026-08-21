/**
 * 右键/托盘菜单窗口控制器测试：自定义 HTML 菜单的主进程端编排。
 *
 * 验证：尺寸回报后定位显示（光标锚定）、选择动作 → 关闭窗口 → 执行回调、
 * Esc/失焦关闭不触发回调、托盘模式的宠物切换/删除/退出分发与状态注入。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

const ipcOnHandlers = new Map<string, (...args: unknown[]) => void>()

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, fn: (...args: unknown[]) => void) => {
      ipcOnHandlers.set(channel, fn)
    }),
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 800, y: 400 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
  },
}))

/** 模拟菜单窗口：记录事件监听、定位与销毁状态 */
function makeFakeWindow(): {
  win: BrowserWindow
  fire: (event: string) => void
  setBounds: ReturnType<typeof vi.fn>
} {
  const listeners = new Map<string, () => void>()
  let destroyed = false
  const setBounds = vi.fn()
  const win = {
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => {
      destroyed = true
      listeners.get('closed')?.()
    }),
    setBounds,
    getBounds: () => ({ x: 0, y: 0, width: 240, height: 376 }),
    show: vi.fn(),
    focus: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      listeners.set(event, cb)
    }),
  } as unknown as BrowserWindow
  return { win, fire: (event: string) => listeners.get(event)?.(), setBounds }
}

const fakeWindows: ReturnType<typeof makeFakeWindow>[] = []

vi.mock('../../src/main/window', () => ({
  createContextMenuWindow: vi.fn((hashQuery: string) => {
    const fake = makeFakeWindow()
    ;(fake.win as unknown as { __hash: string }).__hash = hashQuery
    fakeWindows.push(fake)
    return fake.win
  }),
  CONTEXT_MENU_WINDOW_WIDTH: 240,
  CONTEXT_MENU_WINDOW_PROVISIONAL_HEIGHT: 376,
}))

import {
  showContextMenu,
  showTrayMenu,
  closeContextMenu,
  type ContextMenuCallbacks,
} from '../../src/main/input/context-menu'
import type { TrayMenuCallbacks, TrayMenuState } from '../../src/main/shell/profile-switcher'
import type { ProfileSummary } from '../../src/main/persistence/profiles'

function makeCallbacks(): ContextMenuCallbacks {
  return {
    onFeed: vi.fn(),
    onToy: vi.fn(),
    onDrink: vi.fn(),
    onCall: vi.fn(),
    onToggleMute: vi.fn(),
    onHide: vi.fn(),
    onSettings: vi.fn(),
    onAbout: vi.fn(),
    onImportWizard: vi.fn(),
  }
}

function pet(id: string, name: string): ProfileSummary {
  return { id, name, dir: `/pets/${id}`, valid: true }
}

function makeTrayCallbacks(): TrayMenuCallbacks {
  return {
    onFeed: vi.fn(),
    onToy: vi.fn(),
    onDrink: vi.fn(),
    onCall: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleHide: vi.fn(),
    onSettings: vi.fn(),
    onAbout: vi.fn(),
    onQuit: vi.fn(),
    onSwitchProfile: vi.fn(),
    onImportProfile: vi.fn(),
    onExportProfile: vi.fn(),
    onDeleteProfile: vi.fn(),
    onImportWizard: vi.fn(),
    onOpenMenu: vi.fn(),
  }
}

/** 模拟渲染视图挂载后的尺寸回报（触发定位+显示） */
function reportSize(width = 240, height = 344): void {
  ipcOnHandlers.get('input:menu-size')!({} as unknown, width, height)
}

describe('菜单窗口控制器（共用流程）', () => {
  beforeEach(() => {
    closeContextMenu()
    fakeWindows.length = 0
    // 注意：IPC 处理器进程内只注册一次（ipcRegistered 守卫），
    // 不清空 ipcOnHandlers 以匹配真实运行时语义
  })

  it('尺寸回报后按光标锚定位、重设窗口尺寸并显示聚焦', () => {
    showContextMenu(makeFakeWindow().win, makeCallbacks())
    const menu = fakeWindows[fakeWindows.length - 1]!
    menu.fire('ready-to-show')
    reportSize(240, 344)

    expect(menu.setBounds).toHaveBeenCalledWith({ x: 800, y: 400, width: 240, height: 344 })
    expect(menu.win.show).toHaveBeenCalledTimes(1)
    expect(menu.win.focus).toHaveBeenCalledTimes(1)
  })

  it('重复尺寸回报只显示一次', () => {
    showContextMenu(makeFakeWindow().win, makeCallbacks())
    const menu = fakeWindows[fakeWindows.length - 1]!
    menu.fire('ready-to-show')
    reportSize(240, 344)
    reportSize(240, 500)

    expect(menu.win.show).toHaveBeenCalledTimes(1)
    expect(menu.setBounds).toHaveBeenCalledTimes(1)
  })

  it('选择喝水 → 先关窗再执行 onDrink 回调', () => {
    const callbacks = makeCallbacks()
    showContextMenu(makeFakeWindow().win, callbacks)
    const menu = fakeWindows[fakeWindows.length - 1]!
    menu.fire('ready-to-show')
    reportSize()

    ipcOnHandlers.get('input:menu-select')!({} as unknown, 'drink')

    expect(callbacks.onDrink).toHaveBeenCalledTimes(1)
    expect(menu.win.destroy).toHaveBeenCalled()
  })

  it('失焦（点击菜单外）→ 关闭且不执行任何动作回调', () => {
    const callbacks = makeCallbacks()
    showContextMenu(makeFakeWindow().win, callbacks)
    fakeWindows[fakeWindows.length - 1]!.fire('blur')

    expect(fakeWindows[fakeWindows.length - 1]!.win.destroy).toHaveBeenCalled()
    for (const cb of Object.values(callbacks)) {
      expect(cb).not.toHaveBeenCalled()
    }
  })

  it('Esc（input:menu-close）→ 关闭且不执行回调', () => {
    const callbacks = makeCallbacks()
    showContextMenu(makeFakeWindow().win, callbacks)

    ipcOnHandlers.get('input:menu-close')!({} as unknown)

    expect(fakeWindows[fakeWindows.length - 1]!.win.destroy).toHaveBeenCalled()
    expect(callbacks.onFeed).not.toHaveBeenCalled()
  })

  it('未知动作 → 安全忽略（关窗但不抛错）', () => {
    const callbacks = makeCallbacks()
    showContextMenu(makeFakeWindow().win, callbacks)

    expect(() => ipcOnHandlers.get('input:menu-select')!({} as unknown, 'nope')).not.toThrow()
    expect(callbacks.onFeed).not.toHaveBeenCalled()
  })

  it('菜单已打开时再次打开 → 旧窗口销毁重建（刷新位置与标签）', () => {
    showContextMenu(makeFakeWindow().win, makeCallbacks())
    const first = fakeWindows[0]!
    showContextMenu(makeFakeWindow().win, makeCallbacks())

    expect(first.win.destroy).toHaveBeenCalled()
    expect(fakeWindows.length).toBe(2)
  })
})

describe('托盘菜单（showTrayMenu）', () => {
  beforeEach(() => {
    closeContextMenu()
    fakeWindows.length = 0
  })

  function trayState(): TrayMenuState {
    return {
      profiles: [pet('cat', '小喵'), pet('dog', '小汪')],
      activeProfileId: 'cat',
      isMuted: true,
      isPetVisible: false,
    }
  }

  it('状态经 hash 查询注入（mode/muted/visible/active/pets）', () => {
    showTrayMenu(trayState(), makeTrayCallbacks())
    const fake = fakeWindows[fakeWindows.length - 1]!
    const hash = (fake.win as unknown as { __hash: string }).__hash
    expect(hash).toContain('context-menu?')
    expect(hash).toContain('mode=tray')
    expect(hash).toContain('muted=1')
    expect(hash).toContain('visible=0')
    expect(hash).toContain('active=cat')
    expect(decodeURIComponent(hash)).toContain('"id":"dog"')
  })

  it('选择 switch:<id> → onSwitchProfile(id)', () => {
    const callbacks = makeTrayCallbacks()
    showTrayMenu(trayState(), callbacks)

    ipcOnHandlers.get('input:menu-select')!({} as unknown, 'switch:dog')

    expect(callbacks.onSwitchProfile).toHaveBeenCalledWith('dog')
  })

  it('选择 delete:<id> → onDeleteProfile(id)', () => {
    const callbacks = makeTrayCallbacks()
    showTrayMenu(trayState(), callbacks)

    ipcOnHandlers.get('input:menu-select')!({} as unknown, 'delete:cat')

    expect(callbacks.onDeleteProfile).toHaveBeenCalledWith('cat')
  })

  it('托盘动作分发：hide→onToggleHide、export-pet/import-pet/quit', () => {
    const callbacks = makeTrayCallbacks()
    // 选择任一项后菜单即关闭，每个动作从新会话触发
    const cases: Array<[string, () => void]> = [
      ['hide', callbacks.onToggleHide],
      ['export-pet', callbacks.onExportProfile],
      ['import-pet', callbacks.onImportProfile],
      ['quit', callbacks.onQuit],
    ]
    for (const [action, callback] of cases) {
      showTrayMenu(trayState(), callbacks)
      ipcOnHandlers.get('input:menu-select')!({} as unknown, action)
      expect(callback).toHaveBeenCalledTimes(1)
    }
  })
})
