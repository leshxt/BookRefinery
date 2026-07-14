import { strToU8, zipSync } from 'fflate'
import { openSecureArchive } from './archive'
import { SecurityError } from './errors'
import { readEpubPackage, type ManifestItem } from './epub'
import { xhtmlToSafeMarkdown } from './markdown'
import { safeOutputName } from './path'
import { SECURITY_POLICY } from './policy'
import { assertNoUnsafeXmlMarkup, decodeUtf8 } from './xml'
import { convertPdf } from './pdf'

const RASTER_TYPES = new Map<string, { extension: string; signature: (bytes: Uint8Array) => boolean }>([
  ['image/png', { extension: 'png', signature: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 }],
  ['image/jpeg', { extension: 'jpg', signature: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ['image/gif', { extension: 'gif', signature: (b) => String.fromCharCode(...b.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...b.slice(0, 6)) === 'GIF89a' }],
  ['image/webp', { extension: 'webp', signature: (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' }],
])

export interface ConversionProgress {
  readonly percent: number
  readonly label: string
}

export interface ConversionSummary {
  readonly format: 'epub' | 'pdf'
  readonly title: string
  readonly author?: string
  readonly language?: string
  readonly units: number
  readonly unitLabel: 'Kapitel' | 'Seiten'
  readonly assets: number
  readonly inputBytes: number
  readonly processedBytes: number
  readonly outputBytes: number
  readonly warnings: readonly string[]
}

export interface ConversionResult {
  readonly archive: Uint8Array
  readonly filename: string
  readonly summary: ConversionSummary
  readonly preview: string
}

type ProgressReporter = (progress: ConversionProgress) => void

function reportMarkdown(summary: ConversionSummary, sourceName: string): string {
  const warningList = summary.warnings.length
    ? summary.warnings.map((warning) => `- ${markdownInline(warning)}`).join('\n')
    : '- Keine inhaltlichen Warnungen.'

  return `# Sicherheitsbericht

- Quelle: ${markdownInline(sourceName)}
- Titel: ${markdownInline(summary.title)}
- Kapitel: ${summary.units}
- exportierte Rasterbilder: ${summary.assets}
- Archiveinträge geprüft: ja
- externe Netzwerkinhalte geladen: nein
- DTD/XML-Entities erlaubt: nein
- aktives HTML ausgegeben: nein

## Hinweise

${warningList}

## Durchgesetzte Grenzen

- Eingabe: 80 MB
- einzelne entpackte Datei: 25 MB
- entpackt gesamt: 250 MB
- Archiveinträge: 5.000
- Kompressionsverhältnis: 100:1

Die Härtung reduziert typische Risiken erheblich, ist aber keine mathematische Sicherheitsgarantie.
`
}

function chapterTitle(markdown: string, item: ManifestItem, index: number): string {
  const heading = markdown.match(/^#{1,6}\s+(.+)$/mu)?.[1]?.replace(/[*_`[\]]/gu, '').trim()
  return safeOutputName(heading ?? item.id, `Kapitel ${index + 1}`)
}

function sourceStem(filename: string): string {
  return safeOutputName(filename.replace(/\.epub$/iu, ''), 'epub-export')
}

function markdownInline(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/([\\`*_[\]{}()#+.!|>~-])/gu, '\\$1')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .trim()
    .slice(0, 500)
}

export function convertEpub(
  bytes: Uint8Array,
  sourceName: string,
  onProgress: ProgressReporter = () => undefined,
): ConversionResult {
  onProgress({ percent: 8, label: 'Archivstruktur wird geprüft' })
  const archive = openSecureArchive(bytes)

  onProgress({ percent: 22, label: 'EPUB-Paket wird validiert' })
  const epub = readEpubPackage(archive.entries)
  const warnings: string[] = []
  const outputFiles: Record<string, Uint8Array> = {}
  const imageTargets = new Map<string, string>()
  let assetCount = 0

  for (const item of epub.manifest) {
    if (!item.mediaType.startsWith('image/')) continue
    const descriptor = RASTER_TYPES.get(item.mediaType)
    const data = archive.entries.get(item.path)
    if (!descriptor || !data || !descriptor.signature(data)) {
      warnings.push(`Bild „${item.id}“ wurde wegen Typ, Signatur oder Format ausgelassen.`)
      continue
    }

    assetCount += 1
    const baseName = item.path.split('/').at(-1)?.replace(/\.[^.]+$/u, '') ?? `bild-${assetCount}`
    const outputPath = `assets/${String(assetCount).padStart(3, '0')}-${safeOutputName(baseName, `bild-${assetCount}`)}.${descriptor.extension}`
    imageTargets.set(item.path, outputPath)
    outputFiles[outputPath] = data
  }

  const chapters: string[] = []
  for (const [index, item] of epub.spine.entries()) {
    const chapterBytes = archive.entries.get(item.path)
    if (!chapterBytes) {
      warnings.push(`Kapitel „${item.id}“ fehlt und wurde übersprungen.`)
      continue
    }
    if (chapterBytes.byteLength > SECURITY_POLICY.maxXhtmlBytes) {
      throw new SecurityError('LIMIT_EXCEEDED', `Kapitel „${item.id}“ überschreitet das XHTML-Limit.`)
    }

    const html = decodeUtf8(chapterBytes, `Kapitel „${item.id}“`)
    assertNoUnsafeXmlMarkup(html, `Kapitel „${item.id}“`, true)
    const converted = xhtmlToSafeMarkdown(html, item.path, imageTargets)
    warnings.push(...converted.warnings)
    const title = chapterTitle(converted.markdown, item, index)
    const body = converted.markdown || `# ${title}\n\n[Leeres Kapitel]`
    chapters.push(body)
    outputFiles[`chapters/${String(index + 1).padStart(3, '0')}-${title}.md`] = strToU8(
      body.replace(/\]\(assets\//gu, '](../assets/'),
    )

    onProgress({
      percent: 30 + Math.round(((index + 1) / epub.spine.length) * 52),
      label: `Kapitel ${index + 1} von ${epub.spine.length} wird bereinigt`,
    })
  }

  if (chapters.length === 0) {
    throw new SecurityError('UNSUPPORTED_DOCUMENT', 'Aus dem EPUB konnten keine sicheren Kapitel erzeugt werden.')
  }

  const frontMatter = [
    `# ${markdownInline(epub.title)}`,
    epub.author ? `**Autor:in:** ${markdownInline(epub.author)}` : '',
    epub.language ? `**Sprache:** ${markdownInline(epub.language)}` : '',
  ].filter(Boolean).join('\n\n')
  const combined = `${frontMatter}\n\n---\n\n${chapters.join('\n\n---\n\n')}\n`
  outputFiles['book.md'] = strToU8(combined)

  const uniqueWarnings = [...new Set(warnings)].slice(0, 100)
  const provisionalSummary: ConversionSummary = {
    format: 'epub',
    title: epub.title,
    ...(epub.author ? { author: epub.author } : {}),
    ...(epub.language ? { language: epub.language } : {}),
    units: chapters.length,
    unitLabel: 'Kapitel',
    assets: assetCount,
    inputBytes: bytes.byteLength,
    processedBytes: archive.uncompressedBytes,
    outputBytes: 0,
    warnings: uniqueWarnings,
  }
  outputFiles['SECURITY-REPORT.md'] = strToU8(reportMarkdown(provisionalSummary, sourceName))

  onProgress({ percent: 90, label: 'Sicheres Exportpaket wird erstellt' })
  const resultArchive = zipSync(outputFiles, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') })
  if (resultArchive.byteLength > SECURITY_POLICY.maxOutputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'Das Exportpaket überschreitet das Ausgabelimit.')
  }

  const summary = { ...provisionalSummary, outputBytes: resultArchive.byteLength }
  onProgress({ percent: 100, label: 'Konvertierung abgeschlossen' })

  return {
    archive: resultArchive,
    filename: `${sourceStem(sourceName)}-safe-markdown.zip`,
    summary,
    preview: combined.slice(0, 8_000),
  }
}

function inputFormat(bytes: Uint8Array): 'epub' | 'pdf' {
  const isPdf =
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  if (isPdf) return 'pdf'

  const isZip = bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
  if (isZip) return 'epub'

  throw new SecurityError('INVALID_DOCUMENT', 'Die Datei ist weder ein unterstütztes EPUB noch ein PDF.')
}

export async function convertDocument(
  bytes: Uint8Array,
  sourceName: string,
  onProgress: ProgressReporter = () => undefined,
): Promise<ConversionResult> {
  if (bytes.byteLength > SECURITY_POLICY.maxInputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'Die Datei überschreitet das Eingabelimit von 80 MB.')
  }

  return inputFormat(bytes) === 'pdf'
    ? convertPdf(bytes, sourceName, onProgress)
    : convertEpub(bytes, sourceName, onProgress)
}
