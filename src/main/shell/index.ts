/**
 * 外壳模块 (shell)
 *
 * 负责：系统托盘图标、开机自启 (auto-launch)、全局快捷键 (globalShortcut)、
 * 设置面板、多显示器管理。
 * 参见 SPEC §10 (交互层)、§12.4 (外壳)、§6.4 (多显示器/DPI)、§13 (显示变化)。
 *
 * 运行于主进程。
 */

export { isAutoLaunchEnabled, setAutoLaunch, toggleAutoLaunch } from './auto-launch'

export {
  HotkeyManager,
  DEFAULT_HIDE_HOTKEY,
  isValidAccelerator,
} from './hotkey-config'

export {
  DisplayManager,
  enumerateAllDisplays,
  toDisplayInfo,
  resolveSelectedDisplay,
  computeDpiAwareScale,
  minVideoResolutionForDpi,
} from './display-manager'
export type {
  DisplayInfo,
  DisplayChangeEvent,
  DisplayChangeListener,
} from './display-manager'

export {
  SettingsStore,
  mergeShellSettings,
  mergePersonality,
} from './settings-store'

export {
  buildProfileMenuSection,
  buildTrayTemplate,
  ProfileSwitcher,
} from './profile-switcher'
export type {
  TrayMenuCallbacks,
  TrayMenuState,
  FileDialogs,
  ProfileSwitcherHost,
} from './profile-switcher'
