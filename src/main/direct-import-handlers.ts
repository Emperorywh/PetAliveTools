/**
 * 原样片段导入 IPC。
 *
 * 主进程只校验路径、生成可恢复的动作文件名并调用 fs.copyFile。
 * 它不会读取视频帧、探测时长、抽取音轨或调用任何媒体处理程序。
 */

import { dialog, ipcMain } from 'electron'
import { constants as fsConstants, promises as fs } from 'node:fs'
import * as path from 'node:path'

import {
  clipFromFileName,
  isDirectVideoFile,
  makeDirectClipFileName,
  nextDirectClipVariant,
  videoExtension,
  type DirectClipDeleteResult,
  type DirectClipImportRequest,
  type DirectClipImportResult,
} from '../shared/direct-media'
import type { AudioMeta } from '../shared/types/audio-meta'
import type { ClipMeta } from '../shared/types/clip-meta'
import type { ProjectData } from '../shared/types/project'
import { findItemByState } from '../shared/shooting-list'
import { validateAudioMetaArray } from '../shared/schemas'
import {
  createDefaultPersona,
  createProject,
  getProjectPaths,
  loadDirectClips,
  loadProject,
} from './persistence/project-io'

/**
 * IPC 通道保持 import 前缀，避免外壳调用入口发生无关变化。
 * 旧的 transcode/saveClip/extractAudio 通道已全部移除。
 */
export const DIRECT_IMPORT_IPC = {
  GET_DEFAULT_PROJECT_DIR: 'import:getDefaultProjectDir',
  SELECT_PROJECT: 'import:selectProject',
  CREATE_PROJECT: 'import:createProject',
  LOAD_PROJECT: 'import:loadProject',
  SELECT_CLIP: 'import:selectClip',
  IMPORT_CLIP: 'import:copyClip',
  DELETE_CLIP: 'import:deleteClip',
  PREVIEW_CLIP: 'import:previewClip',
  SELECT_AUDIO: 'import:selectAudio',
  SAVE_AUDIO: 'import:saveAudio',
} as const

/**
 * 导入窗口与运行时之间只保留项目刷新钩子。
 * 文件复制成功后，活跃项目可立即重新扫描 clips/。
 */
export interface DirectImportHooks {
  readonly onClipImported?: (projectDir: string) => void
  readonly getDefaultProjectDir?: () => string | null
  /** 桌面调试预览：让宠物按运行时链路播放该片段；返回错误消息，成功为 null */
  readonly previewClip?: (projectDir: string, fileName: string) => string | null
}

/**
 * 注册直接导入所需的全部 IPC。
 * 所有片段导入最终都委托给 copyClipDirectly，便于测试字节不变性。
 */
