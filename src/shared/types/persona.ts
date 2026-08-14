/**
 * 宠物性格与身份 (Persona)
 *
 * 参见 SPEC 的性格参数与项目配置章节。
 *
 * 跨进程共享类型。
 */

/** 性格 5 维气质 (§9.6)，每维 0–1 浮点 */
export interface Personality {
  /** 活泼：↑→ walk/play 权重↑、idle 权重↓ */
  readonly liveliness: number
  /** 慵懒：↑→ sleep/lie 权重↑ */
  readonly laziness: number
  /** 粘人：↑→ 被抚摸愉悦增益↑、注意力下降更快 */
  readonly clinginess: number
  /** 胆小：↑→ 交互后更快回静止态、被抚摸权重↓ */
  readonly timidity: number
  /** 好奇：↑→ 稀有动作概率↑ */
  readonly curiosity: number
}

/**
 * 宠物级身份与性格。
 *
 * 不再保存“可镜像”属性，因为运行时不会镜像任何导入片段。
 */
export interface Persona {
  /** 宠物名字 */
  readonly name: string
  /** 性格 5 维 (§9.6) */
  readonly personality: Personality
}
