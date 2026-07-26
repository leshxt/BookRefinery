import { strToU8, zipSync } from 'fflate'
import { openSecureArchive } from './archive'
import {
  DEFAULT_CONVERSION_OPTIONS,
  type ConversionOptions,
} from './contracts'
import { readEpubPackage, type ManifestItem } from './epub'
import { SecurityError } from './errors'
import { convertFb2, convertFb2Zip } from './fb2'
import { figureId, outputAssetName, outputAssetPath, rasterDescriptor } from './images'
import {
  annotateMarkdownFigures,
  buildLlmExport,
  type FigureOccurrence,
  type LlmAsset,
  type LlmChapter,
} from './llm'
import { xhtmlToSafeMarkdown } from './markdown'
import { packageConversionResult } from './manifest'
import { archiveDirname, resolveArchiveReference, safeOutputName } from './path'
import { convertPdf } from './pdf'
import { SECURITY_POLICY } from './policy'
import { sanitizeSvg } from './svg'
import { decodeUtf8, stripInertDocumentTypes } from './xml'

interface AssetTarget {
  readonly outputPath: string
  readonly kind: 'raster' | 'svg'
  readonly figureId: string
  readonly mediaType: string
  readonly defaultLabel: string
}

export interface ConversionProgress {
  readonly percent: number
  readonly label: string
}

export interface ConversionSummary {
  readonly format: 'epub' | 'fb2' | 'pdf'
  readonly title: string
  readonly author?: string
  readonly language?: string
  readonly units: number
  readonly unitLabel: 'chapters' | 'pages'
  readonly assets: number
  readonly inputBytes: number
  readonly processedBytes: number
  readonly outputBytes: number
  readonly ocrPages?: number
  readonly repairedTextPages?: number
  readonly repairedGlyphs?: number
  readonly warnings: readonly string[]
}

export interface ConversionResult {
  readonly archive: Uint8Array
  readonly filename: string
  readonly summary: ConversionSummary
  readonly preview: string
}

type ProgressReporter = (progress: ConversionProgress) => void

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

function reportMarkdown(summary: ConversionSummary, sourceName: string): string {
  const warningList = summary.warnings.length
    ? summary.warnings.map((warning) => `- ${markdownInline(warning)}`).join('\n')
    : '- No content warnings.'

  return `# Security report

- Source: ${markdownInline(sourceName)}
- Title: ${markdownInline(summary.title)}
- Reading-order items: ${summary.units}
- Exported sanitized or signature-checked images: ${summary.assets}
- Archive entries checked: yes
- External network content loaded: no
- XML entities allowed: no
- Active HTML exported: no
- Passive sanitized visual EPUB companion exported: yes
- Stable figure IDs and reading positions recorded: yes

## Warnings

${warningList}

## Enforced limits

- Input: 80 MB
- Individual unpacked file: 25 MB
- Total unpacked data: 250 MB
- Archive entries: 5,000
- Compression ratio: 100:1 for entries of 4 MB or more
- Isolated conversion worker: 120 seconds

The hardening substantially reduces common risks, but it is not a mathematical security guarantee.
`
}

