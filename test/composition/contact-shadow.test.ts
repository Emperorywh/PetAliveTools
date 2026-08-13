import { describe, it, expect } from 'vitest'
import {
  computeShadowStyle,
  DEFAULT_SHADOW_CONFIG,
  type ContactShadowConfig,
} from '../../src/renderer/composition/contact-shadow'

describe('DEFAULT_SHADOW_CONFIG', () => {
  it('is visible by default', () => {
    expect(DEFAULT_SHADOW_CONFIG.visible).toBe(true)
  })

  it('has very low opacity (faint, §6.5)', () => {
    expect(DEFAULT_SHADOW_CONFIG.opacity).toBeLessThanOrEqual(0.2)
  })

  it('has wider-than-tall ratio (ellipse)', () => {
    expect(DEFAULT_SHADOW_CONFIG.widthRatio).toBeGreaterThan(DEFAULT_SHADOW_CONFIG.heightRatio)
  })
})

describe('computeShadowStyle', () => {
  it('scales shadow width proportionally to sprite width', () => {
    const style100 = computeShadowStyle(100, DEFAULT_SHADOW_CONFIG)
    const style200 = computeShadowStyle(200, DEFAULT_SHADOW_CONFIG)

    expect(style200.width).toBeCloseTo(style100.width * 2, 6)
    expect(style200.height).toBeCloseTo(style100.height * 2, 6)
  })

  it('returns opacity 0 when visible is false', () => {
    const config: ContactShadowConfig = {
      ...DEFAULT_SHADOW_CONFIG,
      visible: false,
    }
    const style = computeShadowStyle(300, config)

    expect(style.opacity).toBe(0)
    // 尺寸仍然计算（仅透明度为 0）
    expect(style.width).toBeGreaterThan(0)
    expect(style.height).toBeGreaterThan(0)
  })

  it('returns configured opacity when visible', () => {
    const config: ContactShadowConfig = {
      visible: true,
      opacity: 0.25,
      widthRatio: 0.7,
      heightRatio: 0.12,
    }
    const style = computeShadowStyle(400, config)

    expect(style.opacity).toBeCloseTo(0.25, 6)
    expect(style.width).toBeCloseTo(400 * 0.7, 6)
    expect(style.height).toBeCloseTo(400 * 0.12, 6)
  })

  it('uses default config when omitted', () => {
    const styleExplicit = computeShadowStyle(250, DEFAULT_SHADOW_CONFIG)
    const styleDefault = computeShadowStyle(250)

    expect(styleDefault.width).toBe(styleExplicit.width)
    expect(styleDefault.height).toBe(styleExplicit.height)
    expect(styleDefault.opacity).toBe(styleExplicit.opacity)
  })

  it('shadow is elliptical (width > height)', () => {
    const style = computeShadowStyle(500)

    expect(style.width).toBeGreaterThan(style.height)
  })
})
