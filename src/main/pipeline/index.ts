/**
 * 采集入库管线模块 (pipeline)
 *
 * 负责：色键抠像、片段裁剪、行走跟踪裁切、转码 WebM-alpha、清单引导式导入打标。
 * 参见 SPEC §4 (素材采集规范) 与 §5 (抠像与入库管线)。
 *
 * 运行于主进程（需要 ffmpeg 二进制与文件系统访问）。
 *
 * 色键抠像与行走跟踪内核位于 src/shared/pipeline（纯像素运算，无平台依赖），
 * 由本模块重新导出供主进程批量转码管线（TASK-007）使用；渲染进程导入预览
 * （§5.5）直接引用同一内核，保证预览与转码结果一致。位移曲线文件的
 * 读写 (track.json) 由本模块的 track-file 提供 (§12.1)。
 */

export {
  type RgbColor,
  type RawFrame,
  createFrame,
  cloneFrame,
  assertSameDimensions,
  getPixel,
  setPixel,
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
  applyChromaKey,
  type EdgeProcessingOptions,
  DEFAULT_SPILL_RANGE,
  DEFAULT_SPILL_STRENGTH,
  DEFAULT_SHRINK_RADIUS,
  DEFAULT_FEATHER_RADIUS,
  suppressSpill,
  shrinkAlpha,
  featherAlpha,
  type FurBlobSceneOptions,
  type SyntheticKeyingScene,
  createFurBlobScene,
  createSolidFrame
} from '../../shared/pipeline'
export {
  type TrackableAlpha,
  type WalkFrameTrack,
  type WalkTrackerOptions,
  DEFAULT_ALPHA_THRESHOLD,
  DEFAULT_SMOOTHING_RADIUS,
  DEFAULT_FOOT_ROW_COVERAGE,
  trackWalkFrame,
  trackWalkFrames,
  type TrackCropOptions,
  type TrackCropRect,
  computeTrackCropRects,
  cropFrame,
  type MoveSegment,
  type MoveSegmentDetectOptions,
  DEFAULT_SPEED_THRESHOLD,
  generateDisplacementCurve,
  applyKeypointCorrections,
  detectMoveSegment,
  frameToSec
} from '../../shared/pipeline'
export { trackFileName, writeTrackFile, readTrackFile } from './track-file'

// ── 转码 (§5.2, §3.3) ── //
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
} from '../../shared/pipeline/presets'
export {
  type AppInfo,
  type TranscodeOptions,
  type ScaleFilterResult,
  type FfmpegArgs,
  type FfmpegCommand,
  resolveFfmpegPath,
  validateFfmpegBinary,
  buildScaleFilter,
  buildFfmpegArgs,
  buildTranscodeCommand
} from './ffmpeg'
export {
  type TranscodeRequest,
  type TranscodeResult,
  clipFileName,
  buildTranscodeOptions,
  transcodeClip
} from './transcoder'
export {
  type ImportTranscodeOptions,
  type ImportTranscodeResult,
  buildImportTranscodeOptions,
  buildImportFfmpegArgs,
  transcodeImport
} from './import-transcoder'
export {
  IPC,
  registerImportIpcHandlers,
  appendClipToProject
} from './ipc-handlers'
