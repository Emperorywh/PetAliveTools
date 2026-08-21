/**
 * 渲染进程入口。
 *
 * 正常窗口只创建一个原样视频播放器；导入窗口只复制文件。
 * 本文件不再包含抠像、裁剪、跟踪、转码演示或媒体时间上报。
 */

import { SpritePlayer } from './sprite/video-player'
import { mountImportWizard } from './import-wizard'
import { mountSettingsPanel } from './settings'
import { mountContextMenu } from './context-menu'
import { InteractionHandler } from './input/interaction'
import { AudioPlayer } from './audio'
import { DEFAULT_AUDIO_VOLUME } from '../shared/audio'
import { hitboxToPixels, DEFAULT_BUFFER_PX, DEFAULT_HITBOX } from '../shared/input'
import type { PlayClipPayload } from '../shared/types/play-command'

/**
 * 宠物窗口保持固定尺寸。
 * 视频由 object-fit: contain 原样放入该窗口，不做逐片段缩放计算。
 */
const WINDOW_WIDTH = 400
const WINDOW_HEIGHT = 400

/**
 * 初始化当前 hash 对应的渲染视图。
 * 工具视图只保留直接导入和设置页面。
 */
function bootstrap(): void {
  const app = document.getElementById('app')
  if (!app) throw new Error('#app element not found')
  app.innerHTML = ''

  if (window.location.hash === '#import-wizard') {
    window.__importWizard = mountImportWizard(app)
    return
  }
  if (window.location.hash === '#settings') {
    window.__settingsPanel = mountSettingsPanel(app)
    return
  }
  // 右键菜单窗口（hash 携带 ?muted= 查询参数，startsWith 兼容）
  if (window.location.hash.startsWith('#context-menu')) {
    mountContextMenu(app)
    return
  }

  const schedulerBridge = window.petalive?.scheduler
  const player = new SpritePlayer(app, {
    onClipEnded: (clipId) => schedulerBridge?.reportClipEnded(clipId),
  })
  const audioPlayer = new AudioPlayer({
    audioBaseUrl: 'audio',
    defaultVolume: DEFAULT_AUDIO_VOLUME,
  })

  /**
   * 删除空素材提示。
   * 首个真实片段开始播放或切换宠物时调用。
   */
  const removeGuidance = (): void => {
    document.getElementById('empty-guidance')?.remove()
  }

  /**
   * 原始视频内的音轨直接随 video 元素播放。
   * 这里只服从应用全局静音，不抽取或重新编码音轨。
   */
  const applyEmbeddedAudioState = (payload: PlayClipPayload): void => {
    if (payload.embeddedAudio && !audioPlayer.isMuted) {
      audioPlayer.enableEmbeddedAudio(player.videoElement)
    } else {
      audioPlayer.disableEmbeddedAudio(player.videoElement)
    }
  }

  let currentHitboxPx = hitboxToPixels(DEFAULT_HITBOX, {
    x: 0,
    y: 0,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  })
  let currentEmbeddedAudio = false

  /**
   * 片段切换时更新鼠标命中范围。
   * 当前直接导入模型使用统一默认值，但保留结构化载荷便于交互层复用。
   */
  const updateHitbox = (payload: PlayClipPayload): void => {
    currentHitboxPx = hitboxToPixels(payload.hitbox, {
      x: 0,
      y: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    })
  }

  if (schedulerBridge) {
    schedulerBridge.onPlayClip((payload) => {
      player.playClip(payload)
      updateHitbox(payload)
      applyEmbeddedAudioState(payload)
      currentEmbeddedAudio = payload.embeddedAudio
      removeGuidance()
    })
    schedulerBridge.onFadeIn((payload) => {
      player.fadeInClip(payload.clip, payload.durationMs)
      updateHitbox(payload.clip)
      applyEmbeddedAudioState(payload.clip)
      currentEmbeddedAudio = payload.clip.embeddedAudio
    })
    schedulerBridge.onFadeOut((payload) => {
      player.fadeOut(payload.durationMs)
    })
    schedulerBridge.onEasing((payload) => {
      player.playEasing(payload.durationMs)
    })
    schedulerBridge.onShowGuidance(() => {
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
      guidance.textContent = '还没有素材片段\n请通过导入窗口添加已制作完成的视频'
      app.appendChild(guidance)
    })
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
      if (currentEmbeddedAudio) {
        if (muted) audioPlayer.disableEmbeddedAudio(player.videoElement)
        else audioPlayer.enableEmbeddedAudio(player.videoElement)
      }
    })
  }

  const profileBridge = window.petalive?.profile
  if (profileBridge) {
    profileBridge.onSwitched((_id, name) => {
      removeGuidance()
      currentHitboxPx = hitboxToPixels(DEFAULT_HITBOX, {
        x: 0,
        y: 0,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
      })
      showPetNameToast(app, name)
    })
  }

  const interaction = new InteractionHandler({
    getHitboxPx: () => currentHitboxPx,
    bufferPx: DEFAULT_BUFFER_PX,
  })
  document.addEventListener('mousemove', (event) => interaction.handleMouseMove(event))
  document.addEventListener('mousedown', (event) => interaction.handleMouseDown(event))
  document.addEventListener('mouseup', (event) => interaction.handleMouseUp(event))
  document.addEventListener('contextmenu', (event) => interaction.handleContextMenu(event))

  // 就绪握手：全部监听器注册完毕才通知主进程开始下发调度命令。
  // 主进程的 webContents.send 不缓冲消息，若早于此处注册监听器，
  // 首个播放指令会在启动竞态中丢失，宠物窗口将保持透明（§13）。
  schedulerBridge?.notifyReady()

  window.__spritePlayer = player
  window.__interaction = interaction
  window.__audioPlayer = audioPlayer
}

/**
 * 切换宠物时短暂显示名称。
 * 该界面元素与视频文件播放完全独立。
 */
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

/**
 * DOM 就绪后启动渲染进程。
 * 启动本身不会预加载测试视频或处理任何媒体。
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap)
} else {
  bootstrap()
}
