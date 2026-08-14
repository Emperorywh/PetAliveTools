/**
 * 原样视频片段的命名与运行时映射。
 *
 * 本模块只处理文件名字符串，不读取、解码或改写视频内容。
 * 导入后的文件采用 `<state>__<direction>__<variant>.<ext>` 命名，
 * 因而项目重启后可直接扫描 clips/，无需 clips.meta.json。
 */

import type { ClipCategory, ClipDirection, ClipMeta } from './types/clip-meta'
import {
  SHOOTING_LIST,
  findItemByState,
  type ShootingCategory,
} from './shooting-list'

/**
 * Electron/Chromium 直接播放路径允许导入的容器扩展名。
 * 实际编解码能力由当前 Electron 版本决定，程序不会尝试转码兜底。
 */
export const DIRECT_VIDEO_EXTENSIONS = [
  '.webm',
  '.mp4',
  '.m4v',
  '.mov',
  '.ogv',
  '.ogg',
] as const

/**
 * 渲染进程提交给主进程的直接导入请求。
 * sourcePath 对应的文件只会被逐字节复制到项目 clips/ 目录。
 */
export interface DirectClipImportRequest {
  readonly sourcePath: string
  readonly state: string
  readonly direction: ClipDirection
}

/**
 * 主进程完成原样复制后返回的最小结果。
 * fileName 是项目内实际播放的文件名。
 */
export interface DirectClipImportResult {
  readonly clipId: string
  readonly fileName: string
  readonly clipsCount: number
}

/**
 * 主进程删除片段后返回的最小结果。
 * clipsCount 是删除后 clips/ 内可识别片段的总数。
 */
export interface DirectClipDeleteResult {
  readonly clipsCount: number
}

/**
 * 返回路径中的小写扩展名。
 * 这里只做字符串解析，避免共享层依赖 Node.js path 模块。
 */
export function videoExtension(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot).toLowerCase() : ''
}

/**
 * 判断文件是否属于允许直接播放的容器。
 * 不做内容探测，因为内容探测本身也不应成为导入处理步骤。
 */
export function isDirectVideoFile(filePath: string): boolean {
  return (DIRECT_VIDEO_EXTENSIONS as readonly string[]).includes(videoExtension(filePath))
}

/**
 * 构造项目内片段文件名。
 * 扩展名来自源文件，视频字节保持不变。
 */
export function makeDirectClipFileName(
  state: string,
  direction: ClipDirection,
  variant: number,
  extension: string,
): string {
  if (!findItemByState(state)) throw new Error(`未知动作状态: ${state}`)
  if (!['left', 'right', 'none'].includes(direction)) throw new Error(`未知片段方向: ${direction}`)
  if (!Number.isInteger(variant) || variant < 1) throw new Error(`片段序号无效: ${variant}`)
  if (!(DIRECT_VIDEO_EXTENSIONS as readonly string[]).includes(extension.toLowerCase())) {
    throw new Error(`不支持直接播放的视频扩展名: ${extension}`)
  }
  return `${state}__${direction}__${String(variant).padStart(2, '0')}${extension.toLowerCase()}`
}

/**
 * 从 clips/ 文件名推导运行时片段描述。
 * 新命名格式优先；同时兼容旧的 `state_direction_01.webm` 文件名。
 */
export function clipFromFileName(fileName: string): ClipMeta | null {
  if (!isDirectVideoFile(fileName)) return null
  const extension = videoExtension(fileName)
  const stem = fileName.slice(0, -extension.length)
  const parsed = parseNewName(stem) ?? parseLegacyName(stem)
  if (!parsed) return null

  const item = findItemByState(parsed.state)
  if (!item) return null
  return {
    id: stem,
    fileName,
    state: item.state,
    category: categoryFromShooting(item.category),
    direction: parsed.direction,
    anchor: item.anchor,
    loop: item.loop,
    signature: item.category === 'C',
    variant: parsed.variant,
    prop: false,
    embeddedAudio: true,
    audio: null,
    hitbox: [0.1, 0.05, 0.8, 0.9],
  }
}

/**
 * 根据现有文件计算下一个变体编号。
 * 无法识别的文件不会参与编号，但仍可保留在 clips/ 中。
 */
export function nextDirectClipVariant(
  fileNames: readonly string[],
  state: string,
  direction: ClipDirection,
): number {
  let maxVariant = 0
  for (const fileName of fileNames) {
    const clip = clipFromFileName(fileName)
    if (clip?.state === state && clip.direction === direction) {
      maxVariant = Math.max(maxVariant, clip.variant)
    }
  }
  return maxVariant + 1
}

/**
 * 解析当前直接导入命名格式。
 * 严格校验状态、方向和正整数变体编号。
 */
function parseNewName(
  stem: string,
): { state: string; direction: ClipDirection; variant: number } | null {
  const match = /^(.+)__(left|right|none)__(\d+)$/.exec(stem)
  if (!match) return null
  const state = match[1]!
  const direction = match[2] as ClipDirection
  const variant = Number.parseInt(match[3]!, 10)
  if (!findItemByState(state) || variant < 1) return null
  return { state, direction, variant }
}

/**
 * 兼容旧项目中常见的 `walk_right_01` 命名。
 * 状态按最长前缀匹配，避免 idle_sit 之类下划线状态被误拆。
 */
function parseLegacyName(
  stem: string,
): { state: string; direction: ClipDirection; variant: number } | null {
  const item = [...SHOOTING_LIST]
    .sort((a, b) => b.state.length - a.state.length)
    .find((candidate) => stem === candidate.state || stem.startsWith(`${candidate.state}_`))
  if (!item) return null
  const directionMatch = /(?:^|_)(left|right)(?:_|$)/.exec(stem)
  const variantMatch = /_(\d+)$/.exec(stem)
  return {
    state: item.state,
    direction: (directionMatch?.[1] as ClipDirection | undefined) ?? 'none',
    variant: variantMatch ? Math.max(1, Number.parseInt(variantMatch[1]!, 10)) : 1,
  }
}

/**
 * 将动作清单分组映射为行为调度使用的类别。
 * 该映射只存在于内存中，不会写回视频或额外元数据文件。
 */
function categoryFromShooting(category: ShootingCategory): ClipCategory {
  const map: Record<ShootingCategory, ClipCategory> = {
    A: 'basic',
    B: 'interactive',
    C: 'signature',
    D: 'emotion',
  }
  return map[category]
}
