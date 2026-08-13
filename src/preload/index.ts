import { contextBridge, ipcRenderer } from 'electron'
import type { ClipMeta } from '../shared/types/clip-meta'
import type { TrackFile } from '../shared/types/track-file'
import type { ProjectData } from '../shared/types/project'
import type { ImportTranscodeRequest } from '../shared/pipeline/import-flow'
import type { ImportTranscodeResult } from '../main/pipeline/import-transcoder'

// Preload script — exposes a controlled API surface to the renderer.
// IPC channels are wired here as features are implemented.

/** 交互层 IPC 桥接接口 (§10) */
export interface InputBridge {
  /** 进入交互态：setIgnoreMouseEvents(false) (§6.1) */
  enterInteractive(): void
  /** 退出到穿透态：setIgnoreMouseEvents(true, {forward:true}) (§6.1) */
  exitInteractive(): void
  /** 抢占：触发交互片段 (petted/clicked/dragged) */
  preempt(interaction: string): void
  /** 结束抢占：结束循环交互片段 */
  endPreempt(): void
  /** 拖拽位移：通知主进程光标在窗口内的位置 */
  dragMove(x: number, y: number): void
  /** 弹出右键上下文菜单 (§10) */
  contextMenu(): void
}

/** 音频 IPC 桥接接口 (§11) */
export interface AudioBridge {
  /** 监听主进程播放声效指令 (§11.1) */
  onPlaySound(callback: (file: string, volume: number) => void): void
  /** 监听内嵌音频开始 (§11.1 embeddedAudio) */
  onEmbeddedStart(callback: () => void): void
  /** 监听内嵌音频结束 (§11.1 embeddedAudio) */
  onEmbeddedStop(callback: () => void): void
  /** 监听全局静音状态变更 (§11.2) */
  onSetMuted(callback: (muted: boolean) => void): void
  /** 请求切换静音（渲染→主进程，如快捷键入口） */
  toggleMute(): void
}

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
  input: {
    enterInteractive: () => ipcRenderer.send('input:enter-interactive'),
    exitInteractive: () => ipcRenderer.send('input:exit-interactive'),
    preempt: (interaction: string) => ipcRenderer.send('input:preempt', interaction),
    endPreempt: () => ipcRenderer.send('input:end-preempt'),
    dragMove: (x: number, y: number) => ipcRenderer.send('input:drag-move', x, y),
    contextMenu: () => ipcRenderer.send('input:context-menu'),
  } satisfies InputBridge,
  audio: {
    onPlaySound: (callback: (file: string, volume: number) => void) => {
      const handler = (_e: unknown, file: string, volume: number): void => callback(file, volume)
      ipcRenderer.on('audio:play', handler)
    },
    onEmbeddedStart: (callback: () => void) => {
      ipcRenderer.on('audio:embedded-start', () => callback())
    },
    onEmbeddedStop: (callback: () => void) => {
      ipcRenderer.on('audio:embedded-stop', () => callback())
    },
    onSetMuted: (callback: (muted: boolean) => void) => {
      const handler = (_e: unknown, muted: boolean): void => callback(muted)
      ipcRenderer.on('audio:set-muted', handler)
    },
    toggleMute: () => ipcRenderer.send('audio:toggle-mute'),
  } satisfies AudioBridge,
})
