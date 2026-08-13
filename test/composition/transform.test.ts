import { describe, it, expect } from 'vitest'
import { buildTransform, type TransformParams } from '../../src/renderer/composition/transform'

/** 从 transform 字符串中提取 scale() 的数值 */
function extractScale(transform: string): number {
  const match = transform.match(/scale\(([-\d.]+)\)/)
  if (!match) throw new Error(`scale() not found in: ${transform}`)
  return parseFloat(match[1])
}

describe('buildTransform', () => {
  const baseParams: TransformParams = {
    translateX: 100,
    translateY: 200,
    scale: 1.0,
    flip: false,
    breathing: 1.0,
  }

  it('produces translate → scale → scaleX order (§6.2)', () => {
    const transform = buildTransform(baseParams)
    // 验证 transform 包含 translate, scale, scaleX 三部分
    expect(transform).toMatch(/^translate\(/)
    expect(transform).toMatch(/scale\(/)
    expect(transform).toMatch(/scaleX\(/)

    // 验证顺序：translate 在 scale 前，scale 在 scaleX 前
    const translateIdx = transform.indexOf('translate(')
    const scaleIdx = transform.indexOf('scale(')
    const scaleXIdx = transform.indexOf('scaleX(')

    expect(translateIdx).toBeLessThan(scaleIdx)
    expect(scaleIdx).toBeLessThan(scaleXIdx)
  })

  it('applies translate values', () => {
    const transform = buildTransform({ ...baseParams, translateX: 42, translateY: 99 })
    expect(transform).toContain('translate(42px, 99px)')
  })

  it('combines scale and breathing into total scale', () => {
    const transform = buildTransform({ ...baseParams, scale: 0.8, breathing: 1.006 })
    // 0.8 * 1.006 = 0.8048（允许浮点误差）
    expect(extractScale(transform)).toBeCloseTo(0.8048, 4)
  })

  it('applies scaleX(-1) when flip is true', () => {
    const transform = buildTransform({ ...baseParams, flip: true })
    expect(transform).toContain('scaleX(-1)')
  })

  it('applies scaleX(1) when flip is false', () => {
    const transform = buildTransform({ ...baseParams, flip: false })
    expect(transform).toContain('scaleX(1)')
  })

  it('handles breathing amplitude correctly (±0.6%)', () => {
    const t1 = buildTransform({ ...baseParams, scale: 1.0, breathing: 1.006 })
    const t2 = buildTransform({ ...baseParams, scale: 1.0, breathing: 0.994 })

    expect(extractScale(t1)).toBeCloseTo(1.006, 4)
    expect(extractScale(t2)).toBeCloseTo(0.994, 4)
  })

  it('produces a complete well-formed transform string', () => {
    const transform = buildTransform({
      translateX: 40,
      translateY: 140,
      scale: 1.5,
      flip: true,
      breathing: 1.003,
    })

    expect(transform).toContain('translate(40px, 140px)')
    // 1.5 * 1.003 = 1.5045（允许浮点误差）
    expect(extractScale(transform)).toBeCloseTo(1.5045, 4)
    expect(transform).toContain('scaleX(-1)')
  })
})
