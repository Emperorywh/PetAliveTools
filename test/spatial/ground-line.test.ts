import { describe, it, expect } from 'vitest'
import { computeGroundLine, groundedWindowY, clampWindowX, clampWindowY, type Rect } from '../../src/shared/spatial'

describe('computeGroundLine', () => {
  it('returns ground line = workArea.y + workArea.height', () => {
    const workArea: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
    const bounds = computeGroundLine(workArea)
    expect(bounds.groundLine).toBe(1080)
    expect(bounds.x).toBe(0)
    expect(bounds.width).toBe(1920)
  })

  it('accounts for taskbar at bottom', () => {
    const workArea: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
    expect(computeGroundLine(workArea).groundLine).toBe(1040)
  })

  it('accounts for taskbar at top', () => {
    const workArea: Rect = { x: 0, y: 40, width: 1920, height: 1040 }
    expect(computeGroundLine(workArea).groundLine).toBe(1080)
  })

  it('handles multi-monitor offset', () => {
    const workArea: Rect = { x: 1920, y: 0, width: 2560, height: 1440 }
    expect(computeGroundLine(workArea).groundLine).toBe(1440)
  })
})

describe('groundedWindowY (§7.1 足部贴合地面线)', () => {
  it('places window so sprite base (feet) sits on ground line', () => {
    // groundLine 1080, sprite feet at y=380 inside 400px window
    expect(groundedWindowY(1080, 380)).toBe(700)
  })

  it('handles non-zero workArea origin', () => {
    expect(groundedWindowY(1040, 400)).toBe(640)
  })

  it('throws on invalid input', () => {
    expect(() => groundedWindowY(NaN, 100)).toThrow(/groundLine/)
    expect(() => groundedWindowY(100, -1)).toThrow(/spriteBaseY/)
  })
})

describe('clampWindowX (§13 异常位置校正回可见区)', () => {
  const workArea: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

  it('keeps window within work area', () => {
    expect(clampWindowX(workArea, -50, 400)).toBe(0)
    expect(clampWindowX(workArea, 1600, 400)).toBe(1520)
    expect(clampWindowX(workArea, 500, 400)).toBe(500)
  })

  it('clamps to left edge when window wider than work area', () => {
    expect(clampWindowX(workArea, 500, 3000)).toBe(0)
  })

  it('handles offset work area', () => {
    const wa: Rect = { x: 1920, y: 0, width: 2560, height: 1440 }
    expect(clampWindowX(wa, 1000, 400)).toBe(1920)
    expect(clampWindowX(wa, 4200, 400)).toBe(4080)
  })
})

describe('clampWindowY (可见区域 y 钳制)', () => {
  const workArea: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

  it('keeps window within work area', () => {
    expect(clampWindowY(workArea, -50, 400)).toBe(0)
    expect(clampWindowY(workArea, 1000, 400)).toBe(680)
    expect(clampWindowY(workArea, 500, 400)).toBe(500)
  })

  it('clamps to top edge when window taller than work area', () => {
    expect(clampWindowY(workArea, 500, 3000)).toBe(0)
  })

  it('handles offset work area (taskbar at top)', () => {
    const wa: Rect = { x: 0, y: 40, width: 1920, height: 1040 }
    expect(clampWindowY(wa, 10, 400)).toBe(40)
    expect(clampWindowY(wa, 2000, 400)).toBe(680)
  })

  it('throws on invalid input', () => {
    expect(() => clampWindowY(workArea, NaN, 400)).toThrow(/windowY/)
    expect(() => clampWindowY(workArea, 100, 0)).toThrow(/windowHeight/)
  })
})
