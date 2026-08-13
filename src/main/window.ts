/**
 * 宠物窗口管理 (transparent, frameless, always-on-top)
 *
 * 创建透明置顶无框窗口（§6.1），默认 click-through，
 * 并提供切换为可交互模式的 toggle 机制（§6.1）。
 *
 * 运行于主进程。
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
 * - transparent: true     透明背景，承载带 alpha 的 WebM
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

/**
 * 创建色键抠像预览工具窗口（§5.5 手动验证入口）。
 *
 * 与宠物窗口不同：普通带边框窗口、不透明、可交互，承载
 * #chroma-preview 渲染视图（控件面板 + 抠像预览 + 边缘放大）。
 * 由主进程在 PETALIVE_VIEW=chroma-preview 时创建。
 */
export function createChromaPreviewWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: '色键抠像预览（PetAliveTools）',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  loadToolView(win, 'chroma-preview')
  return win
}

/**
 * 创建行走跟踪裁切 + 位移曲线校正工具窗口（§5.3 手动验证入口）。
 *
 * 承载 #walk-correction 渲染视图（跟踪裁切片段回放 + 位移曲线
 * 手动校正 + 行走子段标注）。由主进程在 PETALIVE_VIEW=walk-correction 时创建。
 */
export function createWalkCorrectionWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 900,
    title: '行走跟踪与位移曲线校正（PetAliveTools）',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  loadToolView(win, 'walk-correction')
  return win
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
 * 创建清单引导式导入向导窗口（§5.5）。
 *
 * 承载 #import-wizard 渲染视图：清单展示 + 分步导入流程（选视频→
 * 背景参考色→抠像预览→裁剪/标 loop→行走跟踪校正→填标签→转码入库）。
 * 由主进程在 PETALIVE_VIEW=import-wizard 时创建。
 */
export function createImportWizardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: '清单引导式导入（PetAliveTools）',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  })
  loadToolView(win, 'import-wizard')
  return win
}
