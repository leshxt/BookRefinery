import {
  getDocument,
  InvalidPDFException,
  PasswordException,
  VerbosityLevel,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import { strToU8, zipSync } from 'fflate'
import type { ConversionProgress, ConversionResult, ConversionSummary } from './convert'
import { SecurityError } from './errors'
import { safeOutputName } from './path'
import { SECURITY_POLICY } from './policy'
import { isRecord } from './xml'

type ProgressReporter = (progress: ConversionProgress) => void

interface PageLine {
  readonly text: string
  readonly y: number | null
  readonly height: number
}

function sourceStem(filename: string): string {
  return safeOutputName(filename.replace(/\.pdf$/iu, ''), 'pdf-export')
}

function safePlainText(value: string, maxLength = 500): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength)
}

function safeMarkdownText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\b(?:https?|ftp):\/\/[^\s<>)\]]+/giu, '[external URL removed]')
    .replace(/\b(?:javascript|vbscript|data|file):[^\s<>)\]]*/giu, '[unsafe URL removed]')
    .replace(/\\/gu, '\\\\')
    .replace(/([`*_[\]{}])/gu, '\\$1')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/^(\s*)(#{1,6}|>|[-+])\s/gmu, '$1\\$2 ')
    .trim()
}

function numberAt(value: unknown, index: number): number | null {
  if (!Array.isArray(value)) return null
  const candidate: unknown = value[index]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function addToken(line: string, token: string): string {
  if (!line) return token
  if (/^[,.;:!?%)}\]]/u.test(token) || /[(\[{„“'/-]$/u.test(line)) return `${line}${token}`
  return `${line} ${token}`
}

function pageTextToMarkdown(items: readonly unknown[]): string {
  const lines: PageLine[] = []
  let current = ''
  let currentY: number | null = null
  let currentHeight = 12

  const flush = (): void => {
    const text = safeMarkdownText(current)
    if (text) lines.push({ text, y: currentY, height: currentHeight })
    current = ''
    currentY = null
    currentHeight = 12
  }

  for (const item of items) {
    if (!isRecord(item) || typeof item['str'] !== 'string') continue
    const token = safePlainText(item['str'], 20_000)
    if (!token) continue

    const y = numberAt(item['transform'], 5)
    const rawHeight = item['height']
    const height = typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 12
    const movedLine = currentY !== null && y !== null && Math.abs(y - currentY) > Math.max(currentHeight, height) * 0.55
    if (movedLine) flush()

    current = addToken(current, token)
    currentY = y ?? currentY
    currentHeight = Math.max(currentHeight, height)
    if (item['hasEOL'] === true) flush()
  }
  flush()

  const paragraphs: string[] = []
  for (const [index, line] of lines.entries()) {
    const previous = index > 0 ? lines[index - 1] : undefined
    if (
      previous?.y !== null &&
      previous?.y !== undefined &&
      line.y !== null &&
      Math.abs(previous.y - line.y) > Math.max(previous.height, line.height) * 1.7
    ) {
      paragraphs.push('')
    }

    const previousTextIndex = paragraphs.length - 1
    const previousText = paragraphs[previousTextIndex]
    if (previousText && previousText.endsWith('-') && /^\p{Ll}/u.test(line.text)) {
      paragraphs[previousTextIndex] = `${previousText.slice(0, -1)}${line.text}`
    } else {
      paragraphs.push(line.text)
    }
  }

  return paragraphs.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function metadataText(info: unknown, key: string): string | undefined {
  if (!isRecord(info)) return undefined
  const value = info[key]
  return typeof value === 'string' ? safePlainText(value) || undefined : undefined
}

function reportMarkdown(summary: ConversionSummary, sourceName: string): string {
  return `# Security report

- Source: ${safeMarkdownText(sourceName)}
- Format: PDF
- Title: ${safeMarkdownText(summary.title)}
- Pages processed: ${summary.units}
- External network content loaded: no
- PDF JavaScript executed: no
- Forms, attachments, annotations, and images exported: no
- Text output rendered as active HTML: no

## Enforced limits

- Input: 80 MB
- Pages: 2,000
- Extracted text per page: 2 MB
- Total extracted text: 30 MB
- Isolated conversion worker: 120 seconds

## Limitations

PDF stores layout rather than semantic document structure. Reading order, tables, and columns
may therefore need manual cleanup. Scanned PDFs require OCR, which this version does not perform.

The hardening substantially reduces common risks, but it is not a mathematical security guarantee.
`
}

export async function convertPdf(
  bytes: Uint8Array,
  sourceName: string,
  onProgress: ProgressReporter,
): Promise<ConversionResult> {
  const inputBytes = bytes.byteLength
  onProgress({ percent: 8, label: 'Checking the PDF structure in isolation' })

  const loadingTask = getDocument({
    data: bytes.slice(),
    verbosity: VerbosityLevel.ERRORS,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    stopAtErrors: false,
    maxImageSize: 0,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableFontFace: true,
    fontExtraProperties: false,
    enableXfa: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
  })

  try {
    const document = await loadingTask.promise
    if (document.numPages < 1 || document.numPages > SECURITY_POLICY.maxPdfPages) {
      throw new SecurityError('LIMIT_EXCEEDED', 'The PDF exceeds the 2,000-page limit.')
    }

    let info: unknown
    try {
      info = (await document.getMetadata()).info
    } catch {
      info = undefined
    }

    const title = metadataText(info, 'Title') ?? sourceStem(sourceName)
    const author = metadataText(info, 'Author')
    const pageSections: string[] = []
    const warnings: string[] = []
    let extractedBytes = 0

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const textContent = await page.getTextContent({ disableNormalization: false })
      const pageText = pageTextToMarkdown(textContent.items)
      const pageBytes = new TextEncoder().encode(pageText).byteLength
      if (pageBytes > SECURITY_POLICY.maxPdfPageTextBytes) {
        throw new SecurityError('LIMIT_EXCEEDED', `Page ${pageNumber} exceeds the extracted-text limit.`)
      }
      extractedBytes += pageBytes
      if (extractedBytes > SECURITY_POLICY.maxPdfTextBytes) {
        throw new SecurityError('LIMIT_EXCEEDED', 'The extracted PDF text exceeds the total size limit.')
      }

      if (!pageText) warnings.push(`Page ${pageNumber} has no extractable text layer.`)
      pageSections.push(`## Page ${pageNumber}\n\n${pageText || '[No extractable text layer]'}`)
      page.cleanup()

      onProgress({
        percent: 20 + Math.round((pageNumber / document.numPages) * 68),
        label: `Extracting page ${pageNumber} of ${document.numPages}`,
      })
    }

    const header = [
      `# ${safeMarkdownText(title)}`,
      author ? `**Author:** ${safeMarkdownText(author)}` : '',
      '**Source:** local PDF text extraction',
    ].filter(Boolean).join('\n\n')
    const markdown = `${header}\n\n---\n\n${pageSections.join('\n\n---\n\n')}\n`

    const provisionalSummary: ConversionSummary = {
      format: 'pdf',
      title,
      ...(author ? { author } : {}),
      units: document.numPages,
      unitLabel: 'pages',
      assets: 0,
      inputBytes,
      processedBytes: extractedBytes,
      outputBytes: 0,
      warnings: [...new Set(warnings)].slice(0, 100),
    }
    const files: Record<string, Uint8Array> = {
      'document.md': strToU8(markdown),
      'SECURITY-REPORT.md': strToU8(reportMarkdown(provisionalSummary, sourceName)),
    }

    onProgress({ percent: 94, label: 'Building the passive Markdown bundle' })
    const resultArchive = zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') })
    if (resultArchive.byteLength > SECURITY_POLICY.maxOutputBytes) {
      throw new SecurityError('LIMIT_EXCEEDED', 'The export bundle exceeds the output size limit.')
    }

    onProgress({ percent: 100, label: 'Conversion complete' })

    return {
      archive: resultArchive,
      filename: `${sourceStem(sourceName)}-markdown.zip`,
      summary: { ...provisionalSummary, outputBytes: resultArchive.byteLength },
      preview: markdown.slice(0, 8_000),
    }
  } catch (error) {
    if (error instanceof SecurityError) throw error
    if (error instanceof PasswordException) {
      throw new SecurityError('UNSUPPORTED_DOCUMENT', 'Password-protected PDFs are not supported.')
    }
    if (error instanceof InvalidPDFException) {
      throw new SecurityError('INVALID_DOCUMENT', 'The PDF is damaged or invalid.')
    }
    throw error
  } finally {
    await loadingTask.destroy()
  }
}
