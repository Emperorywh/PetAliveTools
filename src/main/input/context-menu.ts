/**
 * 右键上下文菜单 (§10 右键菜单)
 *
 * 自定义 HTML 菜单（#context-menu 渲染视图，无边框透明小窗口），
 * 替代原生 Menu.popup，两个入口共用同一控制器：
 *   - 宠物窗口右键：showContextMenu（照料三宫格 + 功能项，固定高度）
 *   - 托盘右键：showTrayMenu（追加宠物切换/导入导出/删除/退出，高度随内容）
 *
 * 菜单项在渲染进程绘制，选择结果经 input:menu-select 回传主进程执行回调；
 * 渲染视图挂载后经 input:menu-size 回报实际内容高度，控制器重设窗口尺寸
 * 并在光标锚定位置显示（ready-to-show 后短超时兜底，防渲染异常时无菜单）。
 *
 * 关闭时机：选择任一项、Esc（input:menu-close）、窗口失焦（点击别处）。
 *
 * 运行于主进程。
 */

import { ipcMain, screen, type BrowserWindow } from 'electron'
import {
  createContextMenuWindow,
  CONTEXT_MENU_WINDOW_WIDTH,
} from '../window'
import { clampMenuPosition } from '../../shared/spatial'
import type { TrayMenuCallbacks, TrayMenuState } from '../shell/profile-switcher'

/** 宠物右键菜单回调 */
export interface ContextMenuCallbacks {
  /** 喂食（触发 beg_food 讨食片段，D 类，饥饿↓） */
  onFeed: () => void
  /** 给玩具（触发 want_play 求玩片段，D 类，愉悦↑） */
  onToy: () => void
  /** 喂水（触发 drink 喝水片段，D 类；需求模型无口渴维度，轻度缓解饥饿） */
  onDrink: () => void
  /** 呼唤宠物（触发 called 被呼唤转身片段，B 类） */
  onCall: () => void
  /** 切换静音 (§11.2 全局静音开关) */
  onToggleMute: () => void
  /** 暂时隐藏（安全阀的另一入口，§10） */
  onHide: () => void
  /** 设置面板（TASK-015） */
  onSettings: () => void
  /** 关于 */
  onAbout: () => void
  /** 打开导入向导（§5.5，向活跃宠物目录导入片段） */
  onImportWizard: () => void
}

/** 渲染进程菜单动作标识 → 宠物菜单回调名 */
const PET_MENU_ACTIONS: Record<string, keyof ContextMenuCallbacks> = {
  feed: 'onFeed',
  toy: 'onToy',
  drink: 'onDrink',
  call: 'onCall',
  'toggle-mute': 'onToggleMute',
  import: 'onImportWizard',
  hide: 'onHide',
  settings: 'onSettings',
  about: 'onAbout',
}

/** 渲染视图就绪后尺寸回报未到达的显示兜底超时 (ms) */
const MENU_SHOW_FALLBACK_MS = 500

/** 当前打开的菜单会话（同一时刻至多一个） */
interface MenuSession {
  readonly win: BrowserWindow
  /** 锚点（打开时的光标屏幕坐标），尺寸变化后按它重新钳制定位 */
  readonly anchor: { x: number; y: number }
  /** 动作分发（宠物/托盘各自构建） */
  readonly onAction: (action: string) => void
  /** 窗口是否已显示（尺寸回报与兜底只生效一次） */
  shown: boolean
  fallbackTimer: ReturnType<typeof setTimeout> | null
}

let session: MenuSession | null = null
let ipcRegistered = false

/**
 * 注册菜单窗口 IPC（进程内仅一次，通道复用、会话随打开替换）。
 * 渲染进程侧桥接见 preload InputBridge.menuSelect/menuClose/menuSize。
 */
function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.on('input:menu-select', (_e, action: unknown) => {
    const current = session
    closeContextMenu()
    if (current && typeof action === 'string') current.onAction(action)
  })

  ipcMain.on('input:menu-close', () => closeContextMenu())

  ipcMain.on('input:menu-size', (_e, width: unknown, height: unknown) => {
    const current = session
    if (!current || current.shown || current.win.isDestroyed()) return
    if (typeof width !== 'number' || typeof height !== 'number') return
    const size = {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    }
    showSession(current, size)
  })
}

/** 以给定窗口尺寸定位并显示菜单会话（幂等：仅首次生效） */
function showSession(current: MenuSession, size: { width: number; height: number }): void {
  if (current.shown || current.win.isDestroyed()) return
  const workArea = screen.getDisplayNearestPoint(current.anchor).workArea
  // 高度不超过工作区：宠物数量极多时面板内部滚动
  const height = Math.min(size.height, workArea.height)
  const pos = clampMenuPosition({
    cursor: current.anchor,
    menuSize: { width: CONTEXT_MENU_WINDOW_WIDTH, height },
    workArea,
  })
  current.win.setBounds({ x: pos.x, y: pos.y, width: CONTEXT_MENU_WINDOW_WIDTH, height })
  current.shown = true
  if (current.fallbackTimer) {
    clearTimeout(current.fallbackTimer)
    current.fallbackTimer = null
  }
  // 需要焦点：Esc 关闭与失焦关闭都依赖窗口持有键盘焦点
  current.win.show()
  current.win.focus()
}

