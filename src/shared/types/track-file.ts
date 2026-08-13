/**
 * 行走位移曲线文件 (track.json)
 *
 * 参见 SPEC §5.3 (行走跟踪裁切)、§7.2 (位移曲线驱动窗口平移)、§12.1 (clips/ 目录)。
 *
 * 行走片段入库时跟踪自动生成的逐帧位移曲线，存为
 * `<clip_id>.track.json`；导入 UI 支持手动校正关键点（停顿/变速处）。
 * 运行时空间层按 `window.x = startX + displacement(t) × scale` 采样，
 * 保证窗口平移与画面内步态严格同步、脚爪不滑步。
 *
 * 跨进程共享类型。
 */

/** 手动校正关键点：指定帧处的校正后 x 偏移（源像素） */
export interface TrackKeypoint {
  /** 帧索引（0 起，< frameCount） */
  readonly frame: number
  /** 该帧的 x 偏移（源像素，相对片段起点） */
  readonly offset: number
}

/** 位移曲线文件 (track.json) 内容 */
export interface TrackFile {
  /** 格式版本 */
  readonly version: 1
  /** 片段帧率（Hz，与转码统一帧率一致，§5.2） */
  readonly fps: number
  /** 帧数（= offsets.length） */
  readonly frameCount: number
  /**
   * 跟踪画面宽度（像素）：offsets 以此宽度的画面像素为单位。
   * 跟踪在降采样帧上进行（§5.5 导入流程），与转码后片段分辨率不同；
   * 运行时据此换算屏幕位移比例 scale = 显示宽度 / sourceWidth (§7.2)。
   */
  readonly sourceWidth: number
  /** 逐帧 x 偏移序列（跟踪画面像素；offsets[0] 归一为 0） */
  readonly offsets: readonly number[]
  /** 手动校正关键点（按帧升序，帧唯一） */
  readonly keypoints: readonly TrackKeypoint[]
}
