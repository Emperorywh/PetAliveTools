import { describe, expect, it } from 'vitest'

import {
  defaultBehaviorConfig,
  defaultNeedsState,
  defaultPersonality,
  validateAudioMetaArray,
  validateBehaviorConfig,
  validateNeedsState,
  validatePersona,
} from '../../src/shared/schemas'

/**
 * 项目 JSON 只保存身份、需求、行为和独立音频配置。
 * 视频片段不再拥有 clips.meta 或 track schema。
 */
describe('项目配置 schema', () => {
  it('默认身份不包含运行时镜像开关', () => {
    const persona = { name: '咪咪', personality: defaultPersonality() }

    expect(validatePersona(persona)).toEqual([])
    expect(persona).not.toHaveProperty('symmetrical')
  })

  it('身份名称和五维性格仍会被验证', () => {
    expect(validatePersona({ name: '', personality: defaultPersonality() })).not.toEqual([])
    expect(validatePersona({
      name: '咪咪',
      personality: { ...defaultPersonality(), curiosity: 2 },
    })).not.toEqual([])
  })

  it('默认行为配置没有速率抖动或视频尺度字段', () => {
    const config = defaultBehaviorConfig()

    expect(validateBehaviorConfig(config)).toEqual([])
    expect(config.microRandom).not.toHaveProperty('rateJitter')
    expect(config.shell).not.toHaveProperty('screenPercent')
  })

  it('需求状态和独立音频元数据仍正常校验', () => {
    expect(validateNeedsState(defaultNeedsState())).toEqual([])
    expect(validateAudioMetaArray([])).toEqual([])
    expect(validateAudioMetaArray([{
      id: 'purr',
      file: 'purr.ogg',
      label: '呼噜',
      category: 'action',
      cooldownSec: 5,
      maxPerHour: 10,
    }])).toEqual([])
  })
})
