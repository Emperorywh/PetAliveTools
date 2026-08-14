import { describe, it, expect } from 'vitest'

import {
  MEDIA_SCHEME,
  localPathToMediaUrl,
  isAbsoluteUrl,
} from '../../src/shared/media-url'

describe('localPathToMediaUrl', () => {
  it('builds petmedia URL from Windows path with backslashes', () => {
    expect(localPathToMediaUrl('C:\\Users\\12899\\Desktop\\PetVideo\\端坐.mp4')).toBe(
      'petmedia://local/C%3A/Users/12899/Desktop/PetVideo/%E7%AB%AF%E5%9D%90.mp4',
    )
  })

  it('percent-encodes spaces in file names', () => {
    expect(localPathToMediaUrl('C:\\clips\\my cat.mp4')).toBe(
      'petmedia://local/C%3A/clips/my%20cat.mp4',
    )
  })

  it('keeps POSIX-style paths intact', () => {
    expect(localPathToMediaUrl('/home/user/video.mp4')).toBe(
      'petmedia://local//home/user/video.mp4',
    )
  })

  it('round-trips through URL pathname decoding', () => {
    const localPath = 'C:\\Users\\12899\\Desktop\\PetVideo\\端坐.mp4'
    const url = new URL(localPathToMediaUrl(localPath))
    expect(url.protocol).toBe(`${MEDIA_SCHEME}:`)
    expect(decodeURIComponent(url.pathname.replace(/^\//, ''))).toBe(
      localPath.replace(/\\/g, '/'),
    )
  })
})

describe('isAbsoluteUrl', () => {
  it('accepts scheme-qualified URLs', () => {
    expect(isAbsoluteUrl('petmedia://local/C%3A/a.mp4')).toBe(true)
    expect(isAbsoluteUrl('file:///C:/a.mp4')).toBe(true)
    expect(isAbsoluteUrl('https://example.com/a.mp3')).toBe(true)
  })

  it('rejects relative file names', () => {
    expect(isAbsoluteUrl('audio/meow.mp3')).toBe(false)
    expect(isAbsoluteUrl('meow.mp3')).toBe(false)
    expect(isAbsoluteUrl('')).toBe(false)
  })
})
