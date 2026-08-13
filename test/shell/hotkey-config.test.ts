import { describe, it, expect } from 'vitest'

import { isValidAccelerator, DEFAULT_HIDE_HOTKEY } from '../../src/main/shell/hotkey-config'
import { keyboardEventToAccelerator } from '../../src/renderer/settings/settings-panel'

describe('isValidAccelerator (§10)', () => {
  it('accepts valid accelerators', () => {
    expect(isValidAccelerator('CommandOrControl+Shift+H')).toBe(true)
    expect(isValidAccelerator('Ctrl+Alt+P')).toBe(true)
    expect(isValidAccelerator('F5')).toBe(true)
    expect(isValidAccelerator('A')).toBe(true)
  })

  it('rejects empty strings', () => {
    expect(isValidAccelerator('')).toBe(false)
    expect(isValidAccelerator('   ')).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isValidAccelerator(42 as unknown as string)).toBe(false)
    expect(isValidAccelerator(null as unknown as string)).toBe(false)
  })

  it('DEFAULT_HIDE_HOTKEY is CommandOrControl+Shift+H', () => {
    expect(DEFAULT_HIDE_HOTKEY).toBe('CommandOrControl+Shift+H')
  })
})

describe('keyboardEventToAccelerator (§10 快捷键捕获)', () => {
  function makeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
      key: 'H',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...overrides,
    } as KeyboardEvent
  }

  it('converts Ctrl+Shift+H', () => {
    const result = keyboardEventToAccelerator(
      makeKeyEvent({ key: 'h', ctrlKey: true, shiftKey: true }),
    )
    expect(result).toBe('CommandOrControl+Shift+H')
  })

  it('converts Alt+P', () => {
    const result = keyboardEventToAccelerator(
      makeKeyEvent({ key: 'p', altKey: true }),
    )
    expect(result).toBe('Alt+P')
  })

  it('converts Ctrl+Alt+Shift+F5', () => {
    const result = keyboardEventToAccelerator(
      makeKeyEvent({ key: 'F5', ctrlKey: true, altKey: true, shiftKey: true }),
    )
    expect(result).toBe('CommandOrControl+Alt+Shift+F5')
  })

  it('returns null for pure modifier key', () => {
    expect(keyboardEventToAccelerator(makeKeyEvent({ key: 'Control', ctrlKey: true }))).toBeNull()
    expect(keyboardEventToAccelerator(makeKeyEvent({ key: 'Shift', shiftKey: true }))).toBeNull()
    expect(keyboardEventToAccelerator(makeKeyEvent({ key: 'Alt', altKey: true }))).toBeNull()
  })

  it('maps special keys', () => {
    expect(keyboardEventToAccelerator(makeKeyEvent({ key: 'Enter' }))).toBe('Return')
    expect(keyboardEventToAccelerator(makeKeyEvent({ key: 'ArrowUp' }))).toBe('Up')
    expect(keyboardEventToAccelerator(makeKeyEvent({ key: ' ' }))).toBe('Space')
  })

  it('uppercases single character keys', () => {
    expect(keyboardEventToAccelerator(makeKeyEvent({ key: 'a' }))).toBe('A')
    expect(keyboardEventToAccelerator(makeKeyEvent({ key: 'z' }))).toBe('Z')
  })
})
