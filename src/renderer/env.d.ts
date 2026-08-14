export {}

declare global {
  interface Window {
    petalive: {
      version: string
      import: import('../preload').ImportBridge
      input: import('../preload').InputBridge
      audio: import('../preload').AudioBridge
      settings: import('../preload').SettingsBridge
      scheduler: import('../preload').SchedulerBridge
      profile: import('../preload').ProfileBridge
    }
    /** 精灵播放器实例（开发调试用） */
    __spritePlayer: import('./sprite/video-player').SpritePlayer | undefined
    /** 色键抠像预览实例（#chroma-preview 视图，开发调试用） */
    __chromaKeyPreview: import('./pipeline/chroma-key-preview').ChromaKeyPreview | undefined
    /** 位移曲线校正实例（#walk-correction 视图，开发调试用） */
    __walkCorrection: import('./pipeline/walk-correction').WalkCorrectionView | undefined
    /** 导入向导实例（#import-wizard 视图，开发调试用） */
    __importWizard: import('./pipeline/import-wizard').ImportWizard | undefined
    /** 设置面板实例（#settings 视图，开发调试用） */
    __settingsPanel: import('./settings/settings-panel').SettingsPanel | undefined
    /** 交互处理器实例（开发调试用） */
    __interaction: import('./input/interaction').InteractionHandler | undefined
    /** 音频播放器实例（开发调试用） */
    __audioPlayer: import('./audio/player').AudioPlayer | undefined
  }
}
