/**
 * 导入流程状态机 (§5.5)
 *
 * 管理单段片段的导入向导状态：从选视频到转码入库，
 * 各步骤积累的数据用于最终构建 ClipMeta + 转码请求。
 *
 * 步骤顺序 (§5.5)：
 *   select-video → background-reference → keying-preview → crop-loop
 *     → [walk-tracking（仅行走类）] → metadata → transcode-save
 *
 * 纯状态机 + 纯构建函数，无平台依赖；渲染层向导 UI 驱动此状态机，
 * 集成测试直接调用状态转移与元数据构建。
 */

import type {
  ClipMeta,
  ClipCategory,
  ClipDirection,
  ClipAnchor,
  Hitbox,
} from '../types/clip-meta'
import type { RgbColor } from './frame'
import type { TrackFile } from '../types/track-file'
import type { ShootingListItem } from './shooting-list'

// ── 步骤定义 ── //

/** 导入流程步骤 (§5.5) */
export type ImportStep =
  | 'select-video'
  | 'background-reference'
  | 'keying-preview'
  | 'crop-loop'
  | 'walk-tracking'
  | 'metadata'
  | 'transcode-save'

/** 完整步骤序列（行走类含 walk-tracking） */
const FULL_STEPS: readonly ImportStep[] = [
  'select-video',
  'background-reference',
  'keying-preview',
  'crop-loop',
  'metadata',
  'transcode-save',
]

/** 行走类步骤序列（插入 walk-tracking） */
const WALK_STEPS: readonly ImportStep[] = [
  'select-video',
  'background-reference',
  'keying-preview',
  'crop-loop',
  'walk-tracking',
  'metadata',
  'transcode-save',
]

/**
 * 获取目标条目的步骤序列。
 *
 * 行走类片段多出 walk-tracking 步骤（行走跟踪裁切 + 位移曲线手动校正，§5.3）。
 */
export function getStepSequence(isWalk: boolean): readonly ImportStep[] {
  return isWalk ? WALK_STEPS : FULL_STEPS
}

// ── 流程数据 ── //

/** 各步骤积累的流程数据 */
export interface ImportFlowData {
  // select-video
  videoPath: string | null
  videoWidth: number
  videoHeight: number
  videoDurationSec: number

  // background-reference
  referenceColor: RgbColor | null

  // keying-preview
  keyingTolerance: number
  keyingSoftness: number
  keyingLumaWeight: number

  // crop-loop
  trimStartSec: number | null
  trimEndSec: number | null
  loopInSec: number | null
  loopOutSec: number | null

  // walk-tracking
  trackFile: TrackFile | null
  moveStartSec: number | null
  moveEndSec: number | null

  // metadata
  clipId: string
  variant: number
  direction: ClipDirection
  signature: boolean
  prop: boolean
  embeddedAudio: boolean
  audio: string | null
  scaleHint: number
  hitbox: Hitbox
}

/** 流程状态 */
export interface ImportFlowState {
  /** 目标清单条目 */
  readonly targetItem: ShootingListItem
  /** 当前步骤 */
  readonly step: ImportStep
  /** 步骤序列（含/不含 walk-tracking） */
  readonly steps: readonly ImportStep[]
  /** 是否行走类 */
  readonly isWalk: boolean
  /** 积累数据 */
  readonly data: ImportFlowData
}

// ── 步骤显示信息 ── //

export interface StepInfo {
  readonly step: ImportStep
  readonly label: string
  readonly description: string
}

const STEP_INFOS: Readonly<Record<ImportStep, StepInfo>> = {
  'select-video': {
    step: 'select-video',
    label: '选择视频',
    description: '选择待导入的原始视频文件',
  },
  'background-reference': {
    step: 'background-reference',
    label: '背景参考色',
    description: '圈选背景参考色或选择参考帧',
  },
  'keying-preview': {
    step: 'keying-preview',
    label: '抠像预览',
    description: '色键抠像预览 + 边缘放大检查',
  },
  'crop-loop': {
    step: 'crop-loop',
    label: '裁剪 / 标 loop',
    description: '裁掉首尾准备动作；循环片段标注 loop 入/出点',
  },
  'walk-tracking': {
    step: 'walk-tracking',
    label: '行走跟踪校正',
    description: '行走跟踪裁切 + 位移曲线手动校正 (§5.3)',
  },
  metadata: {
    step: 'metadata',
    label: '填写标签',
    description: '填打标信息：方向 / 招牌 / 道具 / 音频等',
  },
  'transcode-save': {
    step: 'transcode-save',
    label: '转码入库',
    description: '转码为 WebM-alpha 并保存到项目 clips 目录',
  },
}

export function getStepInfo(step: ImportStep): StepInfo {
  return STEP_INFOS[step]
}

// ── 默认值 ── //

