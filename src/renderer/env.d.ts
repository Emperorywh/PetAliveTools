export {}

declare global {
  interface Window {
    petalive: { version: string }
    /** 精灵播放器实例（开发调试用） */
    __spritePlayer: import('./sprite/video-player').SpritePlayer | undefined
    /** 色键抠像预览实例（#chroma-preview 视图，开发调试用） */
    __chromaKeyPreview: import('./pipeline/chroma-key-preview').ChromaKeyPreview | undefined
    /** 位移曲线校正实例（#walk-correction 视图，开发调试用） */
    __walkCorrection: import('./pipeline/walk-correction').WalkCorrectionView | undefined
  }
}
