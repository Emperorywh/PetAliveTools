/**
 * 转码预设与分辨率归一化测试 (§5.2, §7.4)
 *
 * 验证：
 * - 预设表完整性（standard / high / sleep 三档全覆盖）
 * - 比特率/CRF 单调性（high > standard > sleep）
 * - recommendPreset 推荐逻辑
 * - computeTargetEdge / computeScaleDimensions 分辨率归一化
 */
import { describe, it, expect } from 'vitest'

import {
  TRANSCODE_PRESETS,
  RESOLUTION_PRESETS,
  TARGET_FPS,
  PIXEL_FORMAT,
  VIDEO_CODEC,
  recommendPreset,
  computeTargetEdge,
  computeScaleDimensions
} from '../../src/shared/pipeline/presets'
import type { TranscodePresetName, ResolutionTier } from '../../src/shared/pipeline/presets'

describe('TRANSCODE_PRESETS (§5.2)', () => {
  it('defines exactly three presets: standard, high, sleep', () => {
    const names = Object.keys(TRANSCODE_PRESETS) as TranscodePresetName[]
    expect(names).toEqual(['standard', 'high', 'sleep'])
  })

  it('each preset has valid encoding parameters', () => {
    for (const name of Object.keys(TRANSCODE_PRESETS) as TranscodePresetName[]) {
      const p = TRANSCODE_PRESETS[name]
      expect(p.name).toBe(name)
      expect(p.videoBitrate).toBeGreaterThan(0)
      expect(p.crf).toBeGreaterThanOrEqual(0)
      expect(p.crf).toBeLessThanOrEqual(63)
      expect(['good', 'best', 'realtime']).toContain(p.deadline)
      expect(p.gopSize).toBeGreaterThan(0)
    }
  })

  it('high preset has higher bitrate and lower CRF than standard', () => {
    expect(TRANSCODE_PRESETS.high.videoBitrate).toBeGreaterThan(
      TRANSCODE_PRESETS.standard.videoBitrate
    )
    expect(TRANSCODE_PRESETS.high.crf).toBeLessThan(TRANSCODE_PRESETS.standard.crf)
  })

  it('sleep preset has lower bitrate than standard (§5.2 长片段降码率)', () => {
    expect(TRANSCODE_PRESETS.sleep.videoBitrate).toBeLessThan(
      TRANSCODE_PRESETS.standard.videoBitrate
    )
    expect(TRANSCODE_PRESETS.sleep.crf).toBeGreaterThan(TRANSCODE_PRESETS.standard.crf)
  })

  it('sleep preset has longer GOP (static content benefits from longer GOP)', () => {
    expect(TRANSCODE_PRESETS.sleep.gopSize).toBeGreaterThanOrEqual(
      TRANSCODE_PRESETS.standard.gopSize
    )
  })
})

describe('RESOLUTION_PRESETS (§14)', () => {
  it('defines exactly three tiers: compact, normal, large', () => {
    const tiers = Object.keys(RESOLUTION_PRESETS) as ResolutionTier[]
    expect(tiers).toEqual(['compact', 'normal', 'large'])
  })

  it('maxEdge is monotonically increasing: compact < normal < large', () => {
    expect(RESOLUTION_PRESETS.compact.maxEdge).toBeLessThan(RESOLUTION_PRESETS.normal.maxEdge)
    expect(RESOLUTION_PRESETS.normal.maxEdge).toBeLessThan(RESOLUTION_PRESETS.large.maxEdge)
  })
})

describe('encoding constants (§5.2)', () => {
  it('TARGET_FPS is 30', () => {
    expect(TARGET_FPS).toBe(30)
  })

  it('PIXEL_FORMAT supports alpha (yuva420p)', () => {
    expect(PIXEL_FORMAT).toBe('yuva420p')
  })

  it('VIDEO_CODEC is libvpx-vp9', () => {
    expect(VIDEO_CODEC).toBe('libvpx-vp9')
  })
})