function chapterTitle(markdown: string, item: ManifestItem, index: number): string {
  const heading = markdown.match(/^#{1,6}\s+(.+)$/mu)?.[1]?.replace(/[*_`[\]]/gu, '').trim()
  return safeOutputName(heading ?? item.id, `Chapter ${index + 1}`)
}

function sourceStem(filename: string): string {
  return safeOutputName(filename.replace(/\.epub$/iu, ''), 'epub-export')
}

function isContentDocument(item: ManifestItem): boolean {
  return item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html'
}

function assetBaseName(item: ManifestItem, fallback: string): string {
  return item.path.split('/').at(-1)?.replace(/\.[^.]+$/u, '') ?? fallback
}

export function convertEpub(
  bytes: Uint8Array,
  sourceName: string,
  onProgress: ProgressReporter = () => undefined,
): ConversionResult {
  onProgress({ percent: 8, label: 'Checking archive structure' })
  const archive = openSecureArchive(bytes)

  onProgress({ percent: 20, label: 'Validating the EPUB package' })
  const epub = readEpubPackage(archive.entries)
  const warnings = [...epub.warnings]
  const outputFiles: Record<string, Uint8Array> = {}
  const assetTargets = new Map<string, AssetTarget>()
  const assetsByOutputPath = new Map<string, LlmAsset>()
  let assetSequence = 0

  for (const item of epub.manifest) {
    const descriptor = rasterDescriptor(item.mediaType)
    if (!descriptor) continue
    const data = archive.entries.get(item.path)
    if (!data || !descriptor.signature(data)) {
      warnings.push(`Image "${item.id}" was omitted because its declared type, signature, or file data is invalid.`)
      continue
    }

    assetSequence += 1
    const outputPath = outputAssetPath(assetSequence, assetBaseName(item, `image-${assetSequence}`), descriptor.extension)
    const target: AssetTarget = {
      outputPath,
      kind: 'raster',
      figureId: figureId(assetSequence),
      mediaType: item.mediaType,
      defaultLabel: assetBaseName(item, item.id),
    }
    assetTargets.set(item.path, target)
    outputFiles[outputPath] = data
    assetsByOutputPath.set(outputPath, { ...target, data })
  }

  const resolveSvgImage = (svgPath: string, reference: string): string | null => {
    try {
      const archivePath = resolveArchiveReference(archiveDirname(svgPath), reference)
      const target = assetTargets.get(archivePath)
      return target?.kind === 'raster' ? outputAssetName(target.outputPath) : null
    } catch (error) {
      if (!(error instanceof SecurityError)) throw error
      return null
    }
  }

  for (const item of epub.manifest) {
    if (item.mediaType !== 'image/svg+xml') continue
    const data = archive.entries.get(item.path)
    if (!data) {
      warnings.push(`SVG image "${item.id}" is missing and was omitted.`)
      continue
    }

    try {
      const sanitized = sanitizeSvg(data, `SVG image "${item.id}"`, (reference) => resolveSvgImage(item.path, reference))
      assetSequence += 1
      const outputPath = outputAssetPath(assetSequence, assetBaseName(item, `image-${assetSequence}`), 'svg')
      const target: AssetTarget = {
        outputPath,
        kind: 'svg',
        figureId: figureId(assetSequence),
        mediaType: 'image/svg+xml',
        defaultLabel: assetBaseName(item, item.id),
      }
      assetTargets.set(item.path, target)
      outputFiles[outputPath] = sanitized.content
      assetsByOutputPath.set(outputPath, { ...target, data: sanitized.content })
      warnings.push(...sanitized.warnings.map((warning) => `SVG "${item.id}": ${warning}`))
    } catch (error) {
      if (!(error instanceof SecurityError)) throw error
      warnings.push(`SVG image "${item.id}" was omitted: ${error.message}`)
    }
  }

  const imageTargets = new Map([...assetTargets].map(([path, target]) => [path, target.outputPath]))
  const chapters: string[] = []
  const llmChapters: LlmChapter[] = []
  const figureOccurrences: FigureOccurrence[] = []
  const spineSequenceByPath = new Map(epub.spine.map((item, index) => [item.path, index + 1]))

  for (const [index, item] of epub.spine.entries()) {
    let rawBody: string
    let title: string

    if (isContentDocument(item)) {
      const chapterBytes = archive.entries.get(item.path)
      if (!chapterBytes) {
        warnings.push(`Reading-order item "${item.id}" is missing and was skipped.`)
        continue
      }
      if (chapterBytes.byteLength > SECURITY_POLICY.maxXhtmlBytes) {
        throw new SecurityError('LIMIT_EXCEEDED', `Reading-order item "${item.id}" exceeds the XHTML limit.`)
      }

      const label = `Reading-order item "${item.id}"`
      const decoded = decodeUtf8(chapterBytes, label)
      const prepared = stripInertDocumentTypes(decoded, label)
      if (prepared.removed) warnings.push(`Removed an inert legacy document type from "${item.id}".`)

      const converted = xhtmlToSafeMarkdown(prepared.text, item.path, imageTargets, (inlineSvg, alt) => {
        try {
          const sanitized = sanitizeSvg(
            new TextEncoder().encode(inlineSvg),
            `Inline SVG in "${item.id}"`,
            (reference) => resolveSvgImage(item.path, reference),
          )
          assetSequence += 1
          const outputPath = outputAssetPath(assetSequence, `inline-${safeOutputName(alt, 'svg')}`, 'svg')
          outputFiles[outputPath] = sanitized.content
          assetsByOutputPath.set(outputPath, {
            figureId: figureId(assetSequence),
            outputPath,
            mediaType: 'image/svg+xml',
            defaultLabel: alt,
            data: sanitized.content,
          })
          warnings.push(...sanitized.warnings.map((warning) => `Inline SVG in "${item.id}": ${warning}`))
          return outputPath
        } catch (error) {
          if (!(error instanceof SecurityError)) throw error
          warnings.push(`Removed an inline SVG from "${item.id}": ${error.message}`)
          return null
        }
      }, (reference) => {
        try {
          const targetPath = resolveArchiveReference(archiveDirname(item.path), reference)
          const sequence = spineSequenceByPath.get(targetPath)
          return sequence === undefined ? null : `CHAPTER-${String(sequence).padStart(3, '0')}`
        } catch (error) {
          if (!(error instanceof SecurityError)) throw error
          return null
        }
      })
      warnings.push(...converted.warnings)
      title = chapterTitle(converted.markdown, item, index)
      rawBody = converted.markdown || `# ${title}\n\n[Empty chapter]`
    } else {
      const target = imageTargets.get(item.path)
      if (!target) {
        warnings.push(`Visual reading-order item "${item.id}" could not be sanitized and was skipped.`)
        continue
      }
      title = safeOutputName(item.id, `Page ${index + 1}`)
      rawBody = `# ${markdownInline(title)}\n\n![${markdownInline(title)}](${target})`
    }

    const annotated = annotateMarkdownFigures(rawBody, index + 1, title, assetsByOutputPath)
    const body = annotated.markdown
    chapters.push(body)
    llmChapters.push({
      sequence: index + 1,
      title,
      rawMarkdown: rawBody,
      annotatedMarkdown: body,
      includeInCanonical: !item.properties.includes('nav'),
    })
    figureOccurrences.push(...annotated.occurrences)
    outputFiles[`chapters/${String(index + 1).padStart(3, '0')}-${title}.md`] = strToU8(
      body.replace(/\]\(assets\//gu, '](../assets/'),
    )

    onProgress({
      percent: 28 + Math.round(((index + 1) / epub.spine.length) * 56),
      label: `Sanitizing item ${index + 1} of ${epub.spine.length}`,
    })
  }

  if (chapters.length === 0) {
    throw new SecurityError('UNSUPPORTED_DOCUMENT', 'No safe reading-order items could be produced from this EPUB.')
  }

  const frontMatter = [
    `# ${markdownInline(epub.title)}`,
    epub.author ? `**Author:** ${markdownInline(epub.author)}` : '',
    epub.language ? `**Language:** ${markdownInline(epub.language)}` : '',
  ].filter(Boolean).join('\n\n')
  const combined = `${frontMatter}\n\n---\n\n${chapters.join('\n\n---\n\n')}\n`
  outputFiles['book.md'] = strToU8(combined)

  const llmExport = buildLlmExport(
    {
      title: epub.title,
      sourceFormat: 'EPUB',
      ...(epub.author ? { author: epub.author } : {}),
      ...(epub.language ? { language: epub.language } : {}),
    },
    llmChapters,
    [...assetsByOutputPath.values()],
    figureOccurrences,
  )
  Object.assign(outputFiles, llmExport.files)
  if (llmExport.instructionLikePassages > 0) {
    warnings.push(`The LLM safety scan found ${llmExport.instructionLikePassages} instruction-like passage(s); content was retained and documented in notebooklm/LLM-SAFETY-REPORT.md.`)
  }

  const uniqueWarnings = [...new Set(warnings)].slice(0, 100)
  const assetCount = Object.keys(outputFiles).filter((path) => path.startsWith('assets/')).length
  const provisionalSummary: ConversionSummary = {
    format: 'epub',
    title: epub.title,
    ...(epub.author ? { author: epub.author } : {}),
    ...(epub.language ? { language: epub.language } : {}),
    units: chapters.length,
    unitLabel: 'chapters',
    assets: assetCount,
    inputBytes: bytes.byteLength,
    processedBytes: archive.uncompressedBytes,
    outputBytes: 0,
    warnings: uniqueWarnings,
  }
  outputFiles['SECURITY-REPORT.md'] = strToU8(reportMarkdown(provisionalSummary, sourceName))

  onProgress({ percent: 92, label: 'Building the passive export bundle' })
  const resultArchive = zipSync(outputFiles, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') })
  if (resultArchive.byteLength > SECURITY_POLICY.maxOutputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The export bundle exceeds the output size limit.')
  }

  const summary = { ...provisionalSummary, outputBytes: resultArchive.byteLength }
  onProgress({ percent: 100, label: 'Conversion complete' })

  return {
    archive: resultArchive,
    filename: `${sourceStem(sourceName)}-refined.zip`,
    summary,
    preview: combined.slice(0, 8_000),
  }
}

export type InputFormat = 'epub' | 'fb2' | 'fb2zip' | 'pdf'

export function detectInputFormat(bytes: Uint8Array, sourceName: string): InputFormat {
  const isPdf =
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  if (isPdf) return 'pdf'

  const isZip = bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
  if (isZip) {
    const archive = openSecureArchive(bytes)
    if (archive.entries.has('META-INF/container.xml')) return 'epub'
    const fb2Files = [...archive.entries.keys()].filter((path) => path.toLocaleLowerCase('en-US').endsWith('.fb2'))
    if (fb2Files.length > 0 || sourceName.toLocaleLowerCase('en-US').endsWith('.fb2.zip')) return 'fb2zip'
    return 'epub'
  }

  if (sourceName.toLocaleLowerCase('en-US').endsWith('.fb2')) return 'fb2'
  const prefix = new TextDecoder('windows-1252').decode(bytes.subarray(0, 2_048)).replace(/\u0000/gu, '')
  if (/<(?:[A-Za-z_][\w.-]*:)?FictionBook\b/iu.test(prefix)) return 'fb2'

  throw new SecurityError('INVALID_DOCUMENT', 'The file is not a supported EPUB, FB2, or PDF document.')
}

export async function convertDocument(
  bytes: Uint8Array,
  sourceName: string,
  onProgress: ProgressReporter = () => undefined,
  options: ConversionOptions = DEFAULT_CONVERSION_OPTIONS,
  password?: string,
): Promise<ConversionResult> {
  if (bytes.byteLength > SECURITY_POLICY.maxInputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The file exceeds the 80 MB input limit.')
  }

  const format = detectInputFormat(bytes, sourceName)
  const rawResult = format === 'pdf'
    ? await convertPdf(bytes, sourceName, onProgress, options, password)
    : format === 'fb2'
      ? convertFb2(bytes, sourceName, onProgress)
      : format === 'fb2zip'
        ? convertFb2Zip(bytes, sourceName, onProgress)
        : convertEpub(bytes, sourceName, onProgress)
  onProgress({ percent: 98, label: 'Applying the selected output profile' })
  const result = await packageConversionResult(rawResult, options)
  onProgress({ percent: 100, label: 'Preparation complete' })
  return result
}
