import { describe, expect, it } from 'vitest'

import {
  clipFromFileName,
  isDirectVideoFile,
  makeDirectClipFileName,
  nextDirectClipVariant,
  parseTransitionKey,
  videoExtension,
} from '../src/shared/direct-media'

/**
 * 文件映射测试只操作文件名字符串。
 * 共享层不能读取视频、探测编解码器或产生派生媒体数据。
 */
describe('原样媒体文件名映射', () => {
  it('保留允许直接播放的原始扩展名', () => {
    expect(videoExtension('C:\\source\\clip.MOV')).toBe('.mov')
    expect(isDirectVideoFile('/source/clip.mp4')).toBe(true)
    expect(isDirectVideoFile('/source/clip.avi')).toBe(false)
    expect(makeDirectClipFileName('walk', 'left', 2, '.mov')).toBe('walk__left__02.mov')
  })

  it('由文件名生成最小运行时描述', () => {
    const clip = clipFromFileName('walk__right__03.webm')

    expect(clip).toMatchObject({
      id: 'walk__right__03',
      fileName: 'walk__right__03.webm',
      state: 'walk',
      direction: 'right',
      variant: 3,
      embeddedAudio: true,
    })
    expect(clip).not.toHaveProperty('loopInSec')
    expect(clip).not.toHaveProperty('track')
    expect(clip).not.toHaveProperty('scaleHint')
  })

  it('兼容旧文件名但不识别轨迹或元数据文件', () => {
    expect(clipFromFileName('walk_left_01.webm')).toMatchObject({
      state: 'walk',
      direction: 'left',
      variant: 1,
    })
    expect(clipFromFileName('walk_left_01.track.json')).toBeNull()
    expect(clipFromFileName('clips.meta.json')).toBeNull()
  })

  it('下一个变体编号仅由已存在的同动作同方向媒体决定', () => {
    expect(nextDirectClipVariant([
      'walk__left__01.mp4',
      'walk__left__04.mov',
      'walk__right__09.webm',
      'walk__left__04.track.json',
    ], 'walk', 'left')).toBe(5)
  })

  it('过渡片段：端点键命名可构造、可扫描、端点按对独立编号', () => {
    // 导入向导生成 transition_<from>_to_<to>__dir__NN 文件名
    expect(makeDirectClipFileName('transition_sit_to_stand', 'none', 1, '.webm')).toBe(
      'transition_sit_to_stand__none__01.webm',
    )
    expect(makeDirectClipFileName('transition_lie_to_sit', 'none', 2, '.mp4')).toBe(
      'transition_lie_to_sit__none__02.mp4',
    )

    const clip = clipFromFileName('transition_sit_to_stand__none__01.webm')
    expect(clip).toMatchObject({
      id: 'transition_sit_to_stand__none__01',
      state: 'transition',
      transition: { from: 'sit', to: 'stand' },
      variant: 1,
      loop: false,
    })

    // 端点对分别编号：sit_to_stand 已有 01/03，lie_to_sit 独立从 01 起
    expect(
      nextDirectClipVariant(
        ['transition_sit_to_stand__none__01.webm', 'transition_sit_to_stand__none__03.webm'],
        'transition_sit_to_stand',
        'none',
      ),
    ).toBe(4)
    expect(
      nextDirectClipVariant(['transition_sit_to_stand__none__01.webm'], 'transition_lie_to_sit', 'none'),
    ).toBe(1)
  })

  it('旧版向导入库的无端点过渡文件仍可识别但不携带端点', () => {
    const legacy = clipFromFileName('transition__none__01.webm')
    expect(legacy).toMatchObject({ state: 'transition' })
    expect(legacy?.transition).toBeUndefined()
    expect(parseTransitionKey('transition')).toBeNull()
  })

  it('手工命名的旧过渡文件 transition_X_to_Y.webm 可推导端点', () => {
    expect(clipFromFileName('transition_sit_to_stand.webm')).toMatchObject({
      state: 'transition',
      transition: { from: 'sit', to: 'stand' },
    })
  })

  it('sig_ 自定义招牌动作：可命名、可扫描、标记 signature 与 prop', () => {
    expect(makeDirectClipFileName('sig_backflip', 'none', 1, '.webm')).toBe(
      'sig_backflip__none__01.webm',
    )
    const clip = clipFromFileName('sig_backflip__none__01.webm')
    expect(clip).toMatchObject({
      id: 'sig_backflip__none__01',
      state: 'sig_backflip',
      category: 'signature',
      signature: true,
      prop: true,
      loop: false,
      anchor: 'none',
    })
    // 非法招牌键（大写/空/前缀错误）拒绝
    expect(() => makeDirectClipFileName('sig_Bad', 'none', 1, '.webm')).toThrow()
    expect(clipFromFileName('signature_x__none__01.webm')).toBeNull()
    expect(clipFromFileName('sig__none__01.webm')).toBeNull()
  })
})
