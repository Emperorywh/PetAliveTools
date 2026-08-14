import { describe, expect, it } from 'vitest'

import {
  clipFromFileName,
  isDirectVideoFile,
  makeDirectClipFileName,
  nextDirectClipVariant,
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
})
