/**
 * 开机自启管理 (auto-launch) — §12.4
 *
 * 使用 Electron app.setLoginItemSettings / getLoginItemSettings 实现跨平台
 * 开机自启。默认开启，可在设置面板中关闭。
 *
 * 运行于主进程。
 */

import { app } from 'electron'

/**
 * 查询当前开机自启状态。
 *
 * 注意：app.isPackaged 为 false（开发模式）时，Electron 的 login item 设置
 * 可能不可靠——此函数仍返回 Electron 报告的值。
 */
export function isAutoLaunchEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

/**
 * 设置开机自启 (§12.4)。
 *
 * @param enabled true = 开机自启，false = 关闭
 */
export function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ['--hidden'],
  })
}

/**
 * 切换开机自启，返回新状态。
 */
export function toggleAutoLaunch(): boolean {
  const next = !isAutoLaunchEnabled()
  setAutoLaunch(next)
  return next
}
