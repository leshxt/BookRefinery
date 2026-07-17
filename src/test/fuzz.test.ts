import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { convertDocument } from '../core/convert'
import { inspectDocument } from '../core/inspection'
import { SecurityError } from '../core/errors'

function seededBytes(seed: number, length: number): Uint8Array {
  let value = seed >>> 0
  return Uint8Array.from({ length }, () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0
    return value & 0xff
  })
}

describe('deterministic hostile-input corpus', () => {
  it('rejects seeded unknown binary inputs without leaking raw parser exceptions', async () => {
    for (let seed = 1; seed <= 64; seed += 1) {
      const input = seededBytes(seed, 32 + seed * 7)
      await expect(convertDocument(input, `seed-${seed}.bin`)).rejects.toBeInstanceOf(SecurityError)
      await expect(inspectDocument(input, `seed-${seed}.bin`)).rejects.toBeInstanceOf(SecurityError)
    }
  })

  it('rejects traversal paths during both preflight and conversion', async () => {
    const archive = zipSync({
      mimetype: strToU8('application/epub+zip'),
      '../META-INF/container.xml': strToU8('<container/>'),
    })

    await expect(convertDocument(archive, 'traversal.epub')).rejects.toThrow(/escape a directory boundary/u)
    await expect(inspectDocument(archive, 'traversal.epub')).rejects.toThrow(/escape a directory boundary/u)
  })

  it('rejects compressed FB2 documents with entity expansion markup', async () => {
    const archive = zipSync({
      'hostile.fb2': strToU8('<!DOCTYPE FictionBook [<!ENTITY x "boom">]><FictionBook><body>&x;</body></FictionBook>'),
    })

    await expect(convertDocument(archive, 'hostile.fb2.zip')).rejects.toThrow(/forbidden DTD or entity/u)
    await expect(inspectDocument(archive, 'hostile.fb2.zip')).rejects.toThrow(/forbidden DTD or entity/u)
  })
})