const DEFAULT_HITBOX: Hitbox = [0.1, 0.05, 0.8, 0.9]

function defaultFlowData(itemId: string, variant: number): ImportFlowData {
  return {
    videoPath: null,
    videoWidth: 0,
    videoHeight: 0,
    videoDurationSec: 0,
    referenceColor: null,
    keyingTolerance: 0.15,
    keyingSoftness: 0.3,
    keyingLumaWeight: 0,
    trimStartSec: null,
    trimEndSec: null,
    loopInSec: null,
    loopOutSec: null,
    trackFile: null,
    moveStartSec: null,
    moveEndSec: null,
    clipId: itemId,
    variant,
    direction: 'none',
    signature: false,
    prop: false,
    embeddedAudio: false,
    audio: null,
    scaleHint: 1.0,
    hitbox: DEFAULT_HITBOX,
  }
}

// ── 状态机创建与转移 ── //

/**
 * 创建导入流程初始状态。
 *
 * @param targetItem 目标清单条目
 * @param variant 变体编号（从 1 起）
 */
export function createImportFlow(
  targetItem: ShootingListItem,
  variant: number,
): ImportFlowState {
  const isWalk = targetItem.isWalk
  const steps = getStepSequence(isWalk)
  const baseId = `${targetItem.state}_${String(variant).padStart(2, '0')}`
  return {
    targetItem,
    step: steps[0],
    steps,
    isWalk,
    data: defaultFlowData(baseId, variant),
  }
}

/**
 * 更新流程数据（部分更新）。
 */
export function updateData(
  state: ImportFlowState,
  partial: Partial<ImportFlowData>,
): ImportFlowState {
  return {
    ...state,
    data: { ...state.data, ...partial },
  }
}

/**
 * 前进到下一步骤。
 *
 * 先用 validateStep 校验当前步骤数据完整性；
 * 校验失败时返回错误信息（不改变状态）。
 *
 * @returns 成功返回新状态，失败返回 `{ error: string }`
 */
export function advance(
  state: ImportFlowState,
): ImportFlowState | { error: string } {
  const validation = validateStep(state)
  if (!validation.ok) {
    return { error: validation.error }
  }

  const currentIdx = state.steps.indexOf(state.step)
  if (currentIdx < 0 || currentIdx >= state.steps.length - 1) {
    return { error: '已到达最后一步' }
  }

  return { ...state, step: state.steps[currentIdx + 1] }
}

/**
 * 后退到上一步骤。
 */
export function retreat(state: ImportFlowState): ImportFlowState {
  const currentIdx = state.steps.indexOf(state.step)
  if (currentIdx <= 0) return state
  return { ...state, step: state.steps[currentIdx - 1] }
}

/**
 * 跳转到指定步骤（仅允许跳到已完成或当前步骤）。
 */
export function jumpTo(
  state: ImportFlowState,
  step: ImportStep,
): ImportFlowState {
  if (!state.steps.includes(step)) return state
  return { ...state, step }
}

/**
 * 当前是否为最后一步。
 */
export function isLastStep(state: ImportFlowState): boolean {
  return state.step === state.steps[state.steps.length - 1]
}

/**
 * 当前步骤索引（0 起）。
 */
export function currentStepIndex(state: ImportFlowState): number {
  return state.steps.indexOf(state.step)
}

// ── 步骤校验 ── //

interface StepValidation {
  readonly ok: boolean
  readonly error: string
}

/**
 * 校验当前步骤的数据完整性。
 *
 * 只有数据完整的步骤才能前进，保证流程中不会遗漏必需信息。
 */
export function validateStep(state: ImportFlowState): StepValidation {
  const { data } = state
  switch (state.step) {
    case 'select-video':
      if (!data.videoPath) {
        return { ok: false, error: '请先选择视频文件' }
      }
      if (data.videoWidth <= 0 || data.videoHeight <= 0) {
        return { ok: false, error: '无法读取视频尺寸' }
      }
      return { ok: true, error: '' }

    case 'background-reference':
      if (!data.referenceColor) {
        return { ok: false, error: '请选择背景参考色' }
      }
      return { ok: true, error: '' }

    case 'keying-preview':
      if (data.keyingTolerance <= 0 || data.keyingTolerance > 1) {
        return { ok: false, error: '容差阈值须在 (0, 1] 范围内' }
      }
      return { ok: true, error: '' }

    case 'crop-loop':
      // 循环片段需要 loop 入/出点
      if (state.targetItem.loop) {
        if (data.loopInSec === null || data.loopOutSec === null) {
          return { ok: false, error: '循环片段需要标注 loop 入/出点' }
        }
        if (data.loopInSec >= data.loopOutSec) {
          return { ok: false, error: 'loop 入点必须早于出点' }
        }
      }
      // trim 范围校验
      if (
        data.trimStartSec !== null &&
        data.trimEndSec !== null &&
        data.trimStartSec >= data.trimEndSec
      ) {
        return { ok: false, error: '裁剪起点必须早于终点' }
      }
      return { ok: true, error: '' }

    case 'walk-tracking':
      if (!data.trackFile) {
        return { ok: false, error: '行走跟踪数据缺失' }
      }
      if (data.moveStartSec === null || data.moveEndSec === null) {
        return { ok: false, error: '请标注行走子段边界' }
      }
      if (data.moveStartSec >= data.moveEndSec) {
        return { ok: false, error: '行走子段起点必须早于终点' }
      }
      return { ok: true, error: '' }

    case 'metadata':
      if (!data.clipId) {
        return { ok: false, error: '片段 id 不能为空' }
      }
      if (data.scaleHint <= 0) {
        return { ok: false, error: '尺度系数必须为正数' }
      }
      return { ok: true, error: '' }

    case 'transcode-save':
      return { ok: true, error: '' }
  }
}

