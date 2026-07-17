/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { convertDocument } from '../core/convert'

const sampleFile = process.env['PDF_SAMPLE_FILE']
const expectGlyphRepair = process.env['PDF_EXPECT_GLYPH_REPAIR'] === '1'

describe.skipIf(!sampleFile)('real-world PDF compatibility', () => {
  it('converts the configured PDF sample', async () => {
    if (!sampleFile) throw new Error('PDF_SAMPLE_FILE is missing')
    const input = new Uint8Array(readFileSync(sampleFile))
    const result = await convertDocument(input, 'real-world.pdf')

    expect(result.summary.format).toBe('pdf')
    expect(result.summary.units).toBeGreaterThan(0)
    expect(result.archive.byteLength).toBeGreaterThan(0)
    if (expectGlyphRepair) {
      expect(result.summary.repairedTextPages).toBeGreaterThan(0)
      expect(result.summary.repairedGlyphs).toBeGreaterThan(100)
      expect(result.preview).toContain('Copyright © 2020 by Alexander Osterwalder')
      expect(result.preview).toContain('An organization that constantly')
      expect(result.preview).not.toContain('Cop! right')
      expect(result.preview).not.toContain('Companystrategyzer')
    }
  }, 120_000)
})
