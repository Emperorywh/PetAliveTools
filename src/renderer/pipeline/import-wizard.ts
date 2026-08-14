/**
 * 清单引导式导入向导 (§5.5)
 *
 * 导入向导的顶层编排：项目选择 → 清单展示 → 分步导入流程。
 *
 * 分步流程（§5.5）：
 *   选视频 → 圈选背景参考色 → 抠像预览（边缘放大检查）→
 *   裁剪/标 loop → [行走跟踪校正（行走类）] → 填标签 → 转码入库
 *
 * 各步骤的预览组件复用 TASK-005（ChromaKeyPreview）与 TASK-006
 * （WalkCorrectionView）；转码与文件保存通过 preload IPC 桥接
 * 主进程（TASK-007 ffmpeg + 项目 I/O）。
 *
 * 运行于渲染进程。手动验证入口：PETALIVE_VIEW=import-wizard npm run dev。
 */

import type { ClipMeta } from '../../shared/types/clip-meta'
import type { ProjectData } from '../../shared/types/project'
import type { RgbColor, RawFrame } from '../../shared/pipeline/frame'
import type { ShootingListItem } from '../../shared/pipeline/shooting-list'
import { applyChromaKey, buildWalkTrack, type KeyedFrame } from '../../shared/pipeline'
import {
  type ImportFlowState,
  createImportFlow,
  updateData,
  advance,
  retreat,
  isLastStep,
  currentStepIndex,
  validateStep,
  getStepInfo,
  buildClipMeta,
  buildTranscodeRequest,
} from '../../shared/pipeline/import-flow'
import {
  buildChecklist,
  nextVariantNumber,
  type ChecklistStatus,
} from '../../shared/pipeline/checklist'
import { ChecklistView } from './checklist-view'
import {
  type ChromaKeyPreviewState,
  ChromaKeyPreview,
} from './chroma-key-preview'
import {
  type WalkCorrectionState,
  WalkCorrectionView,
} from './walk-correction'

// ── 配色 ── //
const COLOR_BG = '#1e2128'
const COLOR_PANEL = '#272b34'
const COLOR_PANEL_BORDER = '#363b46'
const COLOR_TEXT = '#dfe2e8'
const COLOR_TEXT_DIM = '#8b909c'
const COLOR_ACCENT = '#7ec8ff'
const COLOR_STARTUP = '#ffd166'
const COLOR_MISSING = '#ff4d6d'
const COLOR_BTN = '#363b46'
const COLOR_BTN_HOVER = '#444a57'
const COLOR_BTN_PRIMARY = '#3b82f6'

/**
 * 导入向导。
 *
 * 管理：项目目录选择/创建、清单状态展示、当前导入流程状态、
 * 分步 UI 渲染、IPC 调用（选视频/转码/保存）。
 */
export class ImportWizard {
  private readonly container: HTMLElement
  private projectDir: string | null = null
  private projectData: ProjectData | null = null
  private checklistStatus: ChecklistStatus | null = null
  private checklistView: ChecklistView | null = null
  private flowState: ImportFlowState | null = null
  private chromaPreview: ChromaKeyPreview | null = null
  private walkCorrection: WalkCorrectionView | null = null
  private referenceFrame: RawFrame | null = null
  private statusMsg: string = ''
  /** 是否已尝试自动加载默认项目（避免「切换项目」后被再次覆盖） */
  private defaultLoadTried = false

  constructor(container: HTMLElement) {
    this.container = container
    this.injectStyles()
  }

  /** 初始渲染：项目选择界面 */
  render(): void {
    if (!this.projectDir) {
      this.renderProjectSelector()
      void this.tryLoadDefaultProject()
    } else if (!this.flowState) {
      this.renderChecklist()
    } else {
      this.renderImportFlow()
    }
  }

  dispose(): void {
    this.chromaPreview?.dispose()
    this.walkCorrection?.dispose()
    this.container.innerHTML = ''
  }

  // ════════════════════════════════════════════════════════════ //
  //  项目选择                                                    //
  // ════════════════════════════════════════════════════════════ //