/** 关闭当前菜单窗口（未打开时为空操作） */
export function closeContextMenu(): void {
  if (session) {
    if (session.fallbackTimer) clearTimeout(session.fallbackTimer)
    if (!session.win.isDestroyed()) session.win.destroy()
    session = null
  }
}

/**
 * 打开菜单窗口的公共流程：建窗 → 预定位 → 等尺寸回报显示（带兜底）。
 *
 * @param hashQuery #context-menu 的查询参数（静态状态经 URL 注入）
 * @param onAction 菜单动作分发
 */
function openMenuWindow(hashQuery: string, onAction: (action: string) => void): void {
  ensureIpcRegistered()
  closeContextMenu()

  const win = createContextMenuWindow(hashQuery)
  const anchor = screen.getCursorScreenPoint()
  const current: MenuSession = { win, anchor, onAction, shown: false, fallbackTimer: null }
  session = current

  win.on('ready-to-show', () => {
    if (session !== current || current.win.isDestroyed()) return
    // 渲染脚本异常未回报尺寸时兜底显示（用初始占位尺寸）
    current.fallbackTimer = setTimeout(() => showSession(current, {
      width: CONTEXT_MENU_WINDOW_WIDTH,
      height: win.getBounds().height,
    }), MENU_SHOW_FALLBACK_MS)
  })
  // 点击菜单以外任意处（桌面/其他窗口/宠物本体）即关闭
  win.on('blur', () => {
    if (session === current) closeContextMenu()
  })
  win.on('closed', () => {
    if (session === current) {
      if (session.fallbackTimer) clearTimeout(session.fallbackTimer)
      session = null
    }
  })
}

/**
 * 在当前光标位置弹出宠物右键菜单 (§10)。
 *
 * @param _owner 宠物窗口（保留参数以兼容旧签名；定位只依赖全局光标）
 * @param callbacks 各菜单项回调
 * @param isMuted 当前是否已静音（决定菜单「静音/取消静音」标签）
 */
export function showContextMenu(
  _owner: BrowserWindow,
  callbacks: ContextMenuCallbacks,
  isMuted = false,
): void {
  openMenuWindow(`context-menu?muted=${isMuted ? 1 : 0}`, (action) => {
    const key = PET_MENU_ACTIONS[action]
    if (key) callbacks[key]()
  })
}

/**
 * 在当前光标位置弹出托盘菜单（§10、§12.2、§12.3）。
 *
 * 与宠物菜单同款玻璃拟态面板，追加宠物切换/导入导出/删除（两步确认在
 * 渲染层实现）与退出。状态按打开时快照生成，无需随状态变化重建。
 *
 * @param state 托盘菜单状态（宠物列表/活跃项/静音/可见性）
 * @param callbacks 菜单动作回调
 */
export function showTrayMenu(state: TrayMenuState, callbacks: TrayMenuCallbacks): void {
  const query = new URLSearchParams({
    mode: 'tray',
    muted: state.isMuted ? '1' : '0',
    visible: state.isPetVisible ? '1' : '0',
    active: state.activeProfileId ?? '',
    pets: JSON.stringify(state.profiles.map((p) => ({ id: p.id, name: p.name }))),
  })
  openMenuWindow(`context-menu?${query.toString()}`, (action) => {
    if (action.startsWith('switch:')) {
      callbacks.onSwitchProfile(action.slice('switch:'.length))
      return
    }
    if (action.startsWith('delete:')) {
      callbacks.onDeleteProfile(action.slice('delete:'.length))
      return
    }
    switch (action) {
      case 'feed':
        callbacks.onFeed()
        break
      case 'toy':
        callbacks.onToy()
        break
      case 'drink':
        callbacks.onDrink()
        break
      case 'call':
        callbacks.onCall()
        break
      case 'toggle-mute':
        callbacks.onToggleMute()
        break
      case 'hide':
        callbacks.onToggleHide()
        break
      case 'import':
        callbacks.onImportWizard()
        break
      case 'import-pet':
        callbacks.onImportProfile()
        break
      case 'export-pet':
        callbacks.onExportProfile()
        break
      case 'settings':
        callbacks.onSettings()
        break
      case 'about':
        callbacks.onAbout()
        break
      case 'quit':
        callbacks.onQuit()
        break
    }
  })
}
