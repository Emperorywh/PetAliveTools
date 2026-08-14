import { describe, expect, it } from 'vitest'

import {
  effectiveRareActionProbability,
  jitteredIdleDuration,
  pickRareAction,
  shouldInsertRareAction,
  shuffleVariants,
} from '../../src/main/scheduler/randomization'

/**
 * 随机化只覆盖行为节奏和文件选择。
 * 测试特意不出现播放速率、视频时间或窗口坐标参数。
 */
describe('与媒体内容无关的行为随机化', () => {
  it('只抖动空闲等待时间，并保持合理下限', () => {
    expect(jitteredIdleDuration(5_000, 2, () => 0)).toBe(3_000)
    expect(jitteredIdleDuration(5_000, 2, () => 1)).toBe(7_000)
    expect(jitteredIdleDuration(500, 10, () => 0)).toBe(1_000)
  })

  it('洗牌返回新数组且不改写输入', () => {
    const source = ['a', 'b', 'c'] as const
    const shuffled = shuffleVariants(source, () => 0)

    expect(shuffled).toEqual(['b', 'c', 'a'])
    expect(source).toEqual(['a', 'b', 'c'])
  })

  it('按概率决定是否插入稀有动作', () => {
    expect(shouldInsertRareAction(0.05, () => 0.04)).toBe(true)
    expect(shouldInsertRareAction(0.05, () => 0.05)).toBe(false)
    expect(pickRareAction([], () => 0)).toBeNull()
    expect(pickRareAction(['blink', 'yawn'], () => 0.9)).toBe('yawn')
  })

  it('允许显式关闭稀有动作，并钳制普通概率', () => {
    expect(effectiveRareActionProbability({ idleJitterSec: 2, signatureProbability: 0 })).toBe(0)
    expect(effectiveRareActionProbability({ idleJitterSec: 2, signatureProbability: 0.001 })).toBe(0.03)
    expect(effectiveRareActionProbability({ idleJitterSec: 2, signatureProbability: 0.5 })).toBe(0.08)
  })
})
