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
import { InteractionHandler } from './input/interaction'
import { AudioPlayer } from './audio'
import { DEFAULT_AUDIO_VOLUME } from '../shared/audio'
import { hitboxToPixels, DEFAULT_BUFFER_PX } from '../shared/input'
import type { Hitbox } from '../shared/types/clip-meta'

/** 测试片段 URL（用户将 WebM-alpha 文件放至 src/renderer/public/test-clip.webm） */
const TEST_CLIP_SRC = 'test-clip.webm'

/** 窗口固定尺寸 (§6.1) */
const WINDOW_WIDTH = 400
const WINDOW_HEIGHT = 400

/**
 * 默认命中盒 (§5.4 示例值：[x, y, w, h] 归一化)。
 *
 * 运行时由调度器根据当前片段的 hitbox 字段更新；
 * 在完整调度器接线前使用此默认值。
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
  const audioBridge = window.petalive?.audio
  if (audioBridge) {
    audioBridge.onPlaySound((file, volume) => {
      audioPlayer.setVolume(volume)
      audioPlayer.playSound(file)
    })
    audioBridge.onEmbeddedStart(() => {
      const video = app.querySelector('video')
      if (video) audioPlayer.enableEmbeddedAudio(video)
    })
    audioBridge.onEmbeddedStop(() => {
      const video = app.querySelector('video')
      if (video) audioPlayer.disableEmbeddedAudio(video)
    })
    audioBridge.onSetMuted((muted) => {
      audioPlayer.setMuted(muted)
    })
  }

  // 交互处理器：命中盒检测、穿透/交互切换、抚摸/点击/拖拽/右键菜单 (§10)
  const hitboxPx = hitboxToPixels(DEFAULT_HITBOX, {
    x: 0,
    y: 0,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  })
  const interaction = new InteractionHandler({
    getHitboxPx: () => hitboxPx,
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

// DOM 就绪后引导
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap)
} else {
  bootstrap()
}