  private renderProjectSelector(): void {
    this.container.innerHTML = ''
    const root = div('wizard-project-select')
    root.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:20px;color:${COLOR_TEXT}`

    const title = el('h1', 'wizard-project-title')
    title.style.cssText = 'font-size:22px;font-weight:600;margin:0'
    title.textContent = '清单引导式导入'
    root.appendChild(title)

    const desc = el('p', 'wizard-project-desc')
    desc.style.cssText = `font-size:13px;color:${COLOR_TEXT_DIM};text-align:center;max-width:400px;line-height:1.6`
    desc.textContent = '选择已有 Pet 项目目录或创建新项目，开始导入片段。导入流程：选视频 → 背景参考色 → 抠像预览 → 裁剪/标 loop → 行走跟踪校正（行走类）→ 填标签 → 转码入库。'
    root.appendChild(desc)

    const btnRow = div('wizard-project-buttons')
    btnRow.style.cssText = 'display:flex;gap:12px'

    const btnOpen = makeButton('选择已有项目', async () => {
      const dir = await window.petalive.import.selectProject()
      if (dir) {
        await this.loadProjectDir(dir)
      }
    })
    styleButton(btnOpen, COLOR_BTN, COLOR_BTN_HOVER)
    btnRow.appendChild(btnOpen)

    const btnCreate = makeButton('创建新项目', async () => {
      const parentDir = await window.petalive.import.selectProject()
      if (!parentDir) return
      const petName = window.prompt('输入宠物名称（用作项目目录名）：')
      if (!petName) return
      try {
        const dir = await window.petalive.import.createProject(parentDir, petName)
        await this.loadProjectDir(dir)
      } catch (err) {
        this.showError(`创建项目失败：${(err as Error).message}`)
      }
    })
    styleButton(btnCreate, COLOR_BTN_PRIMARY)
    btnRow.appendChild(btnCreate)

    root.appendChild(btnRow)
    this.container.appendChild(root)
  }

  private async loadProjectDir(dir: string): Promise<void> {
    try {
      this.projectDir = dir
      this.projectData = await window.petalive.import.loadProject(dir)
      this.refreshChecklist()
      this.render()
    } catch (err) {
      this.showError(`加载项目失败：${(err as Error).message}`)
      this.projectDir = null
    }
  }

  /**
   * 自动加载默认（活跃宠物）项目目录 (§12.2)。
   *
   * 从托盘/右键菜单打开向导时优先加载活跃宠物目录，导入即被运行中的
   * 宠物使用；每个向导实例只尝试一次，「切换项目」后不再覆盖。
   */
  private async tryLoadDefaultProject(): Promise<void> {
    if (this.defaultLoadTried) return
    this.defaultLoadTried = true
    try {
      const dir = await window.petalive.import.getDefaultProjectDir()
      if (dir && !this.projectDir) {
        await this.loadProjectDir(dir)
      }
    } catch {
      /* 无默认目录或加载失败时停留在项目选择界面 */
    }
  }

  private refreshChecklist(): void {
    if (!this.projectData) return
    this.checklistStatus = buildChecklist(this.projectData.clips)
  }

  // ════════════════════════════════════════════════════════════ //
  //  清单展示                                                    //
  // ════════════════════════════════════════════════════════════ //

  private renderChecklist(): void {
    this.container.innerHTML = ''
    this.refreshChecklist()

    const layout = div('wizard-checklist-layout')
    layout.style.cssText = `display:flex;height:100%;color:${COLOR_TEXT}`

    // 左侧清单
    const leftPanel = div('wizard-checklist-left')
    leftPanel.style.cssText = `flex:1;overflow-y:auto;padding:20px;background:${COLOR_BG}`
    this.checklistView = new ChecklistView(leftPanel, (item) => this.startImport(item))
    if (this.checklistStatus) {
      this.checklistView.update(this.checklistStatus)
    }
    layout.appendChild(leftPanel)

    // 右侧状态面板
    const rightPanel = div('wizard-checklist-right')
    rightPanel.style.cssText = `width:240px;flex-shrink:0;padding:20px;background:${COLOR_PANEL};border-left:1px solid ${COLOR_PANEL_BORDER}`
    this.renderStatusPanel(rightPanel)
    layout.appendChild(rightPanel)

    this.container.appendChild(layout)
  }

  private renderStatusPanel(panel: HTMLElement): void {
    panel.innerHTML = ''

    const title = el('div', 'wizard-status-title')
    title.style.cssText = `font-size:14px;font-weight:600;margin-bottom:12px;color:${COLOR_TEXT}`
    title.textContent = '导入状态'
    panel.appendChild(title)

    if (!this.checklistStatus) return

    // 启动集完成度
    const ss = this.checklistStatus.startupSet
    const startupBox = div('wizard-startup-status')
    startupBox.style.cssText = `padding:10px;background:${COLOR_BG};border-radius:6px;margin-bottom:10px`
    const startupLabel = el('div', '')
    startupLabel.style.cssText = `font-size:12px;color:${ss.complete ? COLOR_STARTUP : COLOR_TEXT_DIM}`
    startupLabel.textContent = ss.complete
      ? `★ 启动集已完成 ${ss.satisfiedCount}/${ss.totalCount}`
      : `★ 启动集 ${ss.satisfiedCount}/${ss.totalCount}`
    startupBox.appendChild(startupLabel)

    if (ss.missingStates.length > 0) {
      const missing = el('div', '')
      missing.style.cssText = `font-size:11px;color:${COLOR_MISSING};margin-top:6px`
      missing.textContent = `缺失: ${ss.missingStates.join(', ')}`
      startupBox.appendChild(missing)
    }
    panel.appendChild(startupBox)

    // 缺失状态列表
    if (this.checklistStatus.allMissingStates.length > 0) {
      const missingTitle = el('div', '')
      missingTitle.style.cssText = `font-size:12px;font-weight:600;margin-top:12px;margin-bottom:6px;color:${COLOR_MISSING}`
      missingTitle.textContent = '需补拍的状态'
      panel.appendChild(missingTitle)

      for (const state of this.checklistStatus.allMissingStates) {
        const item = el('div', '')
        item.style.cssText = `font-size:11px;color:${COLOR_TEXT_DIM};padding:2px 0`
        item.textContent = `• ${state}`
        panel.appendChild(item)
      }
    }

    // 片段总数
    const countBox = div('wizard-clip-count')
    countBox.style.cssText = `margin-top:auto;padding-top:12px;font-size:12px;color:${COLOR_TEXT_DIM}`
    const total = this.projectData?.clips.filter((c) => !c.id.startsWith('__placeholder_')).length ?? 0
    countBox.textContent = `已入库片段：${total}`
    panel.appendChild(countBox)

    // 切换项目按钮
    const btnSwitch = makeButton('切换项目', () => {
      this.projectDir = null
      this.projectData = null
      this.checklistStatus = null
      this.flowState = null
      this.render()
    })
    styleButton(btnSwitch, COLOR_BTN, COLOR_BTN_HOVER)
    btnSwitch.style.cssText += ';margin-top:12px;width:100%'
    panel.appendChild(btnSwitch)
  }

  // ════════════════════════════════════════════════════════════ //
  //  导入流程                                                    //
  // ════════════════════════════════════════════════════════════ //

  /** 开始某个状态的导入流程 */
  private startImport(item: ShootingListItem): void {
    if (!this.projectData) return
    const variant = nextVariantNumber(item.state, this.projectData.clips)
    this.flowState = createImportFlow(item, variant)
    this.referenceFrame = null
    this.statusMsg = ''
    this.render()
  }

  /** 退出导入流程，回到清单 */
  private exitImport(): void {
    this.chromaPreview?.dispose()
    this.chromaPreview = null
    this.walkCorrection?.dispose()
    this.walkCorrection = null
    this.referenceFrame = null
    this.flowState = null
    this.statusMsg = ''
    this.render()
  }

  private renderImportFlow(): void {
    if (!this.flowState) return
    this.container.innerHTML = ''

    const layout = div('wizard-flow-layout')
    layout.style.cssText = `display:flex;flex-direction:column;height:100%;color:${COLOR_TEXT};background:${COLOR_BG}`

    // 步骤导航条
    layout.appendChild(this.renderStepNav())

    // 内容区
    const content = div('wizard-flow-content')
    content.style.cssText = 'flex:1;overflow-y:auto;padding:20px'
    this.renderStepContent(content)
    layout.appendChild(content)

    // 底部按钮栏
    layout.appendChild(this.renderFooter())

    this.container.appendChild(layout)
  }

  /** 步骤导航条 */
  private renderStepNav(): HTMLElement {
    const nav = div('wizard-step-nav')
    nav.style.cssText = `display:flex;align-items:center;padding:12px 20px;background:${COLOR_PANEL};border-bottom:1px solid ${COLOR_PANEL_BORDER};gap:4px;flex-wrap:wrap`

    const stateLabel = el('span', '')
    stateLabel.style.cssText = `font-weight:600;margin-right:16px;color:${COLOR_ACCENT}`
    stateLabel.textContent = this.flowState!.targetItem.label
    nav.appendChild(stateLabel)

    const steps = this.flowState!.steps
    const currentIdx = currentStepIndex(this.flowState!)
    for (let i = 0; i < steps.length; i++) {
      const info = getStepInfo(steps[i])
      const chip = el('span', 'wizard-step-chip')
      const isActive = i === currentIdx
      const isDone = i < currentIdx
      const color = isActive ? COLOR_ACCENT : isDone ? '#5eba7d' : COLOR_TEXT_DIM
      chip.style.cssText = `padding:2px 8px;border-radius:3px;font-size:11px;color:${color};border:1px solid ${color}40;${isActive ? `background:${color}20` : ''}`
      chip.textContent = `${i + 1}. ${info.label}`
      nav.appendChild(chip)
      if (i < steps.length - 1) {
        const sep = el('span', '')
        sep.style.cssText = `color:${COLOR_TEXT_DIM};font-size:10px`
        sep.textContent = '→'
        nav.appendChild(sep)
      }
    }

    // 退出按钮
    const exitBtn = makeButton('✕ 退出', () => this.exitImport())
    exitBtn.style.cssText = `margin-left:auto;padding:4px 10px;border-radius:4px;background:transparent;border:1px solid ${COLOR_PANEL_BORDER};color:${COLOR_TEXT_DIM};font-size:12px;cursor:pointer`
    nav.appendChild(exitBtn)

    return nav
  }

  /** 按当前步骤渲染内容 */
  private renderStepContent(content: HTMLElement): void {
    if (!this.flowState) return
    const { step } = this.flowState
    const info = getStepInfo(step)

    // 步骤标题
    const title = el('h2', 'wizard-step-title')
    title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 4px 0'
    title.textContent = info.label
    content.appendChild(title)

    const desc = el('p', 'wizard-step-desc')
    desc.style.cssText = `font-size:12px;color:${COLOR_TEXT_DIM};margin:0 0 16px 0`
    desc.textContent = info.description
    content.appendChild(desc)

    switch (step) {
      case 'select-video':
        this.renderSelectVideoStep(content)
        break
      case 'background-reference':
        this.renderBackgroundRefStep(content)
        break
      case 'keying-preview':
        this.renderKeyingPreviewStep(content)
        break
      case 'crop-loop':
        this.renderCropLoopStep(content)
        break
      case 'walk-tracking':
        this.renderWalkTrackingStep(content)
        break
      case 'metadata':
        this.renderMetadataStep(content)
        break
      case 'transcode-save':
        this.renderTranscodeSaveStep(content)
        break
    }

    // 状态消息
    if (this.statusMsg) {
      const msg = el('div', 'wizard-status-msg')
      msg.style.cssText = `margin-top:12px;padding:8px 12px;border-radius:4px;font-size:12px;background:${COLOR_MISSING}20;color:${COLOR_MISSING}`
      msg.textContent = this.statusMsg
      content.appendChild(msg)
    }
  }

  // ── 步骤 1：选择视频 ── //

  private renderSelectVideoStep(content: HTMLElement): void {
    const data = this.flowState!.data
    const card = makeCard()

    if (data.videoPath) {
      const pathLabel = el('div', '')
      pathLabel.style.cssText = `font-size:13px;color:${COLOR_TEXT};word-break:break-all;margin-bottom:8px`
      pathLabel.textContent = `已选择: ${data.videoPath}`
      card.appendChild(pathLabel)

      const dimLabel = el('div', '')
      dimLabel.style.cssText = `font-size:12px;color:${COLOR_TEXT_DIM}`
      dimLabel.textContent = `尺寸: ${data.videoWidth}×${data.videoHeight}，时长: ${data.videoDurationSec.toFixed(1)}s`
      card.appendChild(dimLabel)

      // 视频预览
      const video = document.createElement('video')
      video.style.cssText = 'max-width:480px;max-height:240px;margin-top:8px;border-radius:4px'
      video.src = `file:///${data.videoPath.replace(/\\/g, '/')}`
      video.controls = true
      card.appendChild(video)
    }

