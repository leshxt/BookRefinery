import { describe, expect, it } from 'vitest'
import { savePreparedFile } from './save-file'

describe('savePreparedFile', () => {
  it('uses the narrow native save bridge before browser download APIs', async () => {
    let receivedName = ''
    let receivedData: ArrayBuffer | undefined
    const runtime = {
      bookRefineryDesktop: {
        saveFile: async (request: { readonly suggestedName: string; readonly data: ArrayBuffer }) => {
          receivedName = request.suggestedName
          receivedData = request.data
          return { canceled: false }
        },
      },
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: runtime })

    const bytes = new Uint8Array([1, 2, 3])
    await expect(savePreparedFile(bytes, 'prepared.zip')).resolves.toBe('saved')
    expect(receivedName).toBe('prepared.zip')
    expect(receivedData).toBe(bytes.buffer)
  })

  it('copies only a sliced view before crossing the native boundary', async () => {
    let receivedData: ArrayBuffer | undefined
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        bookRefineryDesktop: {
          saveFile: async (request: { readonly data: ArrayBuffer }) => {
            receivedData = request.data
            return { canceled: false }
          },
        },
      },
    })

    const source = new Uint8Array([0, 1, 2, 3])
    await expect(savePreparedFile(source.subarray(1, 3), 'prepared.zip')).resolves.toBe('saved')
    expect(receivedData).not.toBe(source.buffer)
    if (!receivedData) throw new Error('The native save bridge did not receive the prepared bytes.')
    expect(Array.from(new Uint8Array(receivedData))).toEqual([1, 2])
  })
})
