import { contextBridge, ipcRenderer } from 'electron'
import type { ClipMeta } from '../shared/types/clip-meta'
import type { TrackFile } from '../shared/types/track-file'
import type { ProjectData } from '../shared/types/project'
import type { ImportTranscodeRequest } from '../shared/pipeline/import-flow'
import type { ImportTranscodeResult } from '../main/pipeline/import-transcoder'

// Preload script — exposes a controlled API surface to the renderer.
// IPC channels are wired here as features are implemented.

/** 导入向导 IPC 桥接接口 */
export interface ImportBridge {
  /** 选择已有项目目录 */
  selectProject(): Promise<string | null>
  /** 创建新项目目录 */
  createProject(parentDir: string, petName: string): Promise<string>
  /** 加载项目数据 */
  loadProject(projectDir: string): Promise<ProjectData>
  /** 选择视频文件 */
  selectVideo(): Promise<string | null>
  /** 转码（色键 + VP9-alpha） */
  transcode(
    request: ImportTranscodeRequest,
    projectDir: string,
    presetName?: string,
    screenHeightPx?: number,
  ): Promise<ImportTranscodeResult>
  /** 保存片段元数据 + 可选 track.json */
  saveClip(
    projectDir: string,
    clip: ClipMeta,
    trackFile?: TrackFile,
  ): Promise<{ clipId: string; clipsCount: number }>
}

contextBridge.exposeInMainWorld('petalive', {
  version: '0.1.0',
  import: {
    selectProject: () => ipcRenderer.invoke('import:selectProject'),
    createProject: (parentDir: string, petName: string) =>
      ipcRenderer.invoke('import:createProject', parentDir, petName),
    loadProject: (projectDir: string) =>
      ipcRenderer.invoke('import:loadProject', projectDir),
    selectVideo: () => ipcRenderer.invoke('import:selectVideo'),
    transcode: (
      request: ImportTranscodeRequest,
      projectDir: string,
      presetName?: string,
      screenHeightPx?: number,
    ) =>
      ipcRenderer.invoke('import:transcode', request, projectDir, presetName, screenHeightPx),
    saveClip: (projectDir: string, clip: ClipMeta, trackFile?: TrackFile) =>
      ipcRenderer.invoke('import:saveClip', projectDir, clip, trackFile),
  } satisfies ImportBridge,
})
