import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  profileOutputFiles,
  profileNeedsVisualCompanion,
  outputsForProfile,
  type ConversionOptions,
  type OutputProfileId,
} from '../core/contracts'
import { convertDocument } from '../core/convert'
import { inspectDocument } from '../core/inspection'
import { packageConversionResult } from '../core/manifest'
import { extractStructuredPageText } from '../core/pdf-layout'
import { pdfRenderPlan } from '../core/pdf'
import { makeEpub } from './fixtures'
import { makeFb2 } from './fb2-fixture'
import { makePdf } from './pdf-fixture'

function options(profile: OutputProfileId): ConversionOptions {
  return {
    profile,
    outputs: outputsForProfile(profile),
    ocr: {
      enabled: false,
      languages: ['eng', 'deu'],
    },
  }
}

describe('isolated preflight inspection', () => {
  it('reports EPUB structure without converting it', async () => {
    const inspection = await inspectDocument(makeEpub(), 'example.epub')

    expect(inspection).toMatchObject({
      format: 'epub',
      title: 'Sicheres Testbuch',
      author: 'Ada Beispiel',
      units: 1,
      graphics: 1,
      textCoverage: 'full',
      ocrRecommended: false,
    })
  })

  it('reports plain and compressed FB2 metadata', async () => {
    const plain = await inspectDocument(makeFb2(), 'example.fb2')
    const compressed = await inspectDocument(makeFb2({ zipped: true }), 'example.fb2.zip')

    expect(plain).toMatchObject({ format: 'fb2', title: 'Visual FB2 Test', graphics: 2 })
    expect(compressed).toMatchObject({ format: 'fb2', title: 'Visual FB2 Test', graphics: 2 })
  })

  it('samples PDF text coverage and recommends OCR only when needed', async () => {
    const inspection = await inspectDocument(makePdf([['Searchable'], ['Text']]), 'example.pdf')

    expect(inspection).toMatchObject({
      format: 'pdf',
      units: 2,
      textCoverage: 'full',
      imageOnlySampledPages: 0,
      ocrRecommended: false,
    })
  })
})

describe('profile-aware exports', () => {
  it.each([
    ['notebooklm', ['notebooklm/Sicheres Testbuch.sanitized.epub'], ['Sicheres Testbuch.md', 'chapters/001-Kapitel Eins.md']],
    ['rag', ['Sicheres Testbuch.md', 'chapters/001-Kapitel Eins.md'], ['notebooklm/Sicheres Testbuch.sanitized.epub']],
    ['markdown', ['Sicheres Testbuch.md', 'assets/FIG-0001-cover.png'], ['chapters/001-Kapitel Eins.md', 'notebooklm/Sicheres Testbuch.sanitized.epub']],
    ['archive', ['Sicheres Testbuch.md', 'chapters/001-Kapitel Eins.md', 'notebooklm/Sicheres Testbuch.sanitized.epub'], []],
  ] as const)('creates the exact %s EPUB bundle', async (profile, present, absent) => {
    const result = await convertDocument(makeEpub(), 'profile.epub', undefined, options(profile))
    const output = unzipSync(result.archive)
    const paths = Object.keys(output)

    for (const path of present) expect(paths).toContain(path)
    for (const path of absent) expect(paths).not.toContain(path)
    expect(paths).toContain('Sicheres Testbuch.security-report.md')
    expect(paths).toContain('Sicheres Testbuch.export-manifest.json')
    expect(result.filename).toBe(
      `Sicheres Testbuch-${profile === 'archive' ? 'safe-archive' : profile}.zip`,
    )
  })

  it('adds a deterministic SHA-256 inventory for every selected file', async () => {
    const result = await convertDocument(makeEpub(), 'manifest.epub', undefined, options('markdown'))
    const output = unzipSync(result.archive)
    const manifest = JSON.parse(strFromU8(output['Sicheres Testbuch.export-manifest.json']!)) as {
      readonly generator: string
      readonly profile: string
      readonly output: { readonly files: readonly { readonly path: string; readonly sha256: string }[] }
    }

    expect(manifest.generator).toBe('BookRefinery')
    expect(manifest.profile).toBe('markdown')
    expect(manifest.output.files.map((file) => file.path)).toEqual([
      'assets/FIG-0001-cover.png',
      'notebooklm/Sicheres Testbuch.figure-index.md',
      'notebooklm/Sicheres Testbuch.llm-safety-report.md',
      'Sicheres Testbuch.md',
      'Sicheres Testbuch.security-report.md',
    ])
    expect(manifest.output.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true)
  })

  it('keeps RAG page chunks aligned with a declared visual PDF companion', async () => {
    const result = await convertDocument(makePdf(
      [['Page one'], ['Page two'], ['Page three']],
      { outline: [{ title: 'Opening', page: 1 }, { title: 'Second part', page: 2 }] },
    ), 'rag.pdf', undefined, options('rag'))
    const output = unzipSync(result.archive)

    expect(Object.keys(output)).toContain('pages/PAGE-0001.md')
    expect(Object.keys(output)).toContain('pages/PAGE-0002.md')
    expect(Object.keys(output)).toContain('Test PDF.outline.md')
    expect(Object.keys(output)).toContain('sections/001-Opening.md')
    expect(Object.keys(output)).toContain('sections/002-Second part.md')
    expect(profileOutputFiles('rag', 'pdf').map((file) => file.path))
      .toContain('notebooklm/{Book title}.sanitized.pdf')
    expect(profileNeedsVisualCompanion('rag', 'pdf')).toBe(true)
    expect(strFromU8(output['Test PDF.md']!)).toContain('PAGE-0002')
  })

  it.each(['rag', 'markdown'] as const)('retains a generated PDF companion in the %s package', async (profile) => {
    const raw = {
      archive: zipSync({
        'document.md': strToU8('# Document'),
        'notebooklm/document.sanitized.pdf': strToU8('%PDF-safe'),
        'SECURITY-REPORT.md': strToU8('# Safe'),
      }),
      filename: 'visual-refined.zip',
      summary: {
        format: 'pdf' as const,
        title: 'Visual PDF',
        units: 1,
        unitLabel: 'pages' as const,
        assets: 1,
        inputBytes: 100,
        processedBytes: 10,
        outputBytes: 0,
        warnings: [],
      },
      preview: '# Document',
    }
    const result = await packageConversionResult(raw, {
      profile,
      outputs: ['visual-source', 'markdown'],
    })
    const output = unzipSync(result.archive)

    expect(Object.keys(output)).toContain('Visual PDF.md')
    expect(Object.keys(output)).toContain('notebooklm/Visual PDF.sanitized.pdf')
  })

  it('treats the sanitized PDF as the visual-assets output for a custom PDF bundle', async () => {
    const result = await packageConversionResult({
      archive: zipSync({
        'document.md': strToU8('# Document'),
        'notebooklm/document.sanitized.pdf': strToU8('%PDF-safe'),
        'SECURITY-REPORT.md': strToU8('# Safe'),
      }),
      filename: 'visual-refined.zip',
      summary: {
        format: 'pdf',
        title: 'Visual PDF',
        units: 1,
        unitLabel: 'pages',
        assets: 1,
        inputBytes: 100,
        processedBytes: 10,
        outputBytes: 0,
        warnings: [],
      },
      preview: '# Document',
    }, {
      profile: 'custom',
      outputs: ['assets'],
    })
    const paths = Object.keys(unzipSync(result.archive))

    expect(paths).toContain('notebooklm/Visual PDF.sanitized.pdf')
    expect(paths).not.toContain('Visual PDF.md')
    expect(result.filename).toBe('Visual PDF-custom.zip')
  })

  it('describes concrete paths and formats for every selectable profile', () => {
    for (const profile of ['notebooklm', 'rag', 'markdown', 'archive'] as const) {
      const files = profileOutputFiles(profile, 'pdf')
      expect(files.length).toBeGreaterThan(2)
      expect(files.every((file) => file.path && file.format && file.description)).toBe(true)
      expect(files.map((file) => file.path)).toContain('{Book title}.export-manifest.json')
    }
  })
})

