/**
 * 行走跟踪裁切 + 位移曲线演示 (§5.3 手动验证入口)
 *
 * 用合成行走素材（蓝幕 + 移动毛发团，含起止站定与中途停顿/变速）
 * 走完 §5.3 全流程：色键抠像（TASK-005 内核）→ 逐帧质心跟踪 →
 * x 定宽跟踪裁切 + y 地面线锁定 → 位移曲线 → 手动校正界面。
 *
 * 面板：
 * - 跟踪裁切片段回放：宠物近似居中、足部锁定地面线（屏幕位移在
 *   运行时由位移曲线驱动，本面板演示的是入库产物本身，§7.2）
 * - 位移曲线手动校正（WalkCorrectionView）：关键点校正 + 行走子段标注
 * - 导出 track.json / moveStartSec / moveEndSec 读数
 *
 * 启动方式：PETALIVE_VIEW=walk-correction npm run dev
 */

import {
  BLUE_BACKGROUND,
  FUR_ORANGE,
  type KeyedFrame,
  type RawFrame,
  type WalkFrameTrack,
  applyChromaKey,
  computeTrackCropRects,
  createFurBlobScene,
  cropFrame,
  detectMoveSegment,
  generateDisplacementCurve,
  trackWalkFrames
} from '../../shared/pipeline'
import {
  WalkCorrectionView,
  type WalkCorrectionState
} from './walk-correction'

/** 合成素材参数 */
const SRC_W = 240
const SRC_H = 180
const FPS = 30
const FRAME_COUNT = 180 // 6 秒
const GROUND_Y_SRC = 160 // 源画面地面线（宠物足部）
const BLOB_RX = 22
const BLOB_RY = 18
const PET_START_X = 55

/** 跟踪裁切参数：定宽输出，地面线保持源画面高度 */
const CROP_W = 100
const CROP_H = SRC_H
const GROUND_Y_OUT = GROUND_Y_SRC

/** 速度档（帧区间 → px/帧）：起站定 → 加速 → 匀速 → 中途停顿 → 匀速 → 减速 → 止站定 */
const SPEED_PLAN: readonly { from: number; to: number; speed: (t: number) => number }[] = [
  { from: 0, to: 15, speed: () => 0 },
  { from: 15, to: 45, speed: (t) => (t / 30) * 1.2 },
  { from: 45, to: 75, speed: () => 1.2 },
  { from: 75, to: 87, speed: () => 0 },
  { from: 87, to: 150, speed: () => 1.2 },
  { from: 150, to: 165, speed: (t) => (1 - t / 15) * 1.2 },
  { from: 165, to: FRAME_COUNT, speed: () => 0 }
]

/** 按速度档积分出第 frame 帧的宠物质心 x */
function petCenterX(frame: number): number {
  let x = PET_START_X
  for (const seg of SPEED_PLAN) {
    if (frame >= seg.to) {
      for (let f = seg.from; f < seg.to; f++) {
        x += seg.speed(f - seg.from)
      }
    } else if (frame >= seg.from) {
      for (let f = seg.from; f < frame; f++) {
        x += seg.speed(f - seg.from)
      }
      break
    }
  }
  return x
}

