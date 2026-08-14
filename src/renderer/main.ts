// 渲染进程入口 (renderer entry point)
//
// 引导视频精灵播放器：加载测试 WebM-alpha 片段、应用 CSS transform 管线
// （位置/尺度/方向）、启动全局呼吸缩放、渲染接触阴影。
// 参见 SPEC §6 (渲染层)。
//
// #chroma-preview 视图：引导色键抠像预览（§5.5），由主进程在
// PETALIVE_VIEW=chroma-preview 时加载，用于手动验证抠像质量。
//
// #walk-correction 视图：引导行走跟踪裁切 + 位移曲线手动校正演示（§5.3），
// 由主进程在 PETALIVE_VIEW=walk-correction 时加载，用于手动验证
// 跟踪裁切、地面线锁定、位移曲线生成与关键点校正。
//
// 验证说明：将测试 WebM-alpha 片段放置于 src/renderer/public/test-clip.webm，
// 运行 npm run dev 即可在透明窗口中验证播放效果。

import { SpritePlayer, type SpritePlayerConfig } from './sprite/video-player'
import { DEFAULT_SHADOW_CONFIG } from './composition/contact-shadow'
import type { BasePoint } from './composition/anchor-alignment'
import { mountChromaKeyPreviewDemo, mountWalkCorrectionDemo, mountImportWizard } from './pipeline'
import { mountSettingsPanel } from './settings'
import { InteractionHandler } from './input/interaction'
import { AudioPlayer } from './audio'
import { DEFAULT_AUDIO_VOLUME } from '../shared/audio'
import { hitboxToPixels, DEFAULT_BUFFER_PX } from '../shared/input'
import type { Hitbox } from '../shared/types/clip-meta'
import type { PlayClipPayload } from '../shared/types/play-command'

/** 测试片段 URL（用户将 WebM-alpha 文件放至 src/renderer/public/test-clip.webm） */
const TEST_CLIP_SRC = 'test-clip.webm'

/** 窗口固定尺寸 (§6.1) */
const WINDOW_WIDTH = 400
const WINDOW_HEIGHT = 400

/** 行走片段媒体时间上报间隔 (ms, IR-004)：~10Hz */
const VIDEO_TIME_REPORT_MS = 100

/**
 * 默认命中盒 (§5.4 示例值：[x, y, w, h] 归一化)。
 *
 * 仅在调度器尚未下发片段 hitbox 前使用；
 * 运行时由 scheduler:play 载荷中的逐片段 hitbox 更新 (§5.4/§6.1)。
 */
const DEFAULT_HITBOX: Hitbox = [0.1, 0.05, 0.8, 0.9]

/**
 * 精灵基准坐标：窗口底部中央偏上。
 *
 * 窗口固定 400×400（§6.1），精灵锚点（足部/臀部）对齐到此坐标。
 * 坐标系原点 = 窗口左上角。
 */
const SPRITE_BASE_POINT: BasePoint = { x: 200, y: 380 }