    const btn = makeButton('选择视频文件', async () => {
      const path = await window.petalive.import.selectVideo()
      if (!path) return
      // 通过 video 元素读取尺寸
      const dims = await this.readVideoInfo(path)
      this.flowState = updateData(this.flowState!, {
        videoPath: path,
        videoWidth: dims.width,
        videoHeight: dims.height,
        videoDurationSec: dims.duration,
      })
      this.statusMsg = ''
      this.render()
    })
    styleButton(btn, COLOR_BTN_PRIMARY)
    card.appendChild(btn)

    content.appendChild(card)
  }

  /** 通过隐藏 video 元素读取视频尺寸与时长 */
  private readVideoInfo(path: string): Promise<{ width: number; height: number; duration: number }> {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        resolve({
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration || 0,
        })
      }
      video.onerror = () => resolve({ width: 0, height: 0, duration: 0 })
      video.src = `file:///${path.replace(/\\/g, '/')}`
    })
  }

  // ── 步骤 2：背景参考色 / 参考帧 (§5.5 圈选背景参考色/帧) ── //

  private renderBackgroundRefStep(content: HTMLElement): void {
    const data = this.flowState!.data
    const card = makeCard()

    const hint = el('p', '')
    hint.style.cssText = `font-size:12px;color:${COLOR_TEXT_DIM};margin:0 0 12px 0;line-height:1.5`
    hint.textContent = '点击预览画面取参考色，或手动输入 RGB；也可滑动时间轴至空背景帧并设为参考帧，用于帧差辅助抠像（§5.1）。'
    card.appendChild(hint)

    // 视频帧取色画布
    if (data.videoPath) {
      const canvas = document.createElement('canvas')
      canvas.width = 480
      canvas.height = 270
      canvas.style.cssText = 'border-radius:4px;cursor:crosshair;background:#000;display:block'
      card.appendChild(canvas)

      // 帧位置滑块
      const seekRow = div('wizard-bg-seek')
      seekRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px'
      const seekLabel = el('label', '')
      seekLabel.style.cssText = `font-size:12px;color:${COLOR_TEXT_DIM}`
      seekLabel.textContent = '帧位置'
      seekRow.appendChild(seekLabel)
      const seekInput = document.createElement('input')
      seekInput.type = 'range'
      seekInput.min = '0'
      seekInput.max = String(data.videoDurationSec || 0)
      seekInput.step = '0.1'
      seekInput.value = '0.1'
      seekInput.style.flex = '1'
      const seekVal = el('span', '')
      seekVal.style.cssText = `font-size:12px;color:${COLOR_TEXT};min-width:40px;text-align:right`
      seekVal.textContent = '0.1s'
      seekRow.appendChild(seekInput)
      seekRow.appendChild(seekVal)
      card.appendChild(seekRow)

      let currentSeekTime = 0.1

      // 初始绘制首帧
      this.drawVideoFrameAt(canvas, data.videoPath, currentSeekTime)

      // 点击取色（从画布像素读取）
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect()
        const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width))
        const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height))
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const pixel = ctx.getImageData(x, y, 1, 1).data
        const color: RgbColor = { r: pixel[0], g: pixel[1], b: pixel[2] }
        this.flowState = updateData(this.flowState!, { referenceColor: color })
        this.statusMsg = ''
        this.render()
      })

      // 拖动滑块 → 重绘对应帧
      seekInput.addEventListener('input', () => {
        currentSeekTime = parseFloat(seekInput.value)
        seekVal.textContent = `${currentSeekTime.toFixed(1)}s`
        this.drawVideoFrameAt(canvas, data.videoPath!, currentSeekTime)
      })

      // 参考帧操作按钮行
      const refBtnRow = div('wizard-bg-ref-btns')
      refBtnRow.style.cssText = 'margin-top:8px;display:flex;gap:8px'

      const refBtn = makeButton('将当前帧设为参考帧', async () => {
        const frame = await this.extractVideoFrameAt(data.videoPath!, currentSeekTime)
        if (frame) {
          this.referenceFrame = {
            width: frame.width,
            height: frame.height,
            data: frame.data,
          }
          this.statusMsg = ''
          this.render()
        }
      })
      styleButton(refBtn, COLOR_BTN, COLOR_BTN_HOVER)
      refBtnRow.appendChild(refBtn)

      if (this.referenceFrame) {
        const clearBtn = makeButton('清除参考帧', () => {
          this.referenceFrame = null
          this.render()
        })
        clearBtn.style.cssText = `padding:8px 16px;border-radius:6px;border:1px solid ${COLOR_MISSING};background:transparent;color:${COLOR_MISSING};font-size:13px;cursor:pointer`
        refBtnRow.appendChild(clearBtn)
      }
      card.appendChild(refBtnRow)
    }

    // 当前参考色显示
    if (data.referenceColor) {
      const c = data.referenceColor
      const colorBox = div('wizard-ref-color')
      colorBox.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:12px'
      const swatch = div('wizard-ref-swatch')
      swatch.style.cssText = `width:32px;height:32px;border-radius:4px;border:1px solid ${COLOR_PANEL_BORDER};background:rgb(${c.r},${c.g},${c.b})`
      colorBox.appendChild(swatch)
      const label = el('span', '')
      label.style.cssText = 'font-size:13px'
      label.textContent = `RGB(${c.r}, ${c.g}, ${c.b})`
      colorBox.appendChild(label)
      card.appendChild(colorBox)
    }

    // 参考帧缩略图
    if (this.referenceFrame) {
      const refBox = div('wizard-ref-frame-preview')
      refBox.style.cssText = 'margin-top:12px;display:flex;align-items:center;gap:8px'
      const thumb = document.createElement('canvas')
      thumb.width = 80
      thumb.height = 45
      thumb.style.cssText = 'border-radius:4px;border:1px solid #5eba7d'
      const tctx = thumb.getContext('2d')
      if (tctx) {
        const off = document.createElement('canvas')
        off.width = this.referenceFrame.width
        off.height = this.referenceFrame.height
        const offCtx = off.getContext('2d')
        if (offCtx) {
          offCtx.putImageData(
            new ImageData(
              new Uint8ClampedArray(this.referenceFrame.data),
              this.referenceFrame.width,
              this.referenceFrame.height,
            ),
            0,
            0,
          )
          tctx.drawImage(off, 0, 0, 80, 45)
        }
      }
      refBox.appendChild(thumb)
      const refLabel = el('span', '')
      refLabel.style.cssText = 'font-size:12px;color:#5eba7d'
      refLabel.textContent = `参考帧已设定 (${this.referenceFrame.width}×${this.referenceFrame.height})`
      refBox.appendChild(refLabel)
      card.appendChild(refBox)
    }

    // 手动输入 RGB
    const manualBtn = makeButton('手动输入 RGB', () => {
      const input = window.prompt('输入 RGB 值（逗号分隔，如 128,128,128）：', '128,128,128')
      if (!input) return
      const parts = input.split(',').map((s) => parseInt(s.trim(), 10))
      if (parts.length !== 3 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
        this.statusMsg = 'RGB 格式错误，请输入三个 0–255 的整数'
        this.render()
        return
      }
      this.flowState = updateData(this.flowState!, {
        referenceColor: { r: parts[0], g: parts[1], b: parts[2] },
      })
      this.statusMsg = ''
      this.render()
    })
    styleButton(manualBtn, COLOR_BTN, COLOR_BTN_HOVER)
    card.appendChild(manualBtn)

    content.appendChild(card)
  }

  /** 在 canvas 上绘制指定时间点的视频帧 */
  private drawVideoFrameAt(
    canvas: HTMLCanvasElement,
    videoPath: string,
    timeSec: number,
  ): void {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.onloadeddata = () => {
      video.currentTime = timeSec
    }
    video.onseeked = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const vw = video.videoWidth
      const vh = video.videoHeight
      const scale = Math.min(canvas.width / vw, canvas.height / vh)
      const dw = vw * scale
      const dh = vh * scale
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
    }
    video.src = `file:///${videoPath.replace(/\\/g, '/')}`
  }

  // ── 步骤 3：抠像预览 ── //

  private renderKeyingPreviewStep(content: HTMLElement): void {
    const data = this.flowState!.data
    const card = makeCard()

    if (!data.referenceColor || !data.videoPath) {
      card.appendChild(el('div', '', '缺少视频或参考色数据，请返回上一步'))
      content.appendChild(card)
      return
    }

    // 容器供 ChromaKeyPreview 挂载
    const previewHost = div('wizard-keying-host')
    previewHost.style.cssText = 'margin-bottom:16px'
    card.appendChild(previewHost)

    // 容差/软边/亮度权重 控件
    const controls = div('wizard-keying-controls')
    controls.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-bottom:12px'

    const toleranceSlider = makeSlider('容差 tolerance', 0.01, 1.0, 0.01, data.keyingTolerance, (v) => {
      this.flowState = updateData(this.flowState!, { keyingTolerance: v })
      this.updateKeyingPreview()
    })
    controls.appendChild(toleranceSlider)

    const softnessSlider = makeSlider('软边 softness', 0, 1, 0.05, data.keyingSoftness, (v) => {
      this.flowState = updateData(this.flowState!, { keyingSoftness: v })
      this.updateKeyingPreview()
    })
    controls.appendChild(softnessSlider)

    const lumaSlider = makeSlider('亮度权重 lumaWeight', 0, 1, 0.05, data.keyingLumaWeight, (v) => {
      this.flowState = updateData(this.flowState!, { keyingLumaWeight: v })
      this.updateKeyingPreview()
    })
    controls.appendChild(lumaSlider)

    card.appendChild(controls)

    content.appendChild(card)

    // 初始化抠像预览（异步加载视频帧）
    this.initKeyingPreview(previewHost)
  }

  /** 加载视频帧并初始化色键预览 */
  private async initKeyingPreview(host: HTMLElement): Promise<void> {
    const data = this.flowState!.data
    if (!data.videoPath || !data.referenceColor) return

    // 从视频提取一帧作为预览源帧
    const frame = await this.extractVideoFrameAt(data.videoPath, Math.min(0.5, (data.videoDurationSec || 1) * 0.1))
    if (!frame) return

    const initialState: ChromaKeyPreviewState = {
      source: {
        width: frame.width,
        height: frame.height,
        data: new Uint8ClampedArray(frame.data),
      },
      referenceFrame: this.referenceFrame
        ? { width: this.referenceFrame.width, height: this.referenceFrame.height, data: new Uint8ClampedArray(this.referenceFrame.data) }
        : null,
      referenceAssist: this.referenceFrame
        ? { tolerance: 0.1, influence: 0.8 }
        : null,
      key: {
        referenceColor: data.referenceColor,
        tolerance: data.keyingTolerance,
        softness: data.keyingSoftness,
        lumaWeight: data.keyingLumaWeight,
      },
      edge: {},
      showAlphaMask: false,
      inspect: null,
      zoomFactor: 8,
      zoomSize: 24,
    }

    this.chromaPreview?.dispose()
    this.chromaPreview = new ChromaKeyPreview(host, initialState)
  }

  /** 更新色键预览参数 */
  private updateKeyingPreview(): void {
    if (!this.chromaPreview || !this.flowState) return
    const data = this.flowState.data
    this.chromaPreview.update({
      key: {
        referenceColor: data.referenceColor!,
        tolerance: data.keyingTolerance,
        softness: data.keyingSoftness,
        lumaWeight: data.keyingLumaWeight,
      },
    })
  }

  /** 从视频提取指定时间点的帧为 RGBA 数据（原始分辨率） */
  private extractVideoFrameAt(videoPath: string, timeSec: number): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'auto'
      video.onloadeddata = () => {
        video.currentTime = Math.min(timeSec, (video.duration || 1) - 0.01)
      }
      video.onseeked = () => {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(video, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        resolve({
          width: canvas.width,
          height: canvas.height,
          data: new Uint8ClampedArray(imageData.data),
        })
      }
      video.onerror = () => resolve(null)
      video.src = `file:///${videoPath.replace(/\\/g, '/')}`
    })
  }

  /**
   * 从视频逐帧提取 RGBA 数据（降采样到 maxWidth 以内），供行走跟踪使用。
   *
   * 在视频时间轴上均匀采样 maxFrames 帧（受视频时长 × fps 约束），
   * 逐次 seek + drawImage 到缩放画布。
   */
  private extractVideoFrames(
    videoPath: string,
    durationSec: number,
    maxFrames: number,
    maxWidth: number,
  ): Promise<{ frames: RawFrame[]; fps: number } | null> {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'auto'

      video.onloadedmetadata = () => {
        const duration = durationSec || video.duration
        if (!duration || !isFinite(duration)) {
          resolve(null)
          return
        }

        const fps = 30
        const totalFrames = Math.min(maxFrames, Math.max(2, Math.round(duration * fps)))

        const scale = Math.min(1, maxWidth / video.videoWidth)
        const width = Math.max(1, Math.round(video.videoWidth * scale))
        const height = Math.max(1, Math.round(video.videoHeight * scale))

        const frames: RawFrame[] = []
        let frameIdx = 0

        const seekNext = (): void => {
          if (frameIdx >= totalFrames) {
            resolve({ frames, fps })
            return
          }
          // 均匀分布：首帧到末帧覆盖整个视频
          const t = totalFrames === 1
            ? 0.01
            : (frameIdx / (totalFrames - 1)) * (duration - 0.02) + 0.01
          video.currentTime = Math.max(0, Math.min(t, duration - 0.01))
        }

        video.onseeked = () => {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(null)
            return
          }
          ctx.drawImage(video, 0, 0, width, height)
          const imageData = ctx.getImageData(0, 0, width, height)
          frames.push({
            width,
            height,
            data: new Uint8ClampedArray(imageData.data),
          })
          frameIdx++
          seekNext()
        }

        seekNext()
      }

      video.onerror = () => resolve(null)
      video.src = `file:///${videoPath.replace(/\\/g, '/')}`
    })
  }

  // ── 步骤 4：裁剪 / 标 loop ── //

  private renderCropLoopStep(content: HTMLElement): void {
    const data = this.flowState!.data
    const item = this.flowState!.targetItem
    const card = makeCard()

    // 裁剪范围
    const trimSection = div('wizard-trim')
    trimSection.style.cssText = 'margin-bottom:16px'

    const trimTitle = el('div', '')
    trimTitle.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:8px'
    trimTitle.textContent = '裁剪范围（秒，可留空表示不裁剪）'
    trimSection.appendChild(trimTitle)

    const trimRow = div('wizard-trim-row')
    trimRow.style.cssText = 'display:flex;gap:12px;align-items:center'

    const trimStart = makeNumberInput('裁剪起点 (秒)', data.trimStartSec ?? 0, 0, data.videoDurationSec, 0.1, (v) => {
      this.flowState = updateData(this.flowState!, { trimStartSec: v })
    })
    trimRow.appendChild(trimStart)

    const trimEnd = makeNumberInput('裁剪终点 (秒)', data.trimEndSec ?? data.videoDurationSec, 0, data.videoDurationSec, 0.1, (v) => {
      this.flowState = updateData(this.flowState!, { trimEndSec: v })
    })
    trimRow.appendChild(trimEnd)

    trimSection.appendChild(trimRow)
    card.appendChild(trimSection)

    // Loop 标注（仅循环片段）
    if (item.loop) {
      const loopSection = div('wizard-loop')
      loopSection.style.cssText = 'margin-bottom:16px'

      const loopTitle = el('div', '')
      loopTitle.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:8px;color:#ffd166'
      loopTitle.textContent = `循环标注（此片段为循环类型，需标注 loop 入/出点）`
      loopSection.appendChild(loopTitle)

      const loopRow = div('wizard-loop-row')
      loopRow.style.cssText = 'display:flex;gap:12px;align-items:center'

      const loopIn = makeNumberInput('loop 入点 (秒)', data.loopInSec ?? 0, 0, data.videoDurationSec, 0.1, (v) => {
        this.flowState = updateData(this.flowState!, { loopInSec: v })
      })
      loopRow.appendChild(loopIn)

      const loopOut = makeNumberInput('loop 出点 (秒)', data.loopOutSec ?? data.videoDurationSec, 0, data.videoDurationSec, 0.1, (v) => {
        this.flowState = updateData(this.flowState!, { loopOutSec: v })
      })
      loopRow.appendChild(loopOut)

      loopSection.appendChild(loopRow)
      card.appendChild(loopSection)
    }

    content.appendChild(card)
  }

  // ── 步骤 5：行走跟踪校正（仅行走类）── //

  private renderWalkTrackingStep(content: HTMLElement): void {
    const card = makeCard()

    const hint = el('p', '')
    hint.style.cssText = `font-size:12px;color:${COLOR_TEXT_DIM};margin:0 0 12px 0;line-height:1.5`
    hint.textContent = '从视频中逐帧提取 alpha 质心并生成位移曲线（§5.3）；拖拽关键点校正停顿/变速处，拖动红线标注行走子段边界。'
    card.appendChild(hint)

    // 行走校正视图容器（加载完成前显示占位提示）
    const host = div('wizard-walk-host')
    card.appendChild(host)

    content.appendChild(card)

    // 异步：提取视频帧 → 色键 → 行走跟踪管线 → 初始化校正视图
    this.initWalkCorrection(host)
  }

  /**
   * 从用户实际视频生成位移曲线并初始化校正视图 (§5.3)。
   *
   * 管线：提取帧 → applyChromaKey（用已选参考色/容差）→
   * buildWalkTrack（trackWalkFrames → generateDisplacementCurve →
   * detectMoveSegment）→ WalkCorrectionView。
   */
  private async initWalkCorrection(host: HTMLElement): Promise<void> {
    const data = this.flowState!.data
    if (!data.videoPath || !data.referenceColor) {
      host.appendChild(this.makeWalkError('缺少视频或参考色数据，请返回上一步'))
      return
    }

    // 加载占位
    const loading = el('div', 'wizard-walk-loading')
    loading.style.cssText = `padding:20px;color:${COLOR_TEXT_DIM};font-size:13px`
    loading.textContent = '正在提取视频帧并跟踪行走…'
    host.appendChild(loading)

    // 1. 提取视频帧（降采样以控制内存）
    const result = await this.extractVideoFrames(
      data.videoPath,
      data.videoDurationSec,
      150,
      320,
    )
    if (!result || result.frames.length < 2) {
      host.removeChild(loading)
      host.appendChild(this.makeWalkError('无法提取足够视频帧用于行走跟踪，请检查视频文件'))
      return
    }

    // 用户可能已离开此步骤
    if (this.flowState?.step !== 'walk-tracking') return

    // 2. 对每帧施加色键（用流程中已选的参考色/容差/软边/亮度权重）
    const keyedFrames: KeyedFrame[] = result.frames.map((frame) =>
      applyChromaKey(frame, {
        referenceColor: data.referenceColor!,
        tolerance: data.keyingTolerance,
        softness: data.keyingSoftness,
        lumaWeight: data.keyingLumaWeight,
        edge: { shrinkRadius: 1, featherRadius: 1 },
      }),
    )

    // 3. 行走跟踪全流程（质心跟踪 → 位移曲线 → 子段检测）
    const { trackFile, moveSegment } = buildWalkTrack(keyedFrames, result.fps)

    // 4. 初始化校正视图
    const initialState: WalkCorrectionState = {
      fps: trackFile.fps,
      frameCount: trackFile.frameCount,
      sourceWidth: trackFile.sourceWidth,
      offsets: trackFile.offsets,
      keypoints: [],
      moveStartFrame: moveSegment?.moveStartFrame ?? 0,
      moveEndFrame: moveSegment?.moveEndFrame ?? trackFile.frameCount - 1,
    }

    this.walkCorrection?.dispose()
    const view = new WalkCorrectionView(host, initialState, {
      onChange: (state) => {
        this.flowState = updateData(this.flowState!, {
          moveStartSec: state.moveStartFrame / state.fps,
          moveEndSec: state.moveEndFrame / state.fps,
          // IR-012：关键点/子段边界每次变更都重新导出校正后的 trackFile，
          // 保存时写盘的 track.json 含校正 offsets 与 keypoints (§5.3)
          trackFile: view.exportTrackFile(),
        })
      },
    })
    this.walkCorrection = view

    // 5. 把跟踪结果写入流程数据
    this.flowState = updateData(this.flowState!, {
      moveStartSec: initialState.moveStartFrame / initialState.fps,
      moveEndSec: initialState.moveEndFrame / initialState.fps,
      trackFile: this.walkCorrection.exportTrackFile(),
    })
  }

  /** 行走跟踪错误提示元素 */
  private makeWalkError(msg: string): HTMLElement {
    const err = el('div', 'wizard-walk-error')
    err.style.cssText = `padding:16px;color:${COLOR_MISSING};font-size:13px`
    err.textContent = msg
    return err
  }

  // ── 步骤 6：填写标签 ── //

  private renderMetadataStep(content: HTMLElement): void {
    const data = this.flowState!.data
    const item = this.flowState!.targetItem
    const card = makeCard()

    // 片段 ID（可编辑）
    card.appendChild(makeField('片段 ID', () => {
      const input = document.createElement('input')
      input.type = 'text'
      input.value = data.clipId
      input.style.cssText = inputStyle()
      input.addEventListener('input', () => {
        this.flowState = updateData(this.flowState!, { clipId: input.value })
      })
      return input
    }))

    // 变体编号
    card.appendChild(makeField('变体编号', () => {
      const input = document.createElement('input')
      input.type = 'number'
      input.value = String(data.variant)
      input.min = '1'
      input.style.cssText = inputStyle()
      input.addEventListener('input', () => {
        this.flowState = updateData(this.flowState!, { variant: parseInt(input.value, 10) || 1 })
      })
      return input
    }))

    // 方向选择
    if (item.direction === 'left-right' || item.direction === 'both') {
      card.appendChild(makeField('方向', () => {
        const select = document.createElement('select')
        select.style.cssText = inputStyle()
        for (const dir of ['none', 'left', 'right'] as const) {
          const opt = document.createElement('option')
          opt.value = dir
          opt.textContent = dir === 'none' ? '无' : dir === 'left' ? '左行' : '右行'
          if (data.direction === dir) opt.selected = true
          select.appendChild(opt)
        }
        select.addEventListener('change', () => {
          this.flowState = updateData(this.flowState!, { direction: select.value as ClipMeta['direction'] })
        })
        return select
      }))
    }

    // signature 标签
    card.appendChild(makeCheckbox('个性招牌（低频触发）', data.signature, (v) => {
      this.flowState = updateData(this.flowState!, { signature: v })
    }))

    // prop 标签
    card.appendChild(makeCheckbox('道具类片段（§4.7）', data.prop, (v) => {
      this.flowState = updateData(this.flowState!, { prop: v })
    }))

    // embeddedAudio
    card.appendChild(makeCheckbox('保留内嵌音轨（§4.8）', data.embeddedAudio, (v) => {
      this.flowState = updateData(this.flowState!, { embeddedAudio: v })
      // embeddedAudio 切换影响音频关联下拉的可用性，重渲染
      this.render()
    }))

    // 音频素材关联 (§11.1 音视频分离入库, IR-013)
    card.appendChild(this.renderAudioSection())

    // scaleHint
    card.appendChild(makeField('尺度系数 (scaleHint)', () => {
      const input = document.createElement('input')
      input.type = 'number'
      input.value = String(data.scaleHint)
      input.step = '0.1'
      input.min = '0.1'
      input.style.cssText = inputStyle()
      input.addEventListener('input', () => {
        this.flowState = updateData(this.flowState!, { scaleHint: parseFloat(input.value) || 1.0 })
      })
      return input
    }))

    content.appendChild(card)
  }

  // ── 音频素材关联 (§11.1, IR-013) ── //

  /**
   * 音频关联区块：从库选择 + 导入音频文件 + 从当前视频抽取音轨 (§4.8)。
   *
   * embeddedAudio=true 时 ClipMeta.audio 被忽略 (§4.8)，下拉禁用。
   */
  private renderAudioSection(): HTMLElement {
    const data = this.flowState!.data
    const wrap = div('wizard-audio-section')
    wrap.style.cssText = 'margin-bottom:12px'

    const audioEntries = this.projectData?.audio ?? []

    wrap.appendChild(makeField('关联音频素材（§11.1，embeddedAudio 时忽略）', () => {
      const select = document.createElement('select')
      select.style.cssText = inputStyle()
      const none = document.createElement('option')
      none.value = ''
      none.textContent = audioEntries.length === 0 ? '无（音频库为空，可点击下方按钮入库）' : '无'
      select.appendChild(none)
      for (const a of audioEntries) {
        const opt = document.createElement('option')
        opt.value = a.id
        opt.textContent = `${a.label} (${a.id})`
        if (data.audio === a.id) opt.selected = true
        select.appendChild(opt)
      }
      select.disabled = data.embeddedAudio
      select.addEventListener('change', () => {
        this.flowState = updateData(this.flowState!, {
          audio: select.value === '' ? null : select.value,
        })
      })
      return select
    }))

    const btnRow = div('wizard-audio-buttons')
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:4px'

    const btnImport = makeButton('导入音频文件…', () => {
      void this.importAudioFile()
    })
    styleButton(btnImport, COLOR_BTN, COLOR_BTN_HOVER)
    btnRow.appendChild(btnImport)

    // §4.8 联动 (IR-010)：从当前视频抽取音轨直接入库为独立音频素材
    if (data.videoPath) {
      const btnExtract = makeButton('从当前视频抽取音轨', () => {
        void this.extractAudioFromVideo()
      })
      styleButton(btnExtract, COLOR_BTN, COLOR_BTN_HOVER)
      btnRow.appendChild(btnExtract)
    }

    wrap.appendChild(btnRow)
    return wrap
  }

  /** 导入音频文件入库 (IR-013)：选文件 → 拷贝至 audio/ → 追加 audio.meta.json */
  private async importAudioFile(): Promise<void> {
    if (!this.projectDir) return
    const sourcePath = await window.petalive.import.selectAudio()
    if (!sourcePath) return

    const baseName = sourcePath.replace(/\\/g, '/').split('/').pop() ?? 'audio'
    const stem = baseName.replace(/\.[^.]+$/, '')
    const id = this.uniqueAudioId(stem.replace(/[^A-Za-z0-9_-]/g, '_') || 'audio')
    const ext = baseName.includes('.') ? baseName.split('.').pop()! : 'webm'
    const meta = {
      id,
      file: `${id}.${ext}`,
      label: stem,
      category: 'action' as const,
      cooldownSec: 20,
      maxPerHour: 60,
    }

    try {
      await window.petalive.import.saveAudio(this.projectDir, meta, sourcePath)
      await this.reloadProject()
      this.flowState = updateData(this.flowState!, { audio: meta.id })
      this.statusMsg = `音频已入库并关联：${meta.label}`
      this.render()
    } catch (err) {
      this.statusMsg = `音频入库失败：${(err as Error).message}`
      this.render()
    }
  }

  /** 从当前视频抽取音轨入库 (§4.8, IR-010/IR-013 联动) */
  private async extractAudioFromVideo(): Promise<void> {
    const videoPath = this.flowState?.data.videoPath
    if (!this.projectDir || !videoPath) return
    const data = this.flowState!.data

    const id = this.uniqueAudioId(`${data.clipId}_audio`)
    const meta = {
      id,
      file: `${id}.webm`,
      label: `${data.clipId} 内嵌音轨`,
      category: 'action' as const,
      cooldownSec: 20,
      maxPerHour: 60,
    }

    try {
      this.statusMsg = '正在抽取音轨…'
      this.render()
      await window.petalive.import.extractAudio(this.projectDir, videoPath, meta)
      await this.reloadProject()
      this.flowState = updateData(this.flowState!, { audio: meta.id })
      this.statusMsg = `音轨已抽取入库并关联：${meta.label}`
      this.render()
    } catch (err) {
      this.statusMsg = `音轨抽取失败：${(err as Error).message}`
      this.render()
    }
  }

  /** 生成不重复的音频 id（已存在时追加序号） */
  private uniqueAudioId(base: string): string {
    const existing = new Set((this.projectData?.audio ?? []).map((a) => a.id))
    if (!existing.has(base)) return base
    for (let i = 2; ; i++) {
      const candidate = `${base}_${i}`
      if (!existing.has(candidate)) return candidate
    }
  }

  /** 重新加载项目数据（音频/片段入库后刷新） */
  private async reloadProject(): Promise<void> {
    if (!this.projectDir) return
    this.projectData = await window.petalive.import.loadProject(this.projectDir)
    this.refreshChecklist()
  }

  // ── 步骤 7：转码入库 ── //

  private renderTranscodeSaveStep(content: HTMLElement): void {
    const card = makeCard()

    // 预览元数据
    if (!this.flowState) {
      card.appendChild(el('div', '', '流程数据缺失'))
      content.appendChild(card)
      return
    }

    const clip = buildClipMeta(this.flowState)
    const request = buildTranscodeRequest(this.flowState)

    const summary = el('div', 'wizard-save-summary')
    summary.style.cssText = `padding:12px;background:${COLOR_BG};border-radius:6px;margin-bottom:12px;font-size:12px;line-height:1.6`

    const lines = [
      `片段 ID: ${clip.id}`,
      `状态: ${clip.state}`,
      `类别: ${clip.category}`,
      `方向: ${clip.direction}`,
      `锚定: ${clip.anchor}`,
      `循环: ${clip.loop}${clip.loop ? ` (${clip.loopInSec}s–${clip.loopOutSec}s)` : ''}`,
      `变体: #${clip.variant}`,
      `尺度: ${clip.scaleHint}`,
      clip.moveStartSec !== undefined ? `行走子段: ${clip.moveStartSec}s–${clip.moveEndSec}s` : '',
      `轨道: ${clip.track ?? '无'}`,
    ].filter(Boolean)

    summary.textContent = lines.join('\n')
    card.appendChild(summary)

    const hint = el('p', '')
    hint.style.cssText = `font-size:12px;color:${COLOR_TEXT_DIM};margin:0 0 12px 0`
    hint.textContent = '点击「转码并保存」将执行 ffmpeg 色键 + VP9-alpha 编码，写入 clips/ 目录并更新 clips.meta.json。'
    card.appendChild(hint)

    const btnRow = div('wizard-save-buttons')
    btnRow.style.cssText = 'display:flex;gap:8px'

    const btnSave = makeButton('转码并保存', async () => {
      await this.executeTranscodeAndSave(clip, request)
    })
    styleButton(btnSave, COLOR_BTN_PRIMARY)
    btnRow.appendChild(btnSave)

    card.appendChild(btnRow)
    content.appendChild(card)
  }

  /** 执行转码 + 保存 */
  private async executeTranscodeAndSave(
    clip: ClipMeta,
    request: ReturnType<typeof buildTranscodeRequest>,
  ): Promise<void> {
    if (!this.projectDir) {
      this.statusMsg = '未选择项目目录'
      this.render()
      return
    }

    const btn = document.querySelector('.wizard-save-buttons button') as HTMLButtonElement | null
    if (btn) {
      btn.disabled = true
      btn.textContent = '转码中…'
    }

    try {
      // 1. 转码
      this.statusMsg = '正在转码…'
      await window.petalive.import.transcode(
        request,
        this.projectDir,
        undefined,
        undefined,
      )

      // 2. 保存元数据 + track.json
      const trackFile = this.flowState?.data.trackFile ?? undefined
      await window.petalive.import.saveClip(this.projectDir, clip, trackFile)

      // 3. 刷新项目数据
      this.projectData = await window.petalive.import.loadProject(this.projectDir)
      this.statusMsg = ''

      // 4. 返回清单
      this.chromaPreview?.dispose()
      this.chromaPreview = null
      this.walkCorrection?.dispose()
      this.walkCorrection = null
      this.flowState = null
      this.render()
    } catch (err) {
      this.statusMsg = `转码/保存失败：${(err as Error).message}`
      if (btn) {
        btn.disabled = false
        btn.textContent = '转码并保存'
      }
      this.render()
    }
  }

  // ── 底部按钮栏 ── //

  private renderFooter(): HTMLElement {
    const footer = div('wizard-flow-footer')
    footer.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:${COLOR_PANEL};border-top:1px solid ${COLOR_PANEL_BORDER}`

    // 校验状态
    const validation = validateStep(this.flowState!)
    const validLabel = el('div', '')
    validLabel.style.cssText = `font-size:11px;color:${validation.ok ? '#5eba7d' : COLOR_TEXT_DIM}`
    validLabel.textContent = validation.ok ? '✓ 当前步骤数据完整' : ''
    footer.appendChild(validLabel)

    const btnRow = div('wizard-flow-nav')
    btnRow.style.cssText = 'display:flex;gap:8px'

    // 上一步
    const btnBack = makeButton('← 上一步', () => {
      this.flowState = retreat(this.flowState!)
      this.statusMsg = ''
      this.render()
    })
    styleButton(btnBack, COLOR_BTN, COLOR_BTN_HOVER)
    btnRow.appendChild(btnBack)

    // 下一步 / 完成
    if (!isLastStep(this.flowState!)) {
      const btnNext = makeButton('下一步 →', () => {
        const result = advance(this.flowState!)
        if ('error' in result) {
          this.statusMsg = result.error
          this.render()
        } else {
          this.flowState = result
          this.statusMsg = ''
          this.render()
        }
      })
      styleButton(btnNext, COLOR_BTN_PRIMARY)
      btnRow.appendChild(btnNext)
    }

    footer.appendChild(btnRow)
    return footer
  }

  // ── 辅助 ── //

  private showError(msg: string): void {
    this.container.innerHTML = ''
    const box = div('wizard-error')
    box.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:${COLOR_MISSING}`
    box.textContent = msg
    const btn = makeButton('返回', () => this.render())
    styleButton(btn, COLOR_BTN, COLOR_BTN_HOVER)
    box.appendChild(btn)
    this.container.appendChild(box)
  }

  /** 注入全局样式 */
  private injectStyles(): void {
    if (document.getElementById('import-wizard-styles')) return
    const style = document.createElement('style')
    style.id = 'import-wizard-styles'
    style.textContent = `
      .wizard-flow-layout, .wizard-checklist-layout { font-family: system-ui, -apple-system, sans-serif; }
      .wizard-flow-content input[type="number"],
      .wizard-flow-content input[type="text"],
      .wizard-flow-content select {
        background: ${COLOR_BG};
        border: 1px solid ${COLOR_PANEL_BORDER};
        color: ${COLOR_TEXT};
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 13px;
      }
    `
    document.head.appendChild(style)
  }
}

