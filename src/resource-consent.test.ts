import { describe, expect, it } from 'vitest'
import {
  conversionResourceWarnings,
  isCombinedZipSizeSupported,
  requiresLargeSaveConfirmation,
} from './resource-consent'
import {
  conversionResourcePolicy,
  LARGE_SAVE_WARNING_BYTES,
  MAX_COMBINED_ZIP_BYTES,
} from './core/policy'

describe('conversionResourceWarnings', () => {
  it('requests consent before producing a visual PDF beyond the normal page budget', () => {
    const warnings = conversionResourceWarnings([{
      sourceName: 'large-book.pdf',
      inspection: {
        format: 'pdf',
        title: 'Large book',
        units: 501,
        unitLabel: 'pages',
        graphics: 501,
        inputBytes: 1,
        processedBytes: 1,
        textCoverage: 'full',
        ocrRecommended: false,
        warnings: [],
      },
    }], ['visual-source'], true)

    expect(warnings).toEqual([
      'large-book.pdf: 501 visual pages exceed the normal 500-page budget.',
    ])
  })

  it('does not request visual consent for a text-only output selection', () => {
    const warnings = conversionResourceWarnings([{
      sourceName: 'large-book.pdf',
      inspection: {
        format: 'pdf',
        title: 'Large book',
        units: 700,
        unitLabel: 'pages',
        graphics: 700,
        inputBytes: 1,
        processedBytes: 1,
        textCoverage: 'full',
        ocrRecommended: false,
        warnings: [],
      },
    }], ['markdown'], false)

    expect(warnings).toEqual([])
  })

  it('requests consent when page dimensions exceed the normal adaptive pixel plan', () => {
    const warnings = conversionResourceWarnings([{
      sourceName: 'large-pages.pdf',
      inspection: {
        format: 'pdf',
        title: 'Large pages',
        units: 20,
        unitLabel: 'pages',
        graphics: 20,
        inputBytes: 1,
        processedBytes: 1,
        textCoverage: 'full',
        estimatedVisualPixels: 700_000_000,
        ocrRecommended: false,
        warnings: [],
      },
    }], ['visual-source'], false)

    expect(warnings).toEqual([
      'large-pages.pdf: preserving every visual page exceeds the normal adaptive pixel budget.',
    ])
  })

  it('keeps warning thresholds separate from extended and technical boundaries', () => {
    const standard = conversionResourcePolicy('standard')
    const extended = conversionResourcePolicy('extended')
    expect(standard.maxOutputBytes).toBe(3 * 1024 * 1024 * 1024)
    expect(extended.maxVisualPdfPages).toBe(2_000)
    expect(extended.maxOcrPages).toBe(2_000)
    expect(extended.maxOutputBytes).toBe(3 * 1024 * 1024 * 1024)
    expect(LARGE_SAVE_WARNING_BYTES).toBe(2 * 1024 * 1024 * 1024)
    expect(MAX_COMBINED_ZIP_BYTES).toBe((4 * 1024 * 1024 * 1024) - (1024 * 1024))
    expect(requiresLargeSaveConfirmation(LARGE_SAVE_WARNING_BYTES)).toBe(false)
    expect(requiresLargeSaveConfirmation(LARGE_SAVE_WARNING_BYTES + 1)).toBe(true)
    expect(isCombinedZipSizeSupported(MAX_COMBINED_ZIP_BYTES)).toBe(true)
    expect(isCombinedZipSizeSupported(MAX_COMBINED_ZIP_BYTES + 1)).toBe(false)
  })
})
