/**
 * 宠物性格与身份 (Persona)
 *
 * 参见 SPEC §9.6 (性格 5 维参数化)、§4.3 (对称性为宠物级属性)、§12.1 (persona.json)。
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
 * 宠物级属性 (§12.1 persona.json)
 *
 * symmetrical 为宠物级属性 (§4.3)，记录在此处而非片段元数据中。
 */
export interface Persona {
  /** 宠物名字 */
  readonly name: string
  /** 花纹是否对称 (§4.3)：true 允许运行时镜像生成反方向 */
  readonly symmetrical: boolean
  /** 性格 5 维 (§9.6) */
  readonly personality: Personality
}
