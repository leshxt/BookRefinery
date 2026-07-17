import { describe, expect, it } from 'vitest'
import { isNativeDesktopRuntime } from './platform'

describe('isNativeDesktopRuntime', () => {
  it('recognizes the narrow desktop bridge', () => {
    expect(isNativeDesktopRuntime({ bookRefineryDesktop: {} })).toBe(true)
  })

  it('keeps ordinary browsers on the web installation path', () => {
    expect(isNativeDesktopRuntime({})).toBe(false)
  })
})
