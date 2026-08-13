/**
 * 导入向导 IPC 处理 (§5.5)
 *
 * 渲染进程导入向导通过 preload 暴露的 IPC 通道与主进程交互：
 * - 选择/创建项目目录
 * - 选择视频文件
 * - 转码（色键 + VP9-alpha 编码）
 * - 保存片段元数据 + 位移曲线文件
 *
 * 运行于主进程，通过 ipcMain.handle 注册。
 */

import { ipcMain, dialog, app } from 'electron'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { ClipMeta } from '../../shared/types/clip-meta'
import type { ProjectData } from '../../shared/types/project'
import type { TrackFile } from '../../shared/types/track-file'
import type { ImportTranscodeRequest } from '../../shared/pipeline/import-flow'
import { recommendPreset, type TranscodePresetName } from '../../shared/pipeline/presets'
import {
  getProjectPaths,
  loadProject,
  saveProject,
} from '../persistence/project-io'
import { validateClipMetaArray } from '../../shared/schemas'
import { writeTrackFile } from './track-file'
import { transcodeImport, type AppInfo } from './import-transcoder'

/** IPC 通道名 */
export const IPC = {
  SELECT_PROJECT: 'import:selectProject',
  CREATE_PROJECT: 'import:createProject',
  LOAD_PROJECT: 'import:loadProject',
  SELECT_VIDEO: 'import:selectVideo',
  TRANSCODE: 'import:transcode',
  SAVE_CLIP: 'import:saveClip',
  GET_DEFAULT_PROJECT_DIR: 'import:getDefaultProjectDir',
} as const

/** 获取当前应用的 ffmpeg AppInfo */
function getAppInfo(): AppInfo {
  return {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    ffmpegPathOverride: process.env['FFMPEG_PATH'] || undefined,
  }
}

/** 导入向导与外壳运行时之间的钩子 */
export interface ImportIpcHooks {
  /** 片段保存后的回调（宿主判断目标是否为活跃项目目录并触发调度器重建） */
  onClipSaved?: (projectDir: string) => void
  /** 返回默认（活跃宠物）项目目录；无活跃宠物时为 null */
  getDefaultProjectDir?: () => string | null
}

/**
 * 注册全部导入向导 IPC 处理器。
 *
 * @param hooks 外壳运行时钩子（调度器重建、默认项目目录）
 *
 * 应在 app.whenReady() 后调用。
 */
export function registerImportIpcHandlers(hooks: ImportIpcHooks = {}): void {
  // 默认项目目录：导入向导打开时优先加载活跃宠物目录 (§12.2)
  ipcMain.handle(IPC.GET_DEFAULT_PROJECT_DIR, () => {
    return hooks.getDefaultProjectDir?.() ?? null
  })

  // ── 选择项目目录 ── //
  ipcMain.handle(IPC.SELECT_PROJECT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择 Pet 项目目录',
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // ── 创建项目目录 ── //
  ipcMain.handle(
    IPC.CREATE_PROJECT,
    async (_event, parentDir: string, petName: string) => {
      const projectDir = path.join(parentDir, petName)
      const paths = getProjectPaths(projectDir)

      // 确保目录不存在
      try {
        await fs.access(projectDir)
        throw new Error(`项目目录已存在: ${projectDir}`)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }

      await fs.mkdir(paths.clipsDir, { recursive: true })
      await fs.mkdir(paths.audioDir, { recursive: true })

      // 写入默认 JSON 文件
      await writeJson(paths.persona, { name: petName, symmetrical: true, personality: { liveliness: 0.5, laziness: 0.5, clinginess: 0.5, timidity: 0.5, curiosity: 0.5 } })
      await writeJson(paths.needsState, { hunger: 30, fatigue: 20, happiness: 60, attention: 50 })
      await writeJson(paths.behaviorConfig, { weightOverrides: {}, rhythm: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 }, microRandom: { rateJitter: 0.05, idleJitterSec: 2, signatureProbability: 0.05 }, shell: { displayId: null, screenPercent: 0.15, volume: 0.25, ambientFrequency: 1.0, autoLaunch: true, hideHotkey: 'CommandOrControl+Shift+H' } })
      await writeJson(paths.clipsMeta, [])
      await writeJson(paths.audioMeta, [])

      return projectDir
    },
  )

  // ── 加载项目 ── //
  ipcMain.handle(IPC.LOAD_PROJECT, async (_event, projectDir: string) => {
    return await loadProject(projectDir)
  })

  // ── 选择视频文件 ── //
  ipcMain.handle(IPC.SELECT_VIDEO, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '选择视频文件',
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // ── 转码 ── //
  ipcMain.handle(
    IPC.TRANSCODE,
    async (
      _event,
      request: ImportTranscodeRequest,
      projectDir: string,
      presetName?: string,
      screenHeightPx?: number,
    ) => {
      const paths = getProjectPaths(projectDir)
      const preset: TranscodePresetName = (presetName as TranscodePresetName | undefined)
        ?? recommendPreset(request.clipId, false, false)
      return await transcodeImport(
        getAppInfo(),
        request,
        paths.clipsDir,
        preset,
        screenHeightPx,
      )
    },
  )

  // ── 保存片段元数据 + 可选 track.json ── //
  ipcMain.handle(
    IPC.SAVE_CLIP,
    async (
      _event,
      projectDir: string,
      clip: ClipMeta,
      trackFile?: TrackFile,
    ) => {
      const paths = getProjectPaths(projectDir)

      // 读取现有 clips.meta.json
      const existingRaw = await readJson(paths.clipsMeta)
      const existingClips = (Array.isArray(existingRaw) ? existingRaw : []) as ClipMeta[]

      // 追加新片段
      const updatedClips = [...existingClips, clip]

      // 写前验证
      const errors = validateClipMetaArray(updatedClips)
      if (errors.length > 0) {
        throw new Error(`片段元数据验证失败:\n  ${errors.join('\n  ')}`)
      }

      await writeJson(paths.clipsMeta, updatedClips)

      // 行走类片段写入 track.json
      if (trackFile) {
        await writeTrackFile(paths.clipsDir, clip.id, trackFile)
      }

      // 通知宿主重建调度器（仅当目标为活跃项目目录时由宿主判断）
      hooks.onClipSaved?.(projectDir)

      return { clipId: clip.id, clipsCount: updatedClips.length }
    },
  )
}

/**
 * 向已加载的项目追加片段并保存完整项目数据。
 *
 * 用于不经过 IPC 的直接调用（如测试或批处理）。
 */
export async function appendClipToProject(
  projectDir: string,
  projectData: ProjectData,
  clip: ClipMeta,
  trackFile?: TrackFile,
): Promise<ProjectData> {
  const updatedClips = [...projectData.clips, clip]
  const errors = validateClipMetaArray(updatedClips)
  if (errors.length > 0) {
    throw new Error(`片段元数据验证失败:\n  ${errors.join('\n  ')}`)
  }

  const updated: ProjectData = { ...projectData, clips: updatedClips }
  await saveProject(projectDir, updated)

  if (trackFile) {
    const paths = getProjectPaths(projectDir)
    await writeTrackFile(paths.clipsDir, clip.id, trackFile)
  }

  return updated
}

// ── JSON 辅助 ── //

async function readJson(filePath: string): Promise<unknown> {
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content)
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2)
  await fs.writeFile(filePath, content, 'utf-8')
}
