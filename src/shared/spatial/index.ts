/**
 * 空间运动模块 (spatial) — 底部地面条带
 *
 * 负责：地面线计算（workArea 底边）、行走位移曲线驱动窗口平移（脚爪不滑步）、
 * 尺度归一化、边缘转身、拖拽跟随。
 * 参见 SPEC §7 (空间与运动层)。
 *
 * 跨进程共享模块。
 */

/** 矩形区域（与 Electron Rectangle 同构） */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 工作区边界 + 地面线。
 * groundLine = workArea 底边 (§7.1)，宠物足部始终贴合此线。
 */
export interface WorkAreaBounds extends Rect {
  /** 地面线 = workArea.y + workArea.height (§7.1) */
  groundLine: number
}

/**
 * 从工作区矩形计算边界与地面线（纯函数，便于单元测试）。
 *
 * 地面线定义为工作区（workArea）的底边——自动兼容任务栏在任意边、
 * 任务栏自动隐藏、多显示器布局（Electron screen 模块直接提供，§7.1）。
 */
export function computeGroundLine(workArea: Rect): WorkAreaBounds {
  return {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    groundLine: workArea.y + workArea.height
  }
}
