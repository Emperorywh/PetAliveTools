/**
 * 尺度归一化 (§7.4)
 *
 * 所有片段入库时把宠物肩高归一化到统一屏幕占比（如屏幕高度的
 * 12–18%，可设置）；scaleHint 记录该片段相对基准的缩放系数，
 * 渲染时统一应用。
 *
 * 入库转码（presets.computeTargetEdge）与运行时渲染（本模块）使用
 * 同一估算模型：片段整体高度 ≈ 肩高 × SHOULDER_HEIGHT_FACTOR。
 * 运行时显示器/分辨率变化后重算（§13），保证肩高占比恒定。
 *
 * 纯计算，无平台依赖。
 */

/**
 * 片段整体高度 ≈ 肩高 × 1.6（含头身尾相对肩高的估算系数）。
 * 入库（presets.computeTargetEdge）与运行时共用，保证两端一致。
 */
export const SHOULDER_HEIGHT_FACTOR = 1.6

/** 默认目标肩高占屏幕高度比例（§7.4 建议 12–18%，取中值，可设置） */
export const DEFAULT_SCREEN_PERCENT = 0.15

/** 尺度归一化输入 */
export interface ScaleNormalizationInput {
  /** 屏幕工作区高度（像素） */
  readonly screenHeightPx: number
  /** 目标肩高占屏幕高度比例 (0–1，如 0.15) */
  readonly screenPercent: number
  /** 片段固有像素高度（转码归一化后的视频高度） */
  readonly clipHeightPx: number
  /** 片段相对基准的缩放系数 (§5.4 scaleHint) */
  readonly scaleHint: number
}

/**
 * 计算渲染缩放系数 (§7.4)。
 *
 * 目标：肩高（≈ clipHeight / SHOULDER_HEIGHT_FACTOR × scale）
 * 占屏幕高度 screenPercent。转码已按入库时屏幕归一化，多数情况
 * scale ≈ scaleHint；显示器/分辨率变化时自动适配（§13）。
 *
 * @returns CSS transform 的 scale 值（> 0）
 */
export function computeNormalizedScale(input: ScaleNormalizationInput): number {
  const { screenHeightPx, screenPercent, clipHeightPx, scaleHint } = input
  if (!Number.isFinite(screenHeightPx) || screenHeightPx <= 0) {
    throw new Error(`invalid screenHeightPx: ${screenHeightPx}`)
  }
  if (!Number.isFinite(screenPercent) || screenPercent <= 0 || screenPercent >= 1) {
    throw new Error(`invalid screenPercent: ${screenPercent} (expected 0–1 exclusive)`)
  }
  if (!Number.isFinite(clipHeightPx) || clipHeightPx <= 0) {
    throw new Error(`invalid clipHeightPx: ${clipHeightPx}`)
  }
  if (!Number.isFinite(scaleHint) || scaleHint <= 0) {
    throw new Error(`invalid scaleHint: ${scaleHint}`)
  }
  return (screenHeightPx * screenPercent * SHOULDER_HEIGHT_FACTOR * scaleHint) / clipHeightPx
}

/**
 * 计算宠物在屏幕上的显示高度（像素），供窗口尺寸包络估算 (§6.1)。
 */
export function displayedClipHeightPx(input: ScaleNormalizationInput): number {
  return computeNormalizedScale(input) * input.clipHeightPx
}