describe('structured and adaptive PDF preparation', () => {
  it('keeps adjacent split glyph items inside the same word', () => {
    const result = extractStructuredPageText([
      { str: 'Cop', transform: [1, 0, 0, 1, 50, 700], width: 18, height: 12 },
      { str: 'y', __bookRefineryRepairedGlyphs: true, transform: [1, 0, 0, 1, 68, 700], width: 6, height: 12 },
      { str: 'right', transform: [1, 0, 0, 1, 74, 700], width: 25, height: 12 },
      { str: ' © 2020', transform: [1, 0, 0, 1, 103, 700], width: 40, height: 12 },
    ], 612)

    expect(result.plain).toBe('Copyright © 2020')
  })

  it('does not join overlapping text objects merely because one contains a repaired glyph', () => {
    const result = extractStructuredPageText([
      {
        str: 'Company',
        __bookRefineryRepairedGlyphs: true,
        transform: [1, 0, 0, 1, 40, 700],
        width: 220,
        height: 48,
      },
      {
        str: 'strategyzer.com/invincible',
        transform: [1, 0, 0, 1, 50, 700],
        width: 160,
        height: 12,
      },
    ], 612)

    expect(result.plain).toBe('Company strategyzer.com/invincible')
  })

  it('orders two columns separately and promotes large text to a heading', () => {
    const items: unknown[] = [
      { str: 'Chapter title', transform: [1, 0, 0, 1, 50, 760], width: 500, height: 24 },
      ...['Left one', 'Left two', 'Left three', 'Left four'].map((str, index) => ({
        str,
        transform: [1, 0, 0, 1, 50, 700 - index * 25],
        width: 120,
        height: 12,
      })),
      ...['Right one', 'Right two', 'Right three', 'Right four'].map((str, index) => ({
        str,
        transform: [1, 0, 0, 1, 350, 700 - index * 25],
        width: 120,
        height: 12,
      })),
    ]

    const result = extractStructuredPageText(items, 612)

    expect(result.columnCount).toBe(2)
    expect(result.markdown).toContain('### Chapter title')
    expect(result.plain.indexOf('Left four')).toBeLessThan(result.plain.indexOf('Right one'))
  })

  it('reduces JPEG quality as page count grows and refuses unsafe pixel plans', () => {
    expect(pdfRenderPlan([{ width: 612, height: 792 }])?.jpegQuality).toBe(0.96)
    expect(pdfRenderPlan(Array.from({ length: 200 }, () => ({ width: 612, height: 792 })))?.jpegQuality).toBe(0.91)
    expect(pdfRenderPlan(Array.from({ length: 2_000 }, () => ({ width: 2_000, height: 2_000 })))).toBeNull()
  })
})
