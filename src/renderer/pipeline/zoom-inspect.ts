/**
 * 边缘放大检查的取景计算 (§5.5)
 *
 * 抠像质量悬崖（半透明绒毛）靠肉眼在整帧上看不出来，需要在边缘
 * 处放大逐像素检查。本模块为纯函数，计算"以检查点为中心的放大取景框"，
 * 边界处自动平移夹取（clamp）到图像内。
 */

/** 放大取景框（源图像像素坐标） */
export interface ZoomRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export const DEFAULT_ZOOM_FACTOR = 8
export const DEFAULT_ZOOM_SOURCE_SIZE = 49

/**
 * 计算以 (inspectX, inspectY) 为中心的方形取景框。
 *
 * @param inspectX 检查点 x（源图像像素坐标）
 * @param inspectY 检查点 y（源图像像素坐标）
 * @param size 取景框边长（像素，自动取奇数使检查点居中；大于图像时退化为整帧）
 * @param imageWidth 源图像宽
 * @param imageHeight 源图像高
 */
export function computeZoomRect(
  inspectX: number,
  inspectY: number,
  size: number,
  imageWidth: number,
  imageHeight: number
): ZoomRect {
  if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error(`invalid image dimensions: ${imageWidth}x${imageHeight}`)
  }

  // 取奇数边长，检查点落在取景框正中
  const oddSize = size % 2 === 0 ? size + 1 : size
  const w = Math.min(oddSize, imageWidth)
  const h = Math.min(oddSize, imageHeight)

  const half = Math.floor(w / 2)
  const x = Math.min(imageWidth - w, Math.max(0, inspectX - half))
  const y = Math.min(imageHeight - h, Math.max(0, inspectY - half))

  return { x, y, w, h }
}