// ── ClipMeta 构建 ── //

/**
 * 从流程状态构建 ClipMeta (§5.4)。
 *
 * 把各步骤积累的数据组装为完整的片段元数据，
 * 行走类片段额外包含 moveStartSec / moveEndSec / track。
 *
 * @param state 流程状态（应已完成到 metadata 步骤）
 * @returns ClipMeta 对象
 * @throws 缺少必需数据时抛出
 */
export function buildClipMeta(state: ImportFlowState): ClipMeta {
  const { targetItem, data } = state
  const category: ClipCategory = categoryFromShooting(targetItem.category)
  const anchor: ClipAnchor = targetItem.anchor

  const clip: ClipMeta = {
    id: data.clipId,
    state: targetItem.state,
    category,
    direction: data.direction,
    anchor,
    loop: targetItem.loop,
    loopInSec: data.loopInSec,
    loopOutSec: data.loopOutSec,
    signature: data.signature,
    variant: data.variant,
    prop: data.prop,
    embeddedAudio: data.embeddedAudio,
    audio: data.audio,
    scaleHint: data.scaleHint,
    hitbox: data.hitbox,
  }

  // 行走类片段额外字段 (§5.3, §7.2)
  if (targetItem.isWalk && data.trackFile) {
    return {
      ...clip,
      moveStartSec: data.moveStartSec ?? undefined,
      moveEndSec: data.moveEndSec ?? undefined,
      track: `${data.clipId}.track.json`,
    }
  }

  return clip
}

/**
 * 将 ShootingCategory (§4.4 A/B/C/D) 映射为 ClipCategory (§5.4)。
 */
function categoryFromShooting(shooting: string): ClipCategory {
  // 使用 shooting-list.ts 的映射，但避免循环导入
  const map: Record<string, ClipCategory> = {
    A: 'basic',
    B: 'interactive',
    C: 'signature',
    D: 'emotion',
  }
  return map[shooting] ?? 'basic'
}

// ── 转码请求构建 ── //

/** 转码请求数据（跨 IPC 边界的序列化结构） */
export interface ImportTranscodeRequest {
  readonly clipId: string
  readonly inputPath: string
  readonly srcWidth: number
  readonly srcHeight: number
  readonly scaleHint: number
  readonly trimStartSec?: number
  readonly trimEndSec?: number
  /** 保留内嵌音轨 (§4.8 embeddedAudio, IR-010)：默认剥除音轨 */
  readonly keepAudio?: boolean
  /** 色键参数（主进程 ffmpeg chromakey 滤镜） */
  readonly chromaKey?: {
    readonly referenceColor: RgbColor
    readonly tolerance: number
    readonly softness: number
  }
}

/**
 * 从流程状态构建转码请求。
 */
export function buildTranscodeRequest(
  state: ImportFlowState,
): ImportTranscodeRequest {
  const { data } = state
  const trimStartSec = data.trimStartSec !== null ? data.trimStartSec : undefined
  const trimEndSec = data.trimEndSec !== null ? data.trimEndSec : undefined
  const chromaKey = data.referenceColor
    ? {
        referenceColor: data.referenceColor,
        tolerance: data.keyingTolerance,
        softness: data.keyingSoftness,
      }
    : undefined

  return {
    clipId: data.clipId,
    inputPath: data.videoPath ?? '',
    srcWidth: data.videoWidth,
    srcHeight: data.videoHeight,
    scaleHint: data.scaleHint,
    trimStartSec,
    trimEndSec,
    // §4.8：embeddedAudio 片段转码时保留内嵌音轨 (IR-010)
    keepAudio: data.embeddedAudio,
    chromaKey,
  }
}

// ── 便捷工厂 ── //

/**
 * 生成片段 id：`<state>_<variant_padded>`。
 */
export function makeClipId(state: string, variant: number): string {
  return `${state}_${String(variant).padStart(2, '0')}`
}
