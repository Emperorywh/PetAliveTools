/**
 * 调度渲染命令分发器 (IR-001 / IR-003 / IR-009 / IR-014)
 *
 * ClipScheduler 输出 RenderCommand，本模块负责把命令翻译成
 * 窗口操作与渲染进程 IPC：
 *
 *   - play        → `scheduler:play`     结构化载荷 (IR-002：锚点/尺度/循环点/速率/embeddedAudio)
 *   - fade_in     → `scheduler:fade-in`  道具淡入 (§8.4, IR-003)
 *   - fade_out    → `scheduler:fade-out` 道具淡出 (§8.4, IR-003)
 *   - easing      → `scheduler:easing`   兜底缓动 (§8.3, IR-003)
 *   - idle        → 锚定片段保活重播（节流, IR-014）
 *   - update_position → 窗口平移 (§7.2)
 *   - hold        → 调度器内部时序控制，无需 IPC
 *
 * 音频接线 (IR-009)：play 命令携带真实片段回调动作触发声 (§11.1)；
 * embeddedAudio 片段切换走时回调内嵌音轨结束 (§4.8, IR-010)。
 *
 * 该分发器同时被 tick 循环与交互抢占路径（MouseHandler, IR-001）使用，
 * 保证抢占产生的渲染命令与调度命令走完全相同的分发链路。
 *
 * 运行于主进程。
 */

import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ClipMeta } from '../../shared/types/clip-meta'
import type {
  PlayClipPayload,
  FadeInPayload,
  FadeOutPayload,
  EasingPayload,
} from '../../shared/types/play-command'
import type { AnchorPose } from '../behavior/anchor-transition'
import { isPlaceholderClip } from '../persistence/placeholder'
import type { RenderCommand } from '../scheduler/clip-scheduler'

/** IPC 频道名（与 preload 桥接一一对应） */
export const SCHEDULER_IPC = {
  play: 'scheduler:play',
  fadeIn: 'scheduler:fade-in',
  fadeOut: 'scheduler:fade-out',
  easing: 'scheduler:easing',
  guidance: 'scheduler:guidance',
  videoTime: 'scheduler:video-time',
} as const

/**
 * idle 保活重播的最小间隔 (ms, IR-014)。
 *
 * 空闲阶段调度器每 tick 都产生 idle 命令；保活重播按此间隔节流，
 * 避免 10Hz 重发同一播放指令。间隔远小于典型空闲间隔 (3–8s)，
 * 非循环片段结束后能及时重播，循环片段重发为无害空操作。
 */
export const IDLE_KEEPALIVE_MS = 1_500

/** 分发器外部依赖（由组合根注入，测试可造假） */
export interface SchedulerDispatcherDeps {
  /** 宠物窗口；为 null 或已销毁时丢弃全部命令 */
  getWindow(): BrowserWindow | null
  /** 活跃项目目录（片段文件解析根）；为 null 时丢弃播放类命令 */
  getProjectDir(): string | null
  /** 动作触发声 (§11.1, IR-009)：play 命令携带真实片段 */
  onActionAudio?: (state: string, clip: ClipMeta) => void
  /** 内嵌音轨结束 (§4.8, IR-010)：embeddedAudio 片段切换走时调用 */
  onEmbeddedAudioEnded?: () => void
  /** 时钟（测试可注入） */
  now?: () => number
}

/**
 * 调度渲染命令分发器。
 *
 * 使用方式：
 *   const dispatcher = new SchedulerCommandDispatcher(deps)
 *   dispatcher.dispatch(tickResult.commands)        // tick 循环
 *   mouseHandler.setCommandDispatcher((cmds) => dispatcher.dispatch(cmds))  // IR-001
 */
export class SchedulerCommandDispatcher {
  /** 上次 idle 保活重发时间 (ms) */
  private lastIdleKeepAliveAtMs = Number.NEGATIVE_INFINITY
  /** 上次保活重发的片段 id（同片段按时间节流，换片段立即重发） */
  private lastIdleKeepAliveClipId: string | null = null
  /** 当前正在播放的 embeddedAudio 片段 id（IR-010 切换检测） */
  private playingEmbeddedClipId: string | null = null

  constructor(private readonly deps: SchedulerDispatcherDeps) {}

  /** 分发一批渲染命令（来自 tick / completeCurrentPlayback / preempt / endPreempt） */
  dispatch(commands: readonly RenderCommand[]): void {
    const win = this.deps.getWindow()
    if (!win || win.isDestroyed()) return

    for (const cmd of commands) {
      switch (cmd.kind) {
        case 'play':
          this.dispatchPlay(win, cmd.clip, cmd.mirrored, cmd.anchor, cmd.playbackRate)
          break
        case 'fade_in':
          this.dispatchFadeIn(win, cmd.clip, cmd.durationMs, cmd.mirrored, cmd.anchor, cmd.playbackRate)
          break
        case 'fade_out':
          this.dispatchFadeOut(win, cmd.clip, cmd.durationMs)
          break
        case 'easing':
          this.dispatchEasing(win, cmd.durationMs, cmd.reason)
          break
        case 'idle':
          this.dispatchIdleKeepAlive(win, cmd.clip)
          break
        case 'update_position':
          win.setPosition(Math.round(cmd.x), Math.round(cmd.y), false)
          break
        // hold — 调度器内部时序控制，无需 IPC
      }
    }
  }

