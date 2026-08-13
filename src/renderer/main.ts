// 渲染进程入口 (renderer entry point)
//
// 引导视频精灵播放器：加载测试 WebM-alpha 片段、应用 CSS transform 管线
// （位置/尺度/方向）、启动全局呼吸缩放、渲染接触阴影。
// 参见 SPEC §6 (渲染层)。
//
// 验证说明：将测试 WebM-alpha 片段放置于 src/renderer/public/test-clip.webm，
// 运行 npm run dev 即可在透明窗口中验证播放效果。

import { SpritePlayer, type SpritePlayerConfig } from './sprite/video-player'
import { DEFAULT_SHADOW_CONFIG } from './composition/contact-shadow'
import type { BasePoint } from './composition/anchor-alignment'

/** 测试片段 URL（用户将 WebM-alpha 文件放至 src/renderer/public/test-clip.webm） */
const TEST_CLIP_SRC = 'test-clip.webm'

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

  // 暴露至全局，便于开发时手动调试（VERIFY-002 手动验证时可用于切换阴影/镜像）
  window.__spritePlayer = player
}

// DOM 就绪后引导
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap)
} else {
  bootstrap()
}
