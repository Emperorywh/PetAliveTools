/**
 * 设置面板模块 (settings / renderer)
 *
 * 设置面板 UI：显示器/尺度/音量/节律/性格/自启/快捷键 (§12.4)。
 *
 * 运行于渲染进程。
 */

export { mountSettingsPanel } from './settings-panel'
export type { SettingsPanel } from './settings-panel'
export { keyboardEventToAccelerator } from './settings-panel'
