/**
 * 色键抠像预览合成演示 (§5.5 手动验证入口)
 *
 * 用合成毛发场景（src/shared/pipeline/synthetic-frame）驱动
 * ChromaKeyPreview：无需真实素材即可调节容差/软度/亮度权重/溢色抑制/
 * 收缩/羽化/参考帧减除，检查蓝幕与灰幕、常见毛色的抠像边缘质量。
 *
 * 启动方式：PETALIVE_VIEW=chroma-preview npm run dev
 * （渲染入口在 #chroma-preview 视图下调用 mountChromaKeyPreviewDemo）。
 */

import {
  BLUE_BACKGROUND,
  FUR_BLACK,
  FUR_BROWN,
  FUR_ORANGE,
  FUR_WHITE,
  GRAY_BACKGROUND,
  type RgbColor,
  type SyntheticKeyingScene,
  createFurBlobScene
} from '../../shared/pipeline'
import { DEFAULT_ZOOM_FACTOR, DEFAULT_ZOOM_SOURCE_SIZE } from './zoom-inspect'
import { type ChromaKeyPreviewState, ChromaKeyPreview } from './chroma-key-preview'

/** 演示场景参数 */
const DEMO_WIDTH = 320
const DEMO_HEIGHT = 240
const DEMO_BLOB_RADIUS = 72
const DEMO_EDGE_SOFTNESS_PX = 4
const DEFAULT_REF_TOLERANCE = 0.06

interface FurPreset {
  readonly label: string
  readonly color: RgbColor
}

const FUR_PRESETS: readonly FurPreset[] = [
  { label: '橙猫', color: FUR_ORANGE },
  { label: '白猫', color: FUR_WHITE },
  { label: '黑猫', color: FUR_BLACK },
  { label: '棕猫', color: FUR_BROWN }
]

const BG_PRESETS: readonly FurPreset[] = [
  { label: '中灰布幕', color: GRAY_BACKGROUND },
  { label: '中蓝布幕', color: BLUE_BACKGROUND }
]

/** 可调参数集合（控件 ↔ 预览状态的单一来源） */
interface DemoParams {
  furIndex: number
  bgIndex: number
  colorSpace: 'ycbcr' | 'hsv'
  tolerance: number
  softness: number
  lumaWeight: number
  refAssistOn: boolean
  refTolerance: number
  spillRange: number
  spillStrength: number
  shrinkRadius: number
  featherRadius: number
  showAlphaMask: boolean
  zoomFactor: number
}

const INITIAL_PARAMS: DemoParams = {
  furIndex: 0,
  bgIndex: 1,
  colorSpace: 'ycbcr',
  tolerance: 0.15,
  softness: 0.3,
  lumaWeight: 0,
  refAssistOn: false,
  refTolerance: DEFAULT_REF_TOLERANCE,
  spillRange: 0.3,
  spillStrength: 1,
  shrinkRadius: 1,
  featherRadius: 1,
  showAlphaMask: false,
  zoomFactor: DEFAULT_ZOOM_FACTOR
}

let styleInjected = false

/**
 * 挂载合成演示：控件面板 + ChromaKeyPreview。
 *
 * @param container 宿主元素
 * @returns 预览实例（update() 可换成真实视频帧数据）
 */
