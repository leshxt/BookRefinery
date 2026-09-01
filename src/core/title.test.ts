import { describe, expect, it } from 'vitest'
import { pdfTitleFromSourceName, preferredPdfTitle } from './title'

describe('PDF title selection', () => {
  const archiveName = 'Finanzierung von Start-up-Unternehmen _ Praxisbuch für junge Unternehmen -- Christopher Hahn -- 9783658123456 -- Anna Archive.pdf'

  it('derives a readable title from a catalog-style source filename', () => {
    expect(pdfTitleFromSourceName(archiveName)).toBe(
      'Finanzierung von Start-up-Unternehmen: Praxisbuch für junge Unternehmen',
    )
    expect(pdfTitleFromSourceName('Controlling in Start-up-Unternehmen_ Praxisbuch.pdf')).toBe(
      'Controlling in Start-up-Unternehmen: Praxisbuch',
    )
  })

  it('keeps useful embedded metadata', () => {
    expect(preferredPdfTitle('Financial Intelligence, Revised Edition', 'FINANC~1.PDF')).toBe(
      'Financial Intelligence, Revised Edition',
    )
  })

  it('replaces DOS aliases and generic metadata with the recovered source title', () => {
    expect(preferredPdfTitle('FINANZ~1', archiveName)).toBe(
      'Finanzierung von Start-up-Unternehmen: Praxisbuch für junge Unternehmen',
    )
    expect(preferredPdfTitle('Untitled', archiveName)).toBe(
      'Finanzierung von Start-up-Unternehmen: Praxisbuch für junge Unternehmen',
    )
  })
})