  // —— 各命令分发 —— //

  /** play → scheduler:play (IR-002 结构化载荷) + 动作声 (IR-009) */
  private dispatchPlay(
    win: BrowserWindow,
    clip: ClipMeta,
    mirrored: boolean,
    anchor: AnchorPose,
    playbackRate: number,
  ): void {
    if (isPlaceholderClip(clip)) return
    const payload = this.buildPlayPayload(clip, mirrored, anchor, playbackRate)
    if (!payload) return

    // IR-010：上一个 embeddedAudio 片段切换走 → 通知内嵌音轨结束
    if (this.playingEmbeddedClipId && this.playingEmbeddedClipId !== clip.id) {
      this.playingEmbeddedClipId = null
      this.deps.onEmbeddedAudioEnded?.()
    }

    win.webContents.send(SCHEDULER_IPC.play, payload)

    // IR-009：调度器自主播放同样触发动作声 (§11.1)，冷却/上限由音频协调器约束
    this.playingEmbeddedClipId = clip.embeddedAudio ? clip.id : null
    this.deps.onActionAudio?.(clip.state, clip)
  }

  /** fade_in → scheduler:fade-in (§8.4 道具淡入, IR-003) */
  private dispatchFadeIn(
    win: BrowserWindow,
    clip: ClipMeta,
    durationMs: number,
    mirrored: boolean,
    anchor: AnchorPose,
    playbackRate: number,
  ): void {
    if (isPlaceholderClip(clip)) return
    const payload = this.buildPlayPayload(clip, mirrored, anchor, playbackRate)
    if (!payload) return
    const fadePayload: FadeInPayload = { clip: payload, durationMs }
    win.webContents.send(SCHEDULER_IPC.fadeIn, fadePayload)
  }

  /** fade_out → scheduler:fade-out (§8.4 道具淡出, IR-003) */
  private dispatchFadeOut(win: BrowserWindow, clip: ClipMeta, durationMs: number): void {
    const payload: FadeOutPayload = { clipId: clip.id, durationMs }
    win.webContents.send(SCHEDULER_IPC.fadeOut, payload)
  }

  /** easing → scheduler:easing (§8.3 兜底缓动, IR-003) */
  private dispatchEasing(win: BrowserWindow, durationMs: number, reason: string): void {
    const payload: EasingPayload = { durationMs, reason }
    win.webContents.send(SCHEDULER_IPC.easing, payload)
  }

  /**
   * idle → 锚定/上一片段保活重播 (IR-014)。
   *
   * 空闲阶段非循环片段冻结在末帧；将 idle 命令转换为对当前片段的
   * 重播指令（渲染端对同 src 且仍在播放的情况为空操作，IR-005 语义）。
   * 按 IDLE_KEEPALIVE_MS 节流。
   */
  private dispatchIdleKeepAlive(win: BrowserWindow, clip: ClipMeta): void {
    if (isPlaceholderClip(clip)) return
    const nowMs = this.deps.now?.() ?? Date.now()
    if (
      this.lastIdleKeepAliveClipId === clip.id &&
      nowMs - this.lastIdleKeepAliveAtMs < IDLE_KEEPALIVE_MS
    ) {
      return
    }
    const payload = this.buildPlayPayload(clip, false, clip.anchor === 'stand' ? 'stand' : 'sit', 1)
    if (!payload) return
    this.lastIdleKeepAliveAtMs = nowMs
    this.lastIdleKeepAliveClipId = clip.id
    win.webContents.send(SCHEDULER_IPC.play, payload)
  }

  // —— 载荷构建 —— //

  /** 构建结构化播放载荷 (IR-002)；项目目录缺失时返回 null */
  private buildPlayPayload(
    clip: ClipMeta,
    mirrored: boolean,
    anchor: AnchorPose,
    playbackRate: number,
  ): PlayClipPayload | null {
    const projectDir = this.deps.getProjectDir()
    if (!projectDir) return null
    const clipFile = join(projectDir, 'clips', `${clip.id}.webm`)
    return {
      clipId: clip.id,
      clipUrl: pathToFileURL(clipFile).href,
      mirrored,
      loop: clip.loop,
      hitbox: clip.hitbox,
      anchor,
      scaleHint: clip.scaleHint,
      loopInSec: clip.loopInSec,
      loopOutSec: clip.loopOutSec,
      playbackRate,
      embeddedAudio: clip.embeddedAudio,
      walk: clip.state === 'walk',
    }
  }
}
