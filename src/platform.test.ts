import { describe, expect, it } from 'vitest'
import { isNativeDesktopRuntime } from './platform'

describe('isNativeDesktopRuntime', () => {
  it('recognizes the private Tauri runtime marker', () => {
    expect(isNativeDesktopRuntime({ __TAURI_INTERNALS__: {} })).toBe(true)
  })

  it('keeps ordinary browsers on the web installation path', () => {
    expect(isNativeDesktopRuntime({})).toBe(false)
  })
})