export function mountChromaKeyPreviewDemo(container: HTMLElement): ChromaKeyPreview {
  const params: DemoParams = { ...INITIAL_PARAMS }

  injectDemoStyle()
  document.body.style.background = '#1e2128'
  container.innerHTML = ''

  const controls = document.createElement('div')
  controls.className = 'ckd-controls'
  const stage = document.createElement('div')
  container.appendChild(controls)
  container.appendChild(stage)

  let scene: SyntheticKeyingScene = createScene(params)
  // 初始检查点放在团块右缘（软边正中，§5.5 质量悬崖所在）
  const inspect: ChromaKeyPreviewState['inspect'] = {
    x: Math.floor(DEMO_WIDTH / 2) + DEMO_BLOB_RADIUS,
    y: Math.floor(DEMO_HEIGHT * 0.55)
  }
  const preview = new ChromaKeyPreview(stage, {
    source: scene.frame,
    referenceFrame: scene.reference,
    referenceAssist: null,
    key: { referenceColor: BG_PRESETS[params.bgIndex].color },
    edge: {},
    showAlphaMask: params.showAlphaMask,
    inspect,
    zoomFactor: params.zoomFactor,
    zoomSize: DEFAULT_ZOOM_SOURCE_SIZE
  })

  /** 应用当前参数到预览（场景仅在毛色/背景变化时重建） */
  const apply = (rebuildScene: boolean): void => {
    if (rebuildScene) {
      scene = createScene(params)
    }
    preview.update({
      source: scene.frame,
      referenceFrame: scene.reference,
      referenceAssist: params.refAssistOn
        ? { tolerance: params.refTolerance, softness: 0.3, influence: 1 }
        : null,
      key: {
        referenceColor: BG_PRESETS[params.bgIndex].color,
        colorSpace: params.colorSpace,
        tolerance: params.tolerance,
        softness: params.softness,
        lumaWeight: params.lumaWeight
      },
      edge: {
        spillRange: params.spillRange,
        spillStrength: params.spillStrength,
        shrinkRadius: params.shrinkRadius,
        featherRadius: params.featherRadius
      },
      showAlphaMask: params.showAlphaMask,
      zoomFactor: params.zoomFactor
    })
  }

  buildControls(controls, params, apply)
  apply(false)
  return preview
}

function createScene(params: DemoParams): SyntheticKeyingScene {
  return createFurBlobScene({
    width: DEMO_WIDTH,
    height: DEMO_HEIGHT,
    background: BG_PRESETS[params.bgIndex].color,
    furColor: FUR_PRESETS[params.furIndex].color,
    radiusX: DEMO_BLOB_RADIUS,
    radiusY: DEMO_BLOB_RADIUS,
    centerX: Math.floor(DEMO_WIDTH / 2),
    centerY: Math.floor(DEMO_HEIGHT * 0.55),
    edgeSoftnessPx: DEMO_EDGE_SOFTNESS_PX,
    noiseLevel: 3,
    furJitter: 12,
    seed: 7
  })
}

function buildControls(
  root: HTMLElement,
  params: DemoParams,
  apply: (rebuildScene: boolean) => void
): void {
  const addRow = (element: HTMLElement): void => {
    const row = document.createElement('div')
    row.className = 'ckd-row'
    row.appendChild(element)
    root.appendChild(row)
  }

  addRow(
    makeSelect('毛色', FUR_PRESETS.map((p) => p.label), params.furIndex, (index) => {
      params.furIndex = index
      apply(true)
    })
  )
  addRow(
    makeSelect('背景', BG_PRESETS.map((p) => p.label), params.bgIndex, (index) => {
      params.bgIndex = index
      apply(true)
    })
  )
  addRow(
    makeSelect(
      '色键空间',
      ['YCbCr', 'HSV'],
      params.colorSpace === 'hsv' ? 1 : 0,
      (index) => {
        params.colorSpace = index === 1 ? 'hsv' : 'ycbcr'
        apply(false)
      }
    )
  )
  addRow(
    makeSlider('容差 tolerance', 0, 0.6, 0.01, params.tolerance, (value) => {
      params.tolerance = value
      apply(false)
    })
  )
  addRow(
    makeSlider('软边 softness', 0, 1, 0.05, params.softness, (value) => {
      params.softness = value
      apply(false)
    })
  )
  addRow(
    makeSlider('亮度权重（灰幕需 >0）', 0, 2, 0.05, params.lumaWeight, (value) => {
      params.lumaWeight = value
      apply(false)
    })
  )
  addRow(
    makeCheckbox('背景参考帧减除辅助', params.refAssistOn, (checked) => {
      params.refAssistOn = checked
      apply(false)
    })
  )
  addRow(
    makeSlider('帧差容差', 0.01, 0.3, 0.01, params.refTolerance, (value) => {
      params.refTolerance = value
      apply(false)
    })
  )
  addRow(
    makeSlider('溢色抑制范围', 0, 1, 0.05, params.spillRange, (value) => {
      params.spillRange = value
      apply(false)
    })
  )
  addRow(
    makeSlider('溢色抑制强度', 0, 1, 0.05, params.spillStrength, (value) => {
      params.spillStrength = value
      apply(false)
    })
  )
  addRow(
    makeSlider('alpha 收缩半径 (px)', 0, 3, 1, params.shrinkRadius, (value) => {
      params.shrinkRadius = value
      apply(false)
    })
  )
  addRow(
    makeSlider('alpha 羽化半径 (px)', 0, 3, 1, params.featherRadius, (value) => {
      params.featherRadius = value
      apply(false)
    })
  )
  addRow(
    makeCheckbox('放大面板显示 alpha 蒙版', params.showAlphaMask, (checked) => {
      params.showAlphaMask = checked
      apply(false)
    })
  )
  addRow(
    makeSlider('放大倍率', 2, 16, 1, params.zoomFactor, (value) => {
      params.zoomFactor = value
      apply(false)
    })
  )
}

