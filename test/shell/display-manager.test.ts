import { describe, it, expect } from 'vitest'

import {
  resolveSelectedDisplay,
  computeDpiAwareScale,
  minVideoResolutionForDpi,
  type DisplayInfo,
} from '../../src/main/shell/display-manager'
import { SHOULDER_HEIGHT_FACTOR } from '../../src/shared/spatial'

/** 构建测试用 DisplayInfo */
function makeDisplay(overrides: Partial<DisplayInfo> = {}): DisplayInfo {
  return {
    id: 1001,
    scaleFactor: 1.0,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    isPrimary: true,
    label: 'Display 1 (主)',
    ...overrides,
  }
}

// ── resolveSelectedDisplay ── //

describe('resolveSelectedDisplay (§6.4)', () => {
  const primary = makeDisplay({ id: 1001, isPrimary: true })
  const secondary = makeDisplay({
    id: 1002,
    isPrimary: false,
    label: 'Display 2',
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
    workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
  })

  const displays = [primary, secondary]

  it('returns primary when displayId is null', () => {
    const { display, switched } = resolveSelectedDisplay(displays, null)
    expect(display.id).toBe(1001)
    expect(switched).toBe(false)
  })

  it('returns selected display when id matches', () => {
    const { display, switched } = resolveSelectedDisplay(displays, 1002)
    expect(display.id).toBe(1002)
    expect(switched).toBe(false)
  })

  it('falls back to primary and marks switched when displayId not found', () => {
    const { display, switched } = resolveSelectedDisplay(displays, 99999)
    expect(display.id).toBe(1001)
    expect(switched).toBe(true)
  })

  it('falls back to first display if no primary', () => {
    const nonPrimary = makeDisplay({ id: 2001, isPrimary: false })
    const { display } = resolveSelectedDisplay([nonPrimary], 999)
    expect(display.id).toBe(2001)
  })

  it('returns primary without switch when displayId is null even if multiple displays', () => {
    const { display, switched } = resolveSelectedDisplay(displays, null)
    expect(display.isPrimary).toBe(true)
    expect(switched).toBe(false)
  })
})

// ── computeDpiAwareScale ── //

describe('computeDpiAwareScale (§6.4 高 DPI 归一化尺度)', () => {
  it('returns same scale as computeNormalizedScale for scaleFactor=1.0', () => {
    const scale = computeDpiAwareScale({
      workAreaHeightDip: 1040,
      scaleFactor: 1.0,
      screenPercent: 0.15,
      clipHeightPx: 259,
      scaleHint: 1.0,
    })
    // Same as: 1040 * 0.15 * 1.6 * 1.0 / 259
    expect(scale).toBeCloseTo((1040 * 0.15 * SHOULDER_HEIGHT_FACTOR) / 259, 2)
  })

  it('returns DIP-based scale for high DPI (scaleFactor=2.0)', () => {
    // On a 2x display, workArea height in DIP is half physical.
    // Scale is still based on DIP height for window positioning.
    const scale = computeDpiAwareScale({
      workAreaHeightDip: 540, // physical 1080 at 2x
      scaleFactor: 2.0,
      screenPercent: 0.15,
      clipHeightPx: 259,
      scaleHint: 1.0,
    })
    // Scale based on DIP height: 540 * 0.15 * 1.6 / 259
    expect(scale).toBeCloseTo((540 * 0.15 * SHOULDER_HEIGHT_FACTOR) / 259, 2)
  })

  it('applies scaleHint multiplicatively', () => {
    const base = computeDpiAwareScale({
      workAreaHeightDip: 1040, scaleFactor: 1.0, screenPercent: 0.15, clipHeightPx: 259, scaleHint: 1.0,
    })
    const doubled = computeDpiAwareScale({
      workAreaHeightDip: 1040, scaleFactor: 1.0, screenPercent: 0.15, clipHeightPx: 259, scaleHint: 2.0,
    })
    expect(doubled).toBeCloseTo(base * 2, 2)
  })

  it('throws on invalid scaleFactor', () => {
    expect(() => computeDpiAwareScale({
      workAreaHeightDip: 1040, scaleFactor: 0, screenPercent: 0.15, clipHeightPx: 259, scaleHint: 1.0,
    })).toThrow()
    expect(() => computeDpiAwareScale({
      workAreaHeightDip: 1040, scaleFactor: -1, screenPercent: 0.15, clipHeightPx: 259, scaleHint: 1.0,
    })).toThrow()
  })

  it('returns positive scale for any valid input', () => {
    const scale = computeDpiAwareScale({
      workAreaHeightDip: 800, scaleFactor: 1.5, screenPercent: 0.12, clipHeightPx: 200, scaleHint: 1.0,
    })
    expect(scale).toBeGreaterThan(0)
  })
})

// ── minVideoResolutionForDpi ── //

describe('minVideoResolutionForDpi (§6.4)', () => {
  it('returns DIP height for scaleFactor 1.0', () => {
    expect(minVideoResolutionForDpi(1040, 1.0)).toBe(1040)
  })

  it('doubles resolution for 2x DPI', () => {
    expect(minVideoResolutionForDpi(540, 2.0)).toBe(1080)
  })

  it('handles fractional scaleFactor (1.25)', () => {
    expect(minVideoResolutionForDpi(800, 1.25)).toBe(1000)
  })

  it('handles fractional scaleFactor (1.5)', () => {
    expect(minVideoResolutionForDpi(720, 1.5)).toBe(1080)
  })

  it('ceils non-integer results', () => {
    expect(minVideoResolutionForDpi(1000, 1.333)).toBe(1333)
  })
})
