import { describe, expect, it } from 'vitest'
import {
  SHOOTING_LIST,
  getStartupSetItems,
  variantSuggestionText,
  type ShootingListItem,
} from '../../src/shared/shooting-list'

describe('建议段数文案', () => {
  it('下限等于上限时显示单值', () => {
    const stand = itemOf('stand')
    expect(variantSuggestionText(stand)).toBe('1 段')
  })

  it('下限小于上限时显示区间', () => {
    const idleSit = itemOf('idle_sit')
    expect(variantSuggestionText(idleSit)).toBe('2–3 段')
  })

  it('区间端点取自清单建议值且上限不小于下限', () => {
    for (const item of SHOOTING_LIST) {
      expect(item.suggestedVariantsMax).toBeGreaterThanOrEqual(item.suggestedVariants)
      expect(variantSuggestionText(item)).toContain(String(item.suggestedVariants))
      expect(variantSuggestionText(item)).toContain(String(item.suggestedVariantsMax))
    }
  })
})

describe('最小启动集', () => {
  it('由 6 个主体动作构成', () => {
    expect(getStartupSetItems().map((item) => item.state)).toEqual([
      'idle_sit',
      'stand',
      'walk',
      'lie',
      'sleep',
      'transition',
    ])
  })
})

function itemOf(state: string): ShootingListItem {
  const item = SHOOTING_LIST.find((candidate) => candidate.state === state)
  if (!item) throw new Error(`missing shooting list item: ${state}`)
  return item
}
