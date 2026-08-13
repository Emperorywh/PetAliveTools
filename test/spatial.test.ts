import { describe, it, expect } from 'vitest'
import { computeGroundLine, type Rect } from '../src/shared/spatial'

describe('computeGroundLine', () => {
  it('returns ground line = workArea.y + workArea.height', () => {
    const workArea: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
    const bounds = computeGroundLine(workArea)

    expect(bounds.groundLine).toBe(1080)
    expect(bounds.x).toBe(0)
    expect(bounds.y).toBe(0)
    expect(bounds.width).toBe(1920)
    expect(bounds.height).toBe(1080)
  })

  it('accounts for taskbar at bottom (workArea.height < screen.height)', () => {
    // Physical screen 1920x1080, taskbar 40px at bottom
    const workArea: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
    const bounds = computeGroundLine(workArea)

    // Ground line sits on top of the taskbar
    expect(bounds.groundLine).toBe(1040)
  })

  it('accounts for taskbar at top (workArea.y > 0)', () => {
    // Taskbar 40px at top
    const workArea: Rect = { x: 0, y: 40, width: 1920, height: 1040 }
    const bounds = computeGroundLine(workArea)

    expect(bounds.groundLine).toBe(1080)
  })

  it('accounts for taskbar at left', () => {
    // Taskbar at left edge
    const workArea: Rect = { x: 48, y: 0, width: 1872, height: 1080 }
    const bounds = computeGroundLine(workArea)

    expect(bounds.groundLine).toBe(1080)
    expect(bounds.x).toBe(48)
  })

  it('handles multi-monitor offset (secondary display)', () => {
    // Secondary monitor to the right of primary
    const workArea: Rect = { x: 1920, y: 0, width: 2560, height: 1440 }
    const bounds = computeGroundLine(workArea)

    expect(bounds.groundLine).toBe(1440)
    expect(bounds.x).toBe(1920)
  })

  it('handles vertical monitor offset', () => {
    // Monitor positioned above primary
    const workArea: Rect = { x: 0, y: -1440, width: 1920, height: 1440 }
    const bounds = computeGroundLine(workArea)

    expect(bounds.groundLine).toBe(0)
  })
})