// ── DOM 辅助函数 ── //

function div(className: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = className
  return d
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}

function styleButton(btn: HTMLButtonElement, bg: string, hover?: string): void {
  btn.style.cssText = `padding:8px 16px;border-radius:6px;border:none;background:${bg};color:white;font-size:13px;cursor:pointer;transition:background 0.15s${btn.style.cssText}`
  if (hover) {
    btn.addEventListener('mouseenter', () => { btn.style.background = hover })
    btn.addEventListener('mouseleave', () => { btn.style.background = bg })
  }
}

function makeCard(): HTMLDivElement {
  const card = div('wizard-card')
  card.style.cssText = `padding:16px;background:${COLOR_PANEL};border:1px solid ${COLOR_PANEL_BORDER};border-radius:8px`
  return card
}

function makeSlider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void,
): HTMLElement {
  const row = div('wizard-slider')
  row.style.cssText = 'display:flex;align-items:center;gap:8px'
  const lbl = el('label', '')
  lbl.style.cssText = `font-size:12px;color:${COLOR_TEXT_DIM};min-width:140px`
  lbl.textContent = label
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.style.flex = '1'
  const valLabel = el('span', '')
  valLabel.style.cssText = `font-size:12px;color:${COLOR_TEXT};min-width:40px;text-align:right`
  valLabel.textContent = value.toFixed(2)
  input.addEventListener('input', () => {
    const v = parseFloat(input.value)
    valLabel.textContent = v.toFixed(2)
    onChange(v)
  })
  row.appendChild(lbl)
  row.appendChild(input)
  row.appendChild(valLabel)
  return row
}

