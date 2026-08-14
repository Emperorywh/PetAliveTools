import { contextBridge, ipcRenderer } from 'electron'
import type { AudioMeta } from '../shared/types/audio-meta'
import type { ProjectData } from '../shared/types/project'
import type {
  DirectClipDeleteResult,
  DirectClipImportRequest,
  DirectClipImportResult,
} from '../shared/direct-media'
import type { ShellSettings } from '../shared/types/behavior-config'
import type { Personality } from '../shared/types/persona'
import type {
  PlayClipPayload,
  FadeInPayload,
  FadeOutPayload,
  EasingPayload,
} from '../shared/types/play-command'

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
}

/**
 * 原样片段导入桥接。
 * 渲染进程只能选择和复制文件，不暴露任何视频处理接口。
 */
export interface ImportBridge {
  /** 获取默认（活跃宠物）项目目录；无活跃宠物时为 null */
  getDefaultProjectDir(): Promise<string | null>
  /** 选择已有项目目录 */
  selectProject(): Promise<string | null>
  /** 创建新项目目录 */
  createProject(parentDir: string, petName: string): Promise<string>
  /** 加载项目数据 */
  loadProject(projectDir: string): Promise<ProjectData>
  /** 选择已制作完成、可直接播放的视频文件 */
  selectClip(): Promise<string | null>
  /** 原样复制片段，不转码、不生成视频元数据 */
  copyClip(projectDir: string, request: DirectClipImportRequest): Promise<DirectClipImportResult>
  /** 删除 clips/ 中的一个已导入片段文件 */
  deleteClip(projectDir: string, fileName: string): Promise<DirectClipDeleteResult>
  /** 选择音频文件 (§11.1 音频素材入库, IR-013) */
  selectAudio(): Promise<string | null>
  /** 音频素材入库：拷贝至 audio/ 并追加 audio.meta.json (IR-013) */
  saveAudio(
    projectDir: string,
    meta: AudioMeta,
    sourcePath: string,
  ): Promise<{ audioId: string; audioCount: number }>
}

/** 调度器 IPC 桥接接口 (§9 scheduler → renderer) */
export interface SchedulerBridge {
  /** 监听主进程播放片段指令（结构化载荷, IR-002） */
  onPlayClip(callback: (payload: PlayClipPayload) => void): void
  /** 监听道具淡入指令 (§8.4, IR-003) */
  onFadeIn(callback: (payload: FadeInPayload) => void): void
  /** 监听道具淡出指令 (§8.4, IR-003) */
  onFadeOut(callback: (payload: FadeOutPayload) => void): void
  /** 监听兜底缓动指令 (§8.3, IR-003) */
  onEasing(callback: (payload: EasingPayload) => void): void
  /** 当前非循环片段自然播放结束，通知主进程推进队列 */
  reportClipEnded(clipId: string): void
  /** 监听素材库为空指引（§13 不崩溃，弹引导采集） */
  onShowGuidance(callback: () => void): void
}

/** 宠物 profile IPC 桥接接口 (§12.2, IR-017) */
export interface ProfileBridge {
  /** 监听活跃宠物切换（渲染层据此显示宠物名/重置 UI 状态） */
  onSwitched(callback: (id: string, name: string) => void): void
}

/** 设置面板 IPC 桥接接口 (§12.4) */
export interface SettingsBridge {
  /** 获取显示器列表 */
  getDisplays(): Promise<{ id: number; label: string; isPrimary: boolean; scaleFactor: number }[]>
  /** 获取当前 shell 设置 */
  getShellSettings(): Promise<ShellSettings>
  /** 更新 shell 设置（部分字段） */
  updateShellSettings(changes: Partial<ShellSettings>): Promise<ShellSettings>
  /** 获取当前性格参数 */
  getPersonality(): Promise<Personality>
  /** 更新性格参数（部分维度） */
  updatePersonality(changes: Partial<Personality>): Promise<Personality>
  /** 获取当前自启状态 */
  getAutoLaunch(): Promise<boolean>
  /** 设置自启 */
  setAutoLaunch(enabled: boolean): Promise<boolean>
  /** 重新注册快捷键 */
  rebindHotkey(accelerator: string): Promise<{ success: boolean; activeAccelerator: string }>
}

contextBridge.exposeInMainWorld('petalive', {
  version: '0.1.0',
  import: {
    getDefaultProjectDir: () => ipcRenderer.invoke('import:getDefaultProjectDir'),
    selectProject: () => ipcRenderer.invoke('import:selectProject'),
    createProject: (parentDir: string, petName: string) =>
      ipcRenderer.invoke('import:createProject', parentDir, petName),
    loadProject: (projectDir: string) =>
      ipcRenderer.invoke('import:loadProject', projectDir),
    selectClip: () => ipcRenderer.invoke('import:selectClip'),
    copyClip: (projectDir: string, request: DirectClipImportRequest) =>
      ipcRenderer.invoke('import:copyClip', projectDir, request),
    deleteClip: (projectDir: string, fileName: string) =>
      ipcRenderer.invoke('import:deleteClip', projectDir, fileName),
    selectAudio: () => ipcRenderer.invoke('import:selectAudio'),
    saveAudio: (projectDir: string, meta: AudioMeta, sourcePath: string) =>
      ipcRenderer.invoke('import:saveAudio', projectDir, meta, sourcePath),
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
  } satisfies AudioBridge,
  settings: {
    getDisplays: () => ipcRenderer.invoke('settings:get-displays'),
    getShellSettings: () => ipcRenderer.invoke('settings:get-shell'),
    updateShellSettings: (changes: Partial<ShellSettings>) =>
      ipcRenderer.invoke('settings:update-shell', changes),
    getPersonality: () => ipcRenderer.invoke('settings:get-personality'),
    updatePersonality: (changes: Partial<Personality>) =>
      ipcRenderer.invoke('settings:update-personality', changes),
    getAutoLaunch: () => ipcRenderer.invoke('settings:get-auto-launch'),
    setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('settings:set-auto-launch', enabled),
    rebindHotkey: (accelerator: string) =>
      ipcRenderer.invoke('settings:rebind-hotkey', accelerator),
  } satisfies SettingsBridge,
  scheduler: {
    onPlayClip: (callback: (payload: PlayClipPayload) => void) => {
      const handler = (_e: unknown, payload: PlayClipPayload): void => callback(payload)
      ipcRenderer.on('scheduler:play', handler)
    },
    onFadeIn: (callback: (payload: FadeInPayload) => void) => {
      const handler = (_e: unknown, payload: FadeInPayload): void => callback(payload)
      ipcRenderer.on('scheduler:fade-in', handler)
    },
    onFadeOut: (callback: (payload: FadeOutPayload) => void) => {
      const handler = (_e: unknown, payload: FadeOutPayload): void => callback(payload)
      ipcRenderer.on('scheduler:fade-out', handler)
    },
    onEasing: (callback: (payload: EasingPayload) => void) => {
      const handler = (_e: unknown, payload: EasingPayload): void => callback(payload)
      ipcRenderer.on('scheduler:easing', handler)
    },
    reportClipEnded: (clipId: string) =>
      ipcRenderer.send('scheduler:clip-ended', clipId),
    onShowGuidance: (callback: () => void) => {
      ipcRenderer.on('scheduler:guidance', () => callback())
    },
  } satisfies SchedulerBridge,
  profile: {
    onSwitched: (callback: (id: string, name: string) => void) => {
      const handler = (_e: unknown, id: string, name: string): void => callback(id, name)
      ipcRenderer.on('profile:switched', handler)
    },
  } satisfies ProfileBridge,
})