describe('recommendPreset (§5.2)', () => {
  it('recommends sleep for long looping static states', () => {
    expect(recommendPreset('sleep', true, false)).toBe('sleep')
    expect(recommendPreset('lie', true, false)).toBe('sleep')
    expect(recommendPreset('groom', true, false)).toBe('sleep')
  })

  it('recommends high for signature clips', () => {
    expect(recommendPreset('signature_flop', false, true)).toBe('high')
    expect(recommendPreset('idle_sit', false, true)).toBe('high')
  })

  it('recommends standard for default cases', () => {
    expect(recommendPreset('idle_sit', false, false)).toBe('standard')
    expect(recommendPreset('walk', false, false)).toBe('standard')
  })

  it('does not recommend sleep for non-loop sleep-like states', () => {
    // sleep state but not loop → not a long static clip
    expect(recommendPreset('sleep', false, false)).toBe('standard')
  })

  it('signature takes priority over loop for sleep-like states', () => {
    expect(recommendPreset('sleep', true, true)).toBe('high')
  })
})

describe('computeTargetEdge (§7.4)', () => {
  it('computes target edge from screen percentage and scaleHint', () => {
    // 1080p screen, 15% shoulder height, scaleHint 1.0
    const edge = computeTargetEdge(1080, 0.15, 1.0)
    // 1080 * 0.15 * 1.6 * 1.0 = 259.2 → round to even = 260
    expect(edge).toBe(260)
  })

  it('result is always even (VP9 requirement)', () => {
    for (const pct of [0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18]) {
      for (const hint of [0.8, 0.9, 1.0, 1.1, 1.2]) {
        const edge = computeTargetEdge(1080, pct, hint)
        expect(edge % 2).toBe(0)
      }
    }
  })

  it('scales proportionally with scaleHint', () => {
    const base = computeTargetEdge(1080, 0.15, 1.0)
    const doubled = computeTargetEdge(1080, 0.15, 2.0)
    // ratio ~2 but rounded to even
    expect(doubled).toBeGreaterThan(base * 1.8)
    expect(doubled).toBeLessThan(base * 2.2)
  })

  it('scales proportionally with screenPercent', () => {
    const small = computeTargetEdge(1080, 0.12, 1.0)
    const large = computeTargetEdge(1080, 0.18, 1.0)
    expect(large).toBeGreaterThan(small)
  })

  it('throws on invalid inputs', () => {
    expect(() => computeTargetEdge(0, 0.15, 1.0)).toThrow()
    expect(() => computeTargetEdge(1080, 0, 1.0)).toThrow()
    expect(() => computeTargetEdge(1080, 1.0, 1.0)).toThrow()
    expect(() => computeTargetEdge(1080, 0.15, 0)).toThrow()
    expect(() => computeTargetEdge(1080, 0.15, -1)).toThrow()
    expect(() => computeTargetEdge(1080, NaN, 1.0)).toThrow()
  })
})

describe('computeScaleDimensions', () => {
  it('returns null when source is already within target (no upscale)', () => {
    expect(computeScaleDimensions(320, 180, 480)).toBeNull()
    expect(computeScaleDimensions(480, 270, 480)).toBeNull()
  })

  it('scales down landscape to maxEdge on the longer dimension', () => {
    const result = computeScaleDimensions(1920, 1080, 480)
    expect(result).not.toBeNull()
    // 1920 is longer edge; scale factor = 480/1920 = 0.25
    // width = 1920 * 0.25 = 480, height = 1080 * 0.25 = 270 → even
    expect(result!.width).toBe(480)
    expect(result!.height).toBe(270)
  })

  it('scales down portrait to maxEdge on the longer dimension', () => {
    const result = computeScaleDimensions(1080, 1920, 480)
    expect(result).not.toBeNull()
    expect(result!.width).toBe(270)
    expect(result!.height).toBe(480)
  })

  it('produces even dimensions (VP9 requirement)', () => {
    // Use odd source dimensions to verify rounding
    const result = computeScaleDimensions(641, 481, 300)
    expect(result).not.toBeNull()
    expect(result!.width % 2).toBe(0)
    expect(result!.height % 2).toBe(0)
  })

  it('maintains aspect ratio approximately', () => {
    const srcW = 1920
    const srcH = 1080
    const result = computeScaleDimensions(srcW, srcH, 480)
    expect(result).not.toBeNull()
    const srcRatio = srcW / srcH
    const outRatio = result!.width / result!.height
    expect(Math.abs(srcRatio - outRatio)).toBeLessThan(0.05) // ~5% tolerance due to even rounding
  })

  it('throws on invalid inputs', () => {
    expect(() => computeScaleDimensions(0, 100, 480)).toThrow()
    expect(() => computeScaleDimensions(100, 0, 480)).toThrow()
    expect(() => computeScaleDimensions(100, 100, 0)).toThrow()
    expect(() => computeScaleDimensions(NaN, 100, 480)).toThrow()
  })
})
