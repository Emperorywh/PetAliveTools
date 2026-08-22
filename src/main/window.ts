/**
 * 宠物窗口与普通工具窗口管理。
 *
 * 已删除抠像预览和行走校正工具窗口；主窗口只直接播放导入片段。
 */

import { BrowserWindow } from 'electron'
import { join } from 'path'

/** 窗口默认尺寸（固定，不随片段 resize，§6.1 窗口尺寸策略） */
const WINDOW_WIDTH = 400
const WINDOW_HEIGHT = 400

/**
 * 创建宠物主窗口。
 *
 * 窗口属性（§6.1）：
 * - transparent: true     透明背景，承载用户直接导入的视频
 * - frame: false          无边框无标题栏
 * - alwaysOnTop: true     始终置顶（§10 决策）
 * - resizable: false      固定尺寸
 * - skipTaskbar: true     不在任务栏显示
 */
export function createPetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      // 应用无文本编辑场景；关闭内置拼写检查可避免 Chromium 后台
      // 从 gvt1.com 下载词典（该域名在部分网络握手失败，反复输出 SSL 错误日志）
      spellcheck: false
    }
  })

  // 默认可穿透点击：点击落到桌面（§6.1）
  win.setIgnoreMouseEvents(true, { forward: true })

  win.on('ready-to-show', () => {
    win.show()
  })

  // Dev server (electron-vite dev) or production build
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/**
 * 设置窗口的鼠标穿透/交互模式（§6.1）。
 *
 * - interactive = false（默认）：click-through，鼠标事件转发到桌面
 *   → setIgnoreMouseEvents(true, { forward: true })
 * - interactive = true：可交互，接收鼠标事件
 *   → setIgnoreMouseEvents(false)
 *
 * 命中盒缓冲带的实际判定由 TASK-012 实现；本函数提供底层 toggle API。
 */
export function setInteractive(win: BrowserWindow, interactive: boolean): void {
  if (interactive) {
    win.setIgnoreMouseEvents(false)
  } else {
    win.setIgnoreMouseEvents(true, { forward: true })
  }
}

/**
 * 移动宠物窗口到指定位置，并把尺寸钉回固定逻辑值。
 *
 * Windows 分数缩放（如 125%）下，透明无边框窗口每调一次 setPosition，
 * 尺寸都会被 DIP↔物理像素往返舍入撑大约 1 DIP（Electron 平台层缺陷）。
 * 拖拽按 mousemove、行走按 60fps 持续调用，误差不断累积，
 * 视频（100% 填充窗口）看起来就会"不断放大"。
 *
 * 这里改用 setBounds 显式携带固定尺寸（实测不再累积，残余 ≤1 DIP 舍入抖动），
 * 并在位置与尺寸都已正确时跳过调用：长按不动等场景下零窗口消息 churn，
 * 也能把已被撑大的窗口自愈回固定尺寸。
 */
export function setPetWindowPosition(win: BrowserWindow, x: number, y: number): void {
  const tx = Math.round(x)
  const ty = Math.round(y)
  const bounds = win.getBounds()
  if (
    bounds.x === tx &&
    bounds.y === ty &&
    bounds.width === WINDOW_WIDTH &&
    bounds.height === WINDOW_HEIGHT
  ) {
    return
  }
  win.setBounds({ x: tx, y: ty, width: WINDOW_WIDTH, height: WINDOW_HEIGHT })
}

/** 按视图名加载工具窗口 URL（dev server 或生产构建文件） */
function loadToolView(win: BrowserWindow, view: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${view}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: view })
  }
}

/**
 * 创建原样片段导入窗口。
 *
 * 窗口只展示动作清单和文件选择按钮，不加载视频预览或处理参数。
 */
export function createImportWizardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: '直接导入视频片段（PetAliveTools）',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      spellcheck: false
    },
  })
  loadToolView(win, 'import-wizard')
  return win
}

/**
 * 创建设置面板窗口（§12.4）。
 *
 * 承载 #settings 渲染视图：显示器选择、尺度、音量、节律频率、
 * 性格 5 维滑杆、开机自启开关、快捷键配置。
 */
export function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 480,
    minHeight: 600,
    title: '设置（PetAliveTools）',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      spellcheck: false
    },
  })
  loadToolView(win, 'settings')
  return win
}

/** 右键菜单窗口宽度 (DIP)：菜单面板 208 + 四周 16px 透明边距（容纳投影） */
export const CONTEXT_MENU_WINDOW_WIDTH = 240
/**
 * 菜单窗口初始高度 (DIP)：仅为占位，窗口隐藏；
 * 渲染视图挂载后回报实际内容高度，控制器按回报值重设尺寸再显示
 * （宠物菜单固定矮、托盘菜单随宠物数量变化）
 */
export const CONTEXT_MENU_WINDOW_PROVISIONAL_HEIGHT = 376

/**
 * 创建右键上下文菜单窗口（§10，自定义 HTML 菜单）。
 *
 * - 透明无边框小窗口，承载 #context-menu 渲染视图（照料动作 + 功能项）
 * - 面板四周留 16px 透明边距给 CSS 投影，窗口本体不可缩放
 * - 置顶层级高于宠物窗口（screen-saver），失焦由 context-menu 控制器关闭
 *
 * @param hashQuery hash 查询参数（不含 #，如 `context-menu?muted=1` 或托盘模式
 *   `context-menu?mode=tray&...`），静态状态经 URL 注入、打开时定型
 */
export function createContextMenuWindow(hashQuery: string): BrowserWindow {
  const win = new BrowserWindow({
    width: CONTEXT_MENU_WINDOW_WIDTH,
    height: CONTEXT_MENU_WINDOW_PROVISIONAL_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      spellcheck: false
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  loadToolView(win, hashQuery)
  return win
}
