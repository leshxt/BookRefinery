/// <reference types="node" />

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { convertEpub } from '../core/convert'

const sampleDir = process.env['EPUB_SAMPLE_DIR']
const sampleFiles = sampleDir ? readdirSync(sampleDir).filter((name: string) => name.endsWith('.epub')) : []

describe.skipIf(!sampleDir)('official W3C community EPUB samples', () => {
  for (const filename of sampleFiles) {
    it(filename, () => {
      if (!sampleDir) throw new Error('EPUB_SAMPLE_DIR is missing')
      const input = new Uint8Array(readFileSync(join(sampleDir, filename)))
      const result = convertEpub(input, filename)
      if (result.archive.byteLength === 0) throw new Error('empty output')
    })
  }
})