function makeSelect(
  label: string,
  options: readonly string[],
  selectedIndex: number,
  onChange: (index: number) => void
): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'ckd-control'
  const caption = document.createElement('span')
  caption.textContent = label
  const select = document.createElement('select')
  options.forEach((text, index) => {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = text
    if (index === selectedIndex) {
      option.selected = true
    }
    select.appendChild(option)
  })
  select.addEventListener('change', () => {
    onChange(Number(select.value))
  })
  wrap.appendChild(caption)
  wrap.appendChild(select)
  return wrap
}

function makeSlider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (value: number) => void
): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'ckd-control'
  const caption = document.createElement('span')
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  const format = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2))
  caption.textContent = `${label} = ${format(value)}`
  input.addEventListener('input', () => {
    const v = Number(input.value)
    caption.textContent = `${label} = ${format(v)}`
    onChange(v)
  })
  wrap.appendChild(caption)
  wrap.appendChild(input)
  return wrap
}

function makeCheckbox(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void
): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'ckd-control'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  input.addEventListener('change', () => {
    onChange(input.checked)
  })
  const caption = document.createElement('span')
  caption.textContent = label
  wrap.appendChild(input)
  wrap.appendChild(caption)
  return wrap
}

function injectDemoStyle(): void {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
.ckd-controls { display: flex; flex-wrap: wrap; gap: 10px 18px; padding: 12px;
  background: #262a33; color: #d8dce4; font: 12px/1.6 system-ui, sans-serif;
  border-radius: 8px; margin-bottom: 12px; }
.ckd-row { flex: 0 0 auto; }
.ckd-control { display: flex; align-items: center; gap: 8px; }
.ckd-control span { white-space: nowrap; }
.ckd-control select { background: #1a1d24; color: #d8dce4; border: 1px solid #3a3f4a;
  border-radius: 4px; padding: 2px 6px; }
.ckp-root { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.ckp-panel { background: #262a33; border-radius: 8px; padding: 8px; }
.ckp-caption { color: #9aa1ad; font: 11px/1.4 system-ui, sans-serif; margin-bottom: 6px; }
.ckp-canvas { display: block; border: 1px solid #3a3f4a; border-radius: 4px;
  image-rendering: pixelated; max-width: 420px; height: auto; cursor: crosshair; }
.ckp-zoom .ckp-canvas { cursor: default; }
`
  document.head.appendChild(style)
}
