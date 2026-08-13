/**
 * 采集入库管线模块 (pipeline)
 *
 * 负责：色键抠像、片段裁剪、行走跟踪裁切、转码 WebM-alpha、清单引导式导入打标。
 * 参见 SPEC §4 (素材采集规范) 与 §5 (抠像与入库管线)。
 *
 * 运行于主进程（需要 ffmpeg 二进制与文件系统访问）。
 *
 * 色键抠像内核位于 src/shared/pipeline（纯像素运算，无平台依赖），
 * 由本模块重新导出供主进程批量转码管线（TASK-007）与行走跟踪（TASK-006）使用；
 * 渲染进程抠像预览（§5.5）直接引用同一内核，保证预览与转码结果一致。
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