export function registerDirectImportIpcHandlers(hooks: DirectImportHooks = {}): void {
  ipcMain.handle(DIRECT_IMPORT_IPC.GET_DEFAULT_PROJECT_DIR, () => {
    return hooks.getDefaultProjectDir?.() ?? null
  })

  ipcMain.handle(DIRECT_IMPORT_IPC.SELECT_PROJECT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择 Pet 项目目录',
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(
    DIRECT_IMPORT_IPC.CREATE_PROJECT,
    async (_event, parentDir: string, petName: string) => {
      const projectDir = path.join(parentDir, petName)
      await createProject(projectDir, createDefaultPersona(petName))
      return projectDir
    },
  )

  ipcMain.handle(DIRECT_IMPORT_IPC.LOAD_PROJECT, async (_event, projectDir: string) => {
    return await loadProject(projectDir)
  })

  ipcMain.handle(DIRECT_IMPORT_IPC.SELECT_CLIP, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '选择已制作完成的视频片段',
      filters: [
        { name: '可直接播放的视频', extensions: ['webm', 'mp4', 'm4v', 'mov', 'ogv', 'ogg'] },
      ],
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(
    DIRECT_IMPORT_IPC.IMPORT_CLIP,
    async (_event, projectDir: string, request: DirectClipImportRequest) => {
      const result = await copyClipDirectly(projectDir, request)
      hooks.onClipImported?.(projectDir)
      return result
    },
  )

  ipcMain.handle(
    DIRECT_IMPORT_IPC.DELETE_CLIP,
    async (_event, projectDir: string, fileName: string) => {
      const result = await deleteClipDirectly(projectDir, fileName)
      hooks.onClipImported?.(projectDir)
      return result
    },
  )

  ipcMain.handle(
    DIRECT_IMPORT_IPC.PREVIEW_CLIP,
    async (_event, projectDir: string, fileName: string): Promise<string | null> => {
      await validatePreviewClip(projectDir, fileName)
      return hooks.previewClip?.(projectDir, fileName) ?? '当前运行时未接入桌面预览'
    },
  )

  ipcMain.handle(DIRECT_IMPORT_IPC.SELECT_AUDIO, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '选择音频文件',
      filters: [{ name: '音频文件', extensions: ['wav', 'mp3', 'ogg', 'webm', 'm4a', 'flac'] }],
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(
    DIRECT_IMPORT_IPC.SAVE_AUDIO,
    async (_event, projectDir: string, meta: AudioMeta, sourcePath: string) => {
      const paths = getProjectPaths(projectDir)
      await fs.mkdir(paths.audioDir, { recursive: true })
      await fs.copyFile(sourcePath, path.join(paths.audioDir, meta.file))
      await appendAudioMeta(paths.audioMeta, meta)
      hooks.onClipImported?.(projectDir)
      const raw = JSON.parse(await fs.readFile(paths.audioMeta, 'utf-8')) as unknown
      return { audioId: meta.id, audioCount: Array.isArray(raw) ? raw.length : 0 }
    },
  )
}

/**
 * 将视频逐字节复制到项目 clips/ 目录。
 * 目标文件只改变名称以编码动作映射，扩展名和文件内容保持不变。
 */
export async function copyClipDirectly(
  projectDir: string,
  request: DirectClipImportRequest,
): Promise<DirectClipImportResult> {
  if (!path.isAbsolute(projectDir) || !path.isAbsolute(request.sourcePath)) {
    throw new Error('项目目录和源片段都必须使用绝对路径')
  }
  if (!findItemByState(request.state)) throw new Error(`未知动作状态: ${request.state}`)
  if (!isDirectVideoFile(request.sourcePath)) {
    throw new Error(`该文件不能由 Electron 直接播放，且项目禁止转码: ${request.sourcePath}`)
  }

  const sourceStat = await fs.stat(request.sourcePath)
  if (!sourceStat.isFile()) throw new Error(`源片段不是文件: ${request.sourcePath}`)

  const paths = getProjectPaths(projectDir)
  await fs.mkdir(paths.clipsDir, { recursive: true })
  const existing = await fs.readdir(paths.clipsDir)
  const variant = nextDirectClipVariant(existing, request.state, request.direction)
  const fileName = makeDirectClipFileName(
    request.state,
    request.direction,
    variant,
    videoExtension(request.sourcePath),
  )
  const destination = path.join(paths.clipsDir, fileName)

  await fs.copyFile(request.sourcePath, destination, fsConstants.COPYFILE_EXCL)
  const clips = await loadDirectClips(paths.clipsDir)
  return {
    clipId: fileName.slice(0, -videoExtension(fileName).length),
    fileName,
    clipsCount: clips.length,
  }
}

/**
 * 校验桌面预览目标并解析片段描述。
 * 只做路径/文件名/存在性检查，不读取视频内容；
 * 实际播放由运行时钩子在宠物窗口的原生 <video> 中进行。
 */
export async function validatePreviewClip(
  projectDir: string,
  fileName: string,
): Promise<ClipMeta> {
  if (!path.isAbsolute(projectDir)) throw new Error('项目目录必须使用绝对路径')
  if (fileName === '' || /[\\/]/.test(fileName) || fileName === '.' || fileName === '..') {
    throw new Error(`片段文件名不合法: ${fileName}`)
  }
  const parsed = clipFromFileName(fileName)
  if (!parsed) throw new Error(`该文件不是可识别的导入片段: ${fileName}`)
  const paths = getProjectPaths(projectDir)
  await fs.access(path.join(paths.clipsDir, fileName))
  return parsed
}

/**
 * 从项目 clips/ 目录删除一个已导入的片段文件。
 * 只允许删除命名可识别的片段文件，文件名不允许携带任何路径分隔符。
 */
export async function deleteClipDirectly(
  projectDir: string,
  fileName: string,
): Promise<DirectClipDeleteResult> {
  if (!path.isAbsolute(projectDir)) throw new Error('项目目录必须使用绝对路径')
  if (fileName === '' || /[\\/]/.test(fileName) || fileName === '.' || fileName === '..') {
    throw new Error(`片段文件名不合法: ${fileName}`)
  }
  if (!clipFromFileName(fileName)) {
    throw new Error(`该文件不是可识别的导入片段: ${fileName}`)
  }

  const paths = getProjectPaths(projectDir)
  await fs.rm(path.join(paths.clipsDir, fileName))
  const clips = await loadDirectClips(paths.clipsDir)
  return { clipsCount: clips.length }
}

/**
 * 音频库仍是独立功能，只执行普通文件复制与 JSON 索引追加。
 * 这里不再提供“从视频抽取音轨”的处理入口。
 */
async function appendAudioMeta(audioMetaPath: string, meta: AudioMeta): Promise<void> {
  const raw = JSON.parse(await fs.readFile(audioMetaPath, 'utf-8')) as unknown
  const existing = (Array.isArray(raw) ? raw : []) as AudioMeta[]
  const updated = [...existing, meta]
  const errors = validateAudioMetaArray(updated)
  if (errors.length > 0) throw new Error(`音频元数据验证失败:\n  ${errors.join('\n  ')}`)
  await fs.writeFile(audioMetaPath, JSON.stringify(updated, null, 2), 'utf-8')
}

/**
 * 保留类型导出，供 preload 和导入窗口共享项目加载返回值。
 * 该别名不承载任何视频处理参数。
 */
export type DirectImportProjectData = ProjectData
