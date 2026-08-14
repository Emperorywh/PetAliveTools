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
      sandbox: true
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
    },
  })
  loadToolView(win, 'settings')
  return win
}
