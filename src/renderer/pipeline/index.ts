/**
 * 采集入库管线的渲染进程侧模块 (pipeline / renderer)
 *
 * 负责：色键抠像预览与边缘放大检查、行走跟踪裁切与位移曲线手动校正
 * （§5.5 导入 UI 的质量闸门内核）。色键与跟踪运算复用 src/shared/pipeline
 * 内核，保证预览与主进程转码一致。
 *
 * 运行于渲染进程。完整清单引导式导入 UI 由 TASK-008 实现。
 */

export {
  type ChromaKeyPreviewState,
  ChromaKeyPreview
} from './chroma-key-preview'
export { mountChromaKeyPreviewDemo } from './chroma-key-demo'
export {
  type ZoomRect,
  DEFAULT_ZOOM_FACTOR,
  DEFAULT_ZOOM_SOURCE_SIZE,
  computeZoomRect
} from './zoom-inspect'
export {
  type WalkCorrectionState,
  type WalkCorrectionOptions,
  WalkCorrectionView
} from './walk-correction'
export { mountWalkCorrectionDemo } from './walk-correction-demo'