function makeNumberInput(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLElement {
  const row = div('wizard-number-input')
  row.style.cssText = 'display:flex;flex-direction:column;gap:4px'
  const lbl = el('label', '')
  lbl.style.cssText = `font-size:12px;color:${COLOR_TEXT_DIM}`
  lbl.textContent = label
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(value)
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.style.cssText = inputStyle()
  input.addEventListener('input', () => {
    onChange(parseFloat(input.value) || 0)
  })
  row.appendChild(lbl)
  row.appendChild(input)
  return row
}

function makeField(label: string, makeControl: () => HTMLElement): HTMLElement {
  const row = div('wizard-field')
  row.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:12px'
  const lbl = el('label', '')
  lbl.style.cssText = `font-size:12px;color:${COLOR_TEXT_DIM}`
  lbl.textContent = label
  row.appendChild(lbl)
  row.appendChild(makeControl())
  return row
}

function makeCheckbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = div('wizard-checkbox')
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  const lbl = el('label', '')
  lbl.style.cssText = `font-size:13px;color:${COLOR_TEXT}`
  lbl.textContent = label
  row.appendChild(input)
  row.appendChild(lbl)
  return row
}

function inputStyle(): string {
  return `width:100%;padding:4px 8px;background:${COLOR_BG};border:1px solid ${COLOR_PANEL_BORDER};color:${COLOR_TEXT};border-radius:4px;font-size:13px;box-sizing:border-box`
}

/**
 * 挂载导入向导到容器元素。
 *
 * 返回 ImportWizard 实例（供开发调试用）。
 */
export function mountImportWizard(container: HTMLElement): ImportWizard {
  const wizard = new ImportWizard(container)
  wizard.render()
  return wizard
}
