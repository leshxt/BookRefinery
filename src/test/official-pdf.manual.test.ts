/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { convertDocument } from '../core/convert'

const sampleFile = process.env['PDF_SAMPLE_FILE']

describe.skipIf(!sampleFile)('real-world PDF compatibility', () => {
  it('converts the configured PDF sample', async () => {
    if (!sampleFile) throw new Error('PDF_SAMPLE_FILE is missing')
    const input = new Uint8Array(readFileSync(sampleFile))
    const result = await convertDocument(input, 'real-world.pdf')

    expect(result.summary.format).toBe('pdf')
    expect(result.summary.units).toBeGreaterThan(0)
    expect(result.archive.byteLength).toBeGreaterThan(0)
  })
})