/** 生成合成行走素材并跑完 §5.3 管线 */
function buildDemoData(): {
  track: WalkFrameTrack[]
  cropped: RawFrame[]
  state: WalkCorrectionState
} {
  // 1. 合成源帧（蓝幕 + 移动毛发团，足部贴源地面线，步态带 ±1px 上下起伏）
  const keyed: KeyedFrame[] = []
  for (let i = 0; i < FRAME_COUNT; i++) {
    const bob = Math.sin((i / FRAME_COUNT) * Math.PI * 8) * 1
    const scene = createFurBlobScene({
      width: SRC_W,
      height: SRC_H,
      background: BLUE_BACKGROUND,
      furColor: FUR_ORANGE,
      centerX: petCenterX(i),
      centerY: GROUND_Y_SRC - BLOB_RY + bob,
      radiusX: BLOB_RX,
      radiusY: BLOB_RY,
      edgeSoftnessPx: 3,
      noiseLevel: 3,
      seed: 1000 + i
    })
    keyed.push(
      applyChromaKey(scene.frame, {
        referenceColor: BLUE_BACKGROUND,
        tolerance: 0.15,
        softness: 0.3,
        edge: { shrinkRadius: 1, featherRadius: 1 }
      })
    )
  }

  // 2. 逐帧质心跟踪（§5.3）
  const track = trackWalkFrames(keyed)

  // 3. x 定宽跟踪裁切 + y 地面线锁定（§5.3）
  const rects = computeTrackCropRects(track, {
    width: CROP_W,
    height: CROP_H,
    groundY: GROUND_Y_OUT
  })
  const cropped = rects.map((rect, i) => cropFrame(keyed[i].frame, rect, CROP_W, CROP_H))

  // 4. 位移曲线 + 行走子段自动检测（§5.3、§7.2）
  const curve = generateDisplacementCurve(track, FPS)
  const segment = detectMoveSegment(curve.offsets, FPS)

  const state: WalkCorrectionState = {
    fps: FPS,
    frameCount: curve.frameCount,
    offsets: curve.offsets,
    keypoints: [],
    moveStartFrame: segment?.moveStartFrame ?? 0,
    moveEndFrame: segment?.moveEndFrame ?? curve.frameCount - 1
  }

  return { track, cropped, state }
}

let styleInjected = false

