/**
 * 采集入库管线共享内核 (pipeline)
 *
 * 纯像素/纯计算内核（帧容器、颜色空间、色键、边缘处理、行走跟踪、
 * 跟踪裁切、位移曲线、合成测试帧）。无平台依赖：主进程批量转码管线
 * （TASK-007）与渲染进程导入预览（§5.5）共用，保证预览所见即转码所得。
 *
 * 参见 SPEC §5.1（色键抠像）、§5.3（行走跟踪裁切与位移曲线）、
 * §5.5（导入预览）、§4.1（采集背景规范）。
 */

export {
  type RgbColor,
  type RawFrame,
  createFrame,
  cloneFrame,
  assertSameDimensions,
  getPixel,
  setPixel
} from './frame'
export {
  type YcbcrColor,
  type HsvColor,
  HSV_ACHROMATIC_THRESHOLD,
  rgbToYcbcr,
  rgbToHsv,
  rgbLuma,
  hueDistance,
  ycbcrDistance,
  ycbcrDistancePrecomputed,
  hsvDistance,
  hsvDistancePrecomputed,
  rgbDistance,
  ramp01
} from './color-space'
export {
  type KeyColorSpace,
  type ReferenceFrameAssist,
  type ChromaKeyOptions,
  type AlphaMask,
  type KeyedFrame,
  type KeyingPipelineOptions,
  DEFAULT_TOLERANCE,
  DEFAULT_SOFTNESS,
  DEFAULT_LUMA_WEIGHT,
  generateAlphaMask,
  applyChromaKey
} from './chroma-key'
export {
  type EdgeProcessingOptions,
  DEFAULT_SPILL_RANGE,
  DEFAULT_SPILL_STRENGTH,
  DEFAULT_SHRINK_RADIUS,
  DEFAULT_FEATHER_RADIUS,
  suppressSpill,
  shrinkAlpha,
  featherAlpha
} from './edge-processing'
export {
  GRAY_BACKGROUND,
  BLUE_BACKGROUND,
  FUR_ORANGE,
  FUR_WHITE,
  FUR_BLACK,
  FUR_BROWN,
  type FurBlobSceneOptions,
  type SyntheticKeyingScene,
  createFurBlobScene,
  createSolidFrame
} from './synthetic-frame'
export {
  type TrackableAlpha,
  type WalkFrameTrack,
  type WalkTrackerOptions,
  DEFAULT_ALPHA_THRESHOLD,
  DEFAULT_SMOOTHING_RADIUS,
  DEFAULT_FOOT_ROW_COVERAGE,
  trackWalkFrame,
  trackWalkFrames
} from './walk-tracker'
export {
  type TrackCropOptions,
  type TrackCropRect,
  computeTrackCropRects,
  cropFrame
} from './track-crop'
export {
  type MoveSegment,
  type MoveSegmentDetectOptions,
  DEFAULT_SPEED_THRESHOLD,
  generateDisplacementCurve,
  applyKeypointCorrections,
  detectMoveSegment,
  frameToSec
} from './displacement-curve'
export {
  type TranscodePresetName,
  type ResolutionTier,
  type TranscodePreset,
  type ResolutionPreset,
  TRANSCODE_PRESETS,
  RESOLUTION_PRESETS,
  TARGET_FPS,
  PIXEL_FORMAT,
  VIDEO_CODEC,
  recommendPreset,
  computeTargetEdge,
  computeScaleDimensions
} from './presets'
