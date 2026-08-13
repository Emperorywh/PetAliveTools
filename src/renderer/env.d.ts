export {}

declare global {
  interface Window {
    petalive: { version: string }
    /** 精灵播放器实例（开发调试用） */
    __spritePlayer: import('./sprite/video-player').SpritePlayer | undefined
  }
}