function injectDemoStyle(): void {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
.wcd-root { display: flex; flex-direction: column; gap: 20px; padding: 16px; }
.wcd-panel { background: #262a32; border-radius: 8px; padding: 14px; }
.wcd-caption { color: #aeb4c0; font: 13px/1.6 sans-serif; margin-bottom: 8px; }
.wcd-strip { display: flex; gap: 16px; align-items: flex-start; }
.wcd-readout { color: #d5dae2; font: 12px/1.9 monospace; white-space: pre; }
.wcd-canvas { background: #1a1d23; border-radius: 6px; display: block; }
button { background: #3a4150; color: #e6e9ef; border: none; border-radius: 4px;
  padding: 6px 12px; margin-right: 8px; font: 12px sans-serif; cursor: pointer; }
button:hover { background: #465064; }
.wc-root { margin-top: 10px; }
.wc-canvas { width: 100%; height: auto; border-radius: 6px; cursor: crosshair; touch-action: none; }
.wc-controls { margin-top: 8px; display: flex; align-items: center; gap: 12px; }
.wc-hint { color: #8a919e; font: 12px sans-serif; }
`
  document.head.appendChild(style)
}

/**
 * 挂载行走跟踪裁切 + 位移曲线演示。
 *
 * @param container 宿主元素
 * @returns 校正视图实例（VERIFY-002 手动验证时可从控制台操作）
 */
export function mountWalkCorrectionDemo(container: HTMLElement): WalkCorrectionView {
  injectDemoStyle()
  document.body.style.background = '#1e2128'
  container.innerHTML = ''

  const { track, cropped, state } = buildDemoData()

  const root = document.createElement('div')
  root.className = 'wcd-root'

  // ── 面板 1：跟踪裁切片段回放 ── //
  const playPanel = document.createElement('div')
  playPanel.className = 'wcd-panel'
  const playCaption = document.createElement('div')
  playCaption.className = 'wcd-caption'
  playCaption.textContent =
    '跟踪裁切片段回放（定宽 100px，宠物近似居中；红线 = 输出地面线，足部全程锁定其上）'
  const playCanvas = document.createElement('canvas')
  playCanvas.className = 'wcd-canvas'
  playCanvas.width = CROP_W
  playCanvas.height = CROP_H
  playCanvas.style.width = `${CROP_W * 3}px`
  playCanvas.style.height = `${CROP_H * 3}px`
  playCanvas.style.imageRendering = 'pixelated'
  playPanel.appendChild(playCaption)
  playPanel.appendChild(playCanvas)

  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.textContent = '暂停'
  let playing = true
  let frame = 0
  let raf = 0
  let lastTime = performance.now()

  const drawFrame = (): void => {
    const ctx = playCanvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, CROP_W, CROP_H)
    const imageData = ctx.createImageData(CROP_W, CROP_H)
    imageData.data.set(cropped[frame].data)
    ctx.putImageData(imageData, 0, 0)
    // 输出地面线：足部锁定参考
    ctx.strokeStyle = '#ff4d6d'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, GROUND_Y_OUT + 0.5)
    ctx.lineTo(CROP_W, GROUND_Y_OUT + 0.5)
    ctx.stroke()
    // 居中参考线
    ctx.strokeStyle = 'rgba(126, 200, 255, 0.35)'
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(CROP_W / 2 + 0.5, 0)
    ctx.lineTo(CROP_W / 2 + 0.5, CROP_H)
    ctx.stroke()
    ctx.setLineDash([])
  }

  const tick = (now: number): void => {
    if (!playing) return
    if (now - lastTime >= 1000 / FPS) {
      lastTime = now
      frame = (frame + 1) % FRAME_COUNT
      drawFrame()
    }
    raf = requestAnimationFrame(tick)
  }

  playBtn.addEventListener('click', () => {
    playing = !playing
    playBtn.textContent = playing ? '暂停' : '播放'
    if (playing) {
      lastTime = performance.now()
      raf = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(raf)
    }
  })
  playPanel.appendChild(playBtn)

  // ── 面板 2：跟踪读数 + 位移曲线校正 ── //
  const curvePanel = document.createElement('div')
  curvePanel.className = 'wcd-panel'
  const curveCaption = document.createElement('div')
  curveCaption.className = 'wcd-caption'
  curveCaption.textContent = '位移曲线手动校正（停顿/变速处关键点 + 行走子段标注）'
  curvePanel.appendChild(curveCaption)

  const readout = document.createElement('div')
  readout.className = 'wcd-readout'

  const strip = document.createElement('div')
  strip.className = 'wcd-strip'
  strip.appendChild(playPanel)
  strip.appendChild(readout)
  root.appendChild(strip)
  root.appendChild(curvePanel)

  const viewHost = document.createElement('div')
  curvePanel.appendChild(viewHost)

  // 导出按钮
  const exportRow = document.createElement('div')
  exportRow.style.marginTop = '10px'
  const exportBtn = document.createElement('button')
  exportBtn.type = 'button'
  exportBtn.textContent = '导出 track.json'
  exportRow.appendChild(exportBtn)
  curvePanel.appendChild(exportRow)

  container.appendChild(root)

  const view = new WalkCorrectionView(viewHost, state, {
    onChange: () => updateReadout()
  })

  function updateReadout(): void {
    const t0 = track[0]
    const t1 = track[track.length - 1]
    const offsets = view.getCorrectedOffsets()
    const seg = view.getMoveSegmentSecs()
    readout.textContent =
      `跟踪（逐帧质心，共 ${track.length} 帧 @ ${FPS}fps）\n` +
      `  首帧质心  x=${t0.centroidX.toFixed(2)}  y=${t0.centroidY.toFixed(2)}  feetY=${t0.feetY}\n` +
      `  末帧质心  x=${t1.centroidX.toFixed(2)}  y=${t1.centroidY.toFixed(2)}  feetY=${t1.feetY}\n` +
      `位移曲线（源像素，含校正）\n` +
      `  末值 = ${offsets[offsets.length - 1].toFixed(2)} px\n` +
      `  关键点数 = ${view.getState().keypoints.length}\n` +
      `行走子段（moveStartSec / moveEndSec）\n` +
      `  ${seg.moveStartSec.toFixed(3)}s → ${seg.moveEndSec.toFixed(3)}s`
  }
  updateReadout()

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(view.exportTrackFile(), null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'walk_demo.track.json'
    a.click()
    URL.revokeObjectURL(url)
  })

  drawFrame()
  raf = requestAnimationFrame(tick)

  return view
}
