import { describe, expect, it } from 'vitest'

import {
  resolveSelectedDisplay,
  type DisplayInfo,
} from '../../src/main/shell/display-manager'

/**
 * 显示器管理只决定窗口出现在哪个工作区。
 * 它不再根据 DPI 或视频尺寸计算媒体缩放比例。
 */
function display(overrides: Partial<DisplayInfo> = {}): DisplayInfo {
  return {
    id: 1001,
    scaleFactor: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    isPrimary: true,
    label: 'Display 1 (主)',
    ...overrides,
  }
}

describe('显示器选择', () => {
  const primary = display()
  const secondary = display({ id: 1002, isPrimary: false, label: 'Display 2' })

  it('未指定时选择主显示器', () => {
    expect(resolveSelectedDisplay([primary, secondary], null)).toEqual({
      display: primary,
      switched: false,
    })
  })

  it('指定存在的显示器时直接返回该工作区', () => {
    expect(resolveSelectedDisplay([primary, secondary], 1002)).toEqual({
      display: secondary,
      switched: false,
    })
  })

  it('显示器消失时回退主显示器', () => {
    expect(resolveSelectedDisplay([primary, secondary], 9999)).toEqual({
      display: primary,
      switched: true,
    })
  })
})
