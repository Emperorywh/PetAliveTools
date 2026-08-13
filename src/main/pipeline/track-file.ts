/**
 * 位移曲线文件 I/O (§5.3、§12.1)
 *
 * 行走片段的逐帧位移曲线存为 `<clip_id>.track.json`，
 * 位于项目目录 clips/ 下（§12.1），由运行时空间层读取 (§7.2)。
 *
 * 运行于主进程。
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { TrackFile } from '../../shared/types/track-file'
import { validateTrackFile } from '../../shared/schemas'

/** track.json 文件名：<clip_id>.track.json (§5.3) */
export function trackFileName(clipId: string): string {
  return `${clipId}.track.json`
}

/**
 * 写入位移曲线文件（写前验证）。
 *
 * @param clipsDir 项目 clips/ 目录（§12.1）
 * @param clipId 片段 id
 * @param track 位移曲线数据
 * @returns 写入的文件绝对/相对路径
 */
export async function writeTrackFile(
  clipsDir: string,
  clipId: string,
  track: TrackFile
): Promise<string> {
  const errors = validateTrackFile(track)
  if (errors.length > 0) {
    throw new Error(`Cannot write invalid track file:\n  ${errors.join('\n  ')}`)
  }

  await fs.mkdir(clipsDir, { recursive: true })
  const filePath = path.join(clipsDir, trackFileName(clipId))
  await fs.writeFile(filePath, JSON.stringify(track, null, 2), 'utf-8')
  return filePath
}

/**
 * 读取并验证位移曲线文件。
 *
 * @param clipsDir 项目 clips/ 目录
 * @param fileName track.json 文件名（如 "walk_right_01.track.json"）
 * @throws 文件不存在、JSON 解析失败或验证失败
 */
export async function readTrackFile(clipsDir: string, fileName: string): Promise<TrackFile> {
  const raw: unknown = JSON.parse(await fs.readFile(path.join(clipsDir, fileName), 'utf-8'))
  const errors = validateTrackFile(raw)
  if (errors.length > 0) {
    throw new Error(`Invalid track file "${fileName}":\n  ${errors.join('\n  ')}`)
  }
  return raw as TrackFile
}
