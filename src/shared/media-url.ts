/**
 * 本地媒体自定义协议 URL 构建 (petmedia://)
 *
 * dev 模式下渲染页面来自 Vite dev server（http 源），Chromium 禁止
 * http 源页面加载 file:// 子资源；生产模式（file 源）虽可用 file://，
 * 为统一两种模式的加载路径，本地媒体一律通过 petmedia:// 特权协议
 * 提供（主进程 media-protocol.ts 将 scheme 映射到磁盘文件，
 * 支持 Range 流式播放）。
 *
 * 主进程与渲染进程共用（纯字符串构建，无平台依赖）。
 */

/** 自定义媒体协议名 */
export const MEDIA_SCHEME = 'petmedia'

/** petmedia URL 的占位 host（standard scheme 须有非空 host） */
const MEDIA_HOST = 'local'

/**
 * 本地绝对路径 → petmedia:// URL。
 *
 * 路径逐段 percent-encode，兼容中文/空格等特殊字符；
 * Windows 反斜杠归一为 `/`。
 */
export function localPathToMediaUrl(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encoded}`
}

/** 判断字符串是否为带协议的绝对 URL（如 petmedia:// 、file://） */
export function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
}
