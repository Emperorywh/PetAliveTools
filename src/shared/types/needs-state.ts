/**
 * 需求状态 (NeedsState)
 *
 * 参见 SPEC §9.4 (需求模型)、§12.1 (needs-state.json)。
 *
 * 四维需求均 0–100 整数或浮点，跨会话持久化。
 *
 * 跨进程共享类型。
 */

export interface NeedsState {
  /** 饥饿：按真实时间缓慢上升，高位触发讨食 (§9.4) */
  readonly hunger: number
  /** 疲劳：活动累积 / 夜间上升，高位触发睡眠 (§9.4) */
  readonly fatigue: number
  /** 愉悦：交互提升，闲置缓慢回落 (§9.4) */
  readonly happiness: number
  /** 注意力：长时间无交互下降，高位触发求玩/呼唤 (§9.4) */
  readonly attention: number
}
