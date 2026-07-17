import { describe, expect, it } from 'vitest'
import { savePreparedFile } from './save-file'

describe('savePreparedFile', () => {
  it('uses the narrow native save bridge before browser download APIs', async () => {
    let receivedName = ''
    const runtime = {
      bookRefineryDesktop: {
        saveFile: async (request: { readonly suggestedName: string }) => {
          receivedName = request.suggestedName
          return { canceled: false }
        },
      },
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: runtime })

    await expect(savePreparedFile(new Uint8Array([1, 2, 3]), 'prepared.zip')).resolves.toBe('saved')
    expect(receivedName).toBe('prepared.zip')
  })
})
