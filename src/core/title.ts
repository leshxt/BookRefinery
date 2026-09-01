const DOS_SHORT_NAME = /^[^.\s]{1,6}~\d+(?:\.[A-Za-z0-9]{1,3})?$/u
const GENERIC_PDF_TITLE = /^(?:document|pdf|scan(?:ned)?(?: document)?|untitled)$/iu

function plainTitle(value: string, maxLength = 500): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength)
}

function sourceBasename(sourceName: string): string {
  const segments = sourceName.split(/[\\/]/u)
  return segments[segments.length - 1] ?? sourceName
}

function isTechnicalTitle(value: string): boolean {
  return DOS_SHORT_NAME.test(value) || GENERIC_PDF_TITLE.test(value)
}

export function pdfTitleFromSourceName(sourceName: string): string {
  const basename = sourceBasename(sourceName).replace(/\.pdf$/iu, '')
  const catalogTitle = basename.split(/\s+--\s+/u, 1)[0] ?? basename
  const title = plainTitle(catalogTitle.replace(/\s*_\s+/gu, ': '), 300)
  return title || 'PDF export'
}

export function preferredPdfTitle(metadataTitle: string | undefined, sourceName: string): string {
  const sourceTitle = pdfTitleFromSourceName(sourceName)
  if (!metadataTitle) return sourceTitle

  const title = plainTitle(metadataTitle.replace(/^Microsoft Word\s+-\s+/iu, ''))
  return title && !isTechnicalTitle(title) ? title : sourceTitle
}