function bootstrap(): void {
  const app = document.getElementById('app')
  if (!app) throw new Error('#app element not found')

  // 清空脚手架占位内容
  app.innerHTML = ''

  // 色键抠像预览视图（§5.5，手动验证入口）
  if (window.location.hash === '#chroma-preview') {
    window.__chromaKeyPreview = mountChromaKeyPreviewDemo(app)
    return
  }

  // 行走跟踪裁切 + 位移曲线校正视图（§5.3，手动验证入口）
  if (window.location.hash === '#walk-correction') {
    window.__walkCorrection = mountWalkCorrectionDemo(app)
    return
  }

  // 清单引导式导入向导（§5.5，手动验证入口）
  if (window.location.hash === '#import-wizard') {
    window.__importWizard = mountImportWizard(app)
    return
  }

  // 设置面板（§12.4）
  if (window.location.hash === '#settings') {
    window.__settingsPanel = mountSettingsPanel(app)
    return
  }

  const config: SpritePlayerConfig = {
    clipSrc: TEST_CLIP_SRC,
    anchorType: 'stand',
    basePoint: SPRITE_BASE_POINT,
    scaleHint: 1.0,
    flip: false,
    shadowConfig: { ...DEFAULT_SHADOW_CONFIG, visible: true },
    loop: true,
  }

  const player = new SpritePlayer(app, config)
  player.startBreathing()

  // 音频播放器 (§11)：接收主进程 IPC 指令播放声效
  const audioPlayer = new AudioPlayer({
    audioBaseUrl: 'audio',
    defaultVolume: DEFAULT_AUDIO_VOLUME,
  })

  // 行走片段媒体时间上报 (IR-004)：仅行走片段播放期间 ~10Hz 上报
  let videoTimeReporter: ReturnType<typeof setInterval> | null = null
  const stopVideoTimeReporter = (): void => {
    if (videoTimeReporter !== null) {
      clearInterval(videoTimeReporter)
      videoTimeReporter = null
    }
  }
  const startVideoTimeReporter = (clipId: string): void => {
    stopVideoTimeReporter()
    const bridge = window.petalive?.scheduler
    if (!bridge) return
    videoTimeReporter = setInterval(() => {
      const video = player.videoElement
      if (!video.paused && !video.ended) {
        bridge.reportVideoTime(clipId, video.currentTime)
      }
    }, VIDEO_TIME_REPORT_MS)
  }

  /** 按载荷应用嵌入式音轨初始状态 (§4.8, IR-010)：消除 embedded_start 追认时序窗 */
  const applyEmbeddedAudioState = (payload: PlayClipPayload): void => {
    const video = player.videoElement
    if (payload.embeddedAudio && !audioPlayer.isMuted) {
      audioPlayer.enableEmbeddedAudio(video)
    } else {
      audioPlayer.disableEmbeddedAudio(video)
    }
  }

  // 调度器桥接：监听主进程播放指令，动态切换片段 (§9)
  let currentHitboxPx = hitboxToPixels(DEFAULT_HITBOX, {
    x: 0,
    y: 0,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  })
  let currentEmbeddedAudio = false
  const updateHitbox = (payload: PlayClipPayload): void => {
    // 逐片段命中盒更新 (§5.4/§6.1)：切换片段后重算 hitboxPx
    currentHitboxPx = hitboxToPixels(payload.hitbox, {
      x: 0,
      y: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
  }
  const schedulerBridge = window.petalive?.scheduler
  if (schedulerBridge) {
    schedulerBridge.onPlayClip((payload) => {
      player.playClip(payload)
      updateHitbox(payload)
      applyEmbeddedAudioState(payload)
      currentEmbeddedAudio = payload.embeddedAudio
      // IR-004：行走片段开启媒体时间上报，其余片段停止
      if (payload.walk) startVideoTimeReporter(payload.clipId)
      else stopVideoTimeReporter()
      removeGuidance()
    })
    schedulerBridge.onFadeIn((payload) => {
      // §8.4 道具淡入 (IR-003)：淡化期间窗口位置不动（主进程冻结平移）
      player.fadeInClip(payload.clip, payload.durationMs)
      updateHitbox(payload.clip)
      applyEmbeddedAudioState(payload.clip)
      currentEmbeddedAudio = payload.clip.embeddedAudio
      stopVideoTimeReporter()
    })
    schedulerBridge.onFadeOut((payload) => {
      // §8.4 道具淡出 (IR-003)
      player.fadeOut(payload.durationMs)
    })
    schedulerBridge.onEasing((payload) => {
      // §8.3 兜底缓动 (IR-003)：切换点 60–120ms opacity 微缓动
      player.playEasing(payload.durationMs)
    })
    schedulerBridge.onShowGuidance(() => {
      // §13 素材库为空：显示引导，不崩溃
      removeGuidance()
      const guidance = document.createElement('div')
      guidance.id = 'empty-guidance'
      Object.assign(guidance.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        color: 'rgba(255,255,255,0.8)',
        fontSize: '14px',
        textAlign: 'center',
        fontFamily: 'sans-serif',
        pointerEvents: 'none',
        whiteSpace: 'pre-line',
      })
      guidance.textContent = '还没有素材片段\n请通过导入向导添加宠物视频'
      app.appendChild(guidance)
    })
  }

  /** 移除空库引导文案（素材到位/切换宠物后） */
  const removeGuidance = (): void => {
    document.getElementById('empty-guidance')?.remove()
  }

  const audioBridge = window.petalive?.audio
  if (audioBridge) {
    audioBridge.onPlaySound((file, volume) => {
      audioPlayer.setVolume(volume)
      audioPlayer.playSound(file)
    })
    audioBridge.onEmbeddedStart(() => {
      if (!audioPlayer.isMuted) audioPlayer.enableEmbeddedAudio(player.videoElement)
    })
    audioBridge.onEmbeddedStop(() => {
      audioPlayer.disableEmbeddedAudio(player.videoElement)
    })
    audioBridge.onSetMuted((muted) => {
      audioPlayer.setMuted(muted)
      // 内嵌音轨随全局静音即时联动 (§11.2)
      if (currentEmbeddedAudio) {
        if (muted) audioPlayer.disableEmbeddedAudio(player.videoElement)
        else audioPlayer.enableEmbeddedAudio(player.videoElement)
      }
    })
  }

  // 宠物切换通知 (§12.2, IR-017)：显示宠物名 + 重置 UI 状态
  const profileBridge = window.petalive?.profile
  if (profileBridge) {
    profileBridge.onSwitched((_id, name) => {
      removeGuidance()
      // 重置命中盒到默认，等待新片段载荷更新
      currentHitboxPx = hitboxToPixels(DEFAULT_HITBOX, {
        x: 0,
        y: 0,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
      })
      stopVideoTimeReporter()
      showPetNameToast(app, name)
    })
  }

  // 交互处理器：命中盒检测、穿透/交互切换、抚摸/点击/拖拽/右键菜单 (§10)
  const interaction = new InteractionHandler({
    getHitboxPx: () => currentHitboxPx,
    bufferPx: DEFAULT_BUFFER_PX,
  })

  document.addEventListener('mousemove', (e) => interaction.handleMouseMove(e))
  document.addEventListener('mousedown', (e) => interaction.handleMouseDown(e))
  document.addEventListener('mouseup', (e) => interaction.handleMouseUp(e))
  document.addEventListener('contextmenu', (e) => interaction.handleContextMenu(e))

  // 暴露至全局，便于开发时手动调试（VERIFY-002 手动验证时可用于切换阴影/镜像）
  window.__spritePlayer = player
  window.__interaction = interaction
  window.__audioPlayer = audioPlayer
}

/** 宠物名 toast（切换宠物时短暂显示，§12.2 渲染层感知） */
function showPetNameToast(app: HTMLElement, name: string): void {
  document.getElementById('pet-name-toast')?.remove()
  const toast = document.createElement('div')
  toast.id = 'pet-name-toast'
  Object.assign(toast.style, {
    position: 'absolute',
    top: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.85)',
    background: 'rgba(0,0,0,0.45)',
    borderRadius: '10px',
    padding: '4px 12px',
    fontSize: '13px',
    fontFamily: 'sans-serif',
    pointerEvents: 'none',
    transition: 'opacity 400ms linear',
  })
  toast.textContent = name
  app.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 450)
  }, 1600)
}

// DOM 就绪后引导
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap)
} else {
  bootstrap()
}
