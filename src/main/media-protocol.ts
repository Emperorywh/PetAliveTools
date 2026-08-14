/**
 * 本地媒体自定义协议注册 (petmedia://)
 *
 * Chromium 禁止 http 源（dev server）页面加载 file:// 子资源，
 * 宠物窗口的 <video>/<audio> 须经此特权协议读取本地文件：
 * - registerMediaScheme()：声明特权（standard + stream），须在 app ready 前调用
 * - handleMediaProtocol()：建立 scheme → 本地文件映射，在 app ready 后调用
 *
 * 透传 Range 头，媒体元素可拖动进度条/seek。
 * 运行于主进程。
 */

import { net, protocol } from 'electron'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MEDIA_SCHEME } from '../shared/media-url'

/** 允许经 petmedia:// 提供的扩展名白名单（媒体相关，防御性收窄） */
const ALLOWED_EXTENSIONS = new Set([
  '.mp4', '.mov', '.webm', '.m4v', '.ogv', '.ogg',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.weba',
])

/** 声明 petmedia 为特权协议（须在 app ready 前调用） */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/** 建立 petmedia:// → 本地文件映射（app ready 后调用） */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    // petmedia://local/<percent-encoded 绝对路径>
    let filePath: string
    try {
      const { pathname } = new URL(request.url)
      filePath = decodeURIComponent(pathname.replace(/^\//, ''))
    } catch {
      return new Response(null, { status: 400 })
    }
    if (!ALLOWED_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      return new Response(null, { status: 403 })
    }
    const range = request.headers.get('range')
    return net.fetch(pathToFileURL(filePath).href, {
      headers: range ? { Range: range } : undefined,
    })
  })
}
