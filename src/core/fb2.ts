import { strToU8, zipSync } from 'fflate'
import { openRecoverableArchive } from './archive'
import type { ConversionProgress, ConversionResult, ConversionSummary } from './convert'
import type { DocumentInspection, DocumentRepairSummary } from './contracts'
import { SecurityError } from './errors'
import { figureId, outputAssetName, outputAssetPath, rasterDescriptor } from './images'
import {
  annotateMarkdownFigures,
  buildLlmExport,
  type FigureOccurrence,
  type LlmAsset,
  type LlmChapter,
} from './llm'
import { safeOutputName } from './path'
import { SECURITY_POLICY } from './policy'
import { repairReportMarkdown } from './repair'
import { sanitizeSvg } from './svg'
import { isRecord, parseXmlOrderedSecure } from './xml'

type ProgressReporter = (progress: ConversionProgress) => void
type OrderedNode = Record<string, unknown>

interface Fb2AssetTarget {
  readonly outputPath: string
  readonly figureId: string
  readonly mediaType: string
  readonly defaultLabel: string
}

interface Fb2Metadata {
  readonly title: string
  readonly author?: string
  readonly language?: string
  readonly coverReference?: string
}

interface BinaryRecord {
  readonly id: string
  readonly mediaType: string
  readonly data: Uint8Array
}

interface ConversionAccounting {
  readonly inputBytes: number
  readonly processedBytes: number
  readonly repair?: DocumentRepairSummary
  readonly repairedSourceBytes?: Uint8Array
}

const FIXED_ARCHIVE_DATE = new Date('2026-01-01T00:00:00Z')

function isOrderedNode(value: unknown): value is OrderedNode {
  return isRecord(value)
}

function tagName(node: OrderedNode): string {
  return Object.keys(node).find((key) => key !== ':@') ?? ''
}

function tagIs(node: OrderedNode, expected: string): boolean {
  return tagName(node).toLocaleLowerCase('en-US') === expected
}

function nodeChildren(node: OrderedNode): OrderedNode[] {
  const value = node[tagName(node)]
  return Array.isArray(value) ? value.filter(isOrderedNode) : []
}

function nodeAttributes(node: OrderedNode): Record<string, unknown> {
  return isRecord(node[':@']) ? node[':@'] : {}
}

function childNodes(node: OrderedNode, name: string): OrderedNode[] {
  return nodeChildren(node).filter((child) => tagIs(child, name))
}

function firstChild(node: OrderedNode, name: string): OrderedNode | undefined {
  return childNodes(node, name)[0]
}

function rawText(node: OrderedNode): string {
  if (tagIs(node, '#text')) {
    const value = node['#text']
    return typeof value === 'string' ? value : ''
  }
  return nodeChildren(node).map(rawText).join(' ')
}

function plainText(node: OrderedNode | undefined, maxLength = 500): string | undefined {
  if (!node) return undefined
  const value = rawText(node)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength)
  return value || undefined
}

function markdownInline(value: string, maxLength = 20_000): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\b(?:https?|ftp):\/\/[^\s<>)\]]+/giu, '[external URL removed]')
    .replace(/\b(?:javascript|vbscript|data|file):[^\s<>)\]]*/giu, '[unsafe URL removed]')
    .replace(/\s+/gu, ' ')
    .replace(/([\\`*_[\]{}#+|>~])/gu, '\\$1')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .slice(0, maxLength)
}

function normalizedInline(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function safeReference(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/^#/u, '')
  return /^[A-Za-z0-9_.:-]{1,240}$/u.test(normalized) ? normalized : null
}

function hrefAttribute(node: OrderedNode): unknown {
  const attributes = nodeAttributes(node)
  return attributes['href'] ?? attributes['l:href']
}

function decodeBase64(value: string, label: string): Uint8Array {
  const compact = value.replace(/\s+/gu, '')
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
    throw new SecurityError('INVALID_DOCUMENT', `${label} contains invalid Base64 data.`)
  }
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=')
  if (padded.length % 4 !== 0 || (padded.length / 4) * 3 > SECURITY_POLICY.maxFb2BinaryBytes + 2) {
    throw new SecurityError('LIMIT_EXCEEDED', `${label} exceeds the decoded-image limit.`)
  }

  try {
    const decoded = atob(padded)
    const output = new Uint8Array(decoded.length)
    for (let index = 0; index < decoded.length; index += 1) output[index] = decoded.charCodeAt(index)
    return output
  } catch {
    throw new SecurityError('INVALID_DOCUMENT', `${label} contains invalid Base64 data.`)
  }
}

function documentRoot(parsed: unknown): OrderedNode {
  const nodes = Array.isArray(parsed) ? parsed.filter(isOrderedNode) : []
  const root = nodes.find((node) => tagIs(node, 'fictionbook'))
  if (!root) throw new SecurityError('INVALID_DOCUMENT', 'The XML document is not a FictionBook document.')
  return root
}

function authorName(author: OrderedNode | undefined): string | undefined {
  if (!author) return undefined
  const nickname = plainText(firstChild(author, 'nickname'))
  if (nickname) return nickname
  const parts = [
    plainText(firstChild(author, 'first-name')),
    plainText(firstChild(author, 'middle-name')),
    plainText(firstChild(author, 'last-name')),
  ].filter((value): value is string => Boolean(value))
  return parts.join(' ') || undefined
}

function readMetadata(root: OrderedNode): Fb2Metadata {
  const description = firstChild(root, 'description')
  const titleInfo = description ? firstChild(description, 'title-info') : undefined
  const title = plainText(titleInfo ? firstChild(titleInfo, 'book-title') : undefined) ?? 'Untitled FictionBook'
  const authors = titleInfo
    ? childNodes(titleInfo, 'author').map(authorName).filter((value): value is string => Boolean(value))
    : []
  const language = plainText(titleInfo ? firstChild(titleInfo, 'lang') : undefined, 40)
  const coverImage = titleInfo
    ? firstChild(firstChild(titleInfo, 'coverpage') ?? {}, 'image')
    : undefined
  const coverReference = coverImage ? safeReference(hrefAttribute(coverImage)) ?? undefined : undefined
  return {
    title,
    ...(authors.length ? { author: authors.join(', ').slice(0, 500) } : {}),
    ...(language ? { language } : {}),
    ...(coverReference ? { coverReference } : {}),
  }
}

function descendantCount(node: OrderedNode, expected: string): number {
  const own = tagIs(node, expected) ? 1 : 0
  return own + nodeChildren(node).reduce((sum, child) => sum + descendantCount(child, expected), 0)
}

function inspectFb2Xml(
  bytes: Uint8Array,
  accounting: ConversionAccounting,
): DocumentInspection {
  const root = documentRoot(parseXmlOrderedSecure(bytes, 'FictionBook document', SECURITY_POLICY.maxFb2Bytes))
  const metadata = readMetadata(root)
  const chapters = Math.max(1, childNodes(root, 'body').reduce(
    (sum, body) => sum + Math.max(1, childNodes(body, 'section').length),
    0,
  ))
  const graphics = descendantCount(root, 'binary')

  return {
    format: 'fb2',
    title: metadata.title,
    ...(metadata.author ? { author: metadata.author } : {}),
    ...(metadata.language ? { language: metadata.language } : {}),
    units: chapters,
    unitLabel: 'chapters',
    graphics,
    inputBytes: accounting.inputBytes,
    processedBytes: accounting.processedBytes,
    textCoverage: 'full',
    ocrRecommended: false,
    warnings: [],
  }
}

function readBinaries(root: OrderedNode): BinaryRecord[] {
  const records: BinaryRecord[] = []
  const seen = new Set<string>()
  let decodedBytes = 0

  for (const binary of childNodes(root, 'binary')) {
    const attributes = nodeAttributes(binary)
    const id = safeReference(attributes['id'])
    const mediaType = typeof attributes['content-type'] === 'string'
      ? attributes['content-type'].trim().toLocaleLowerCase('en-US')
      : ''
    if (!id) throw new SecurityError('INVALID_DOCUMENT', 'An FB2 binary has a missing or unsafe identifier.')
    const folded = id.toLocaleLowerCase('en-US')
    if (seen.has(folded)) throw new SecurityError('INVALID_DOCUMENT', `The FB2 contains duplicate binary id "${id}".`)
    seen.add(folded)

    const data = decodeBase64(rawText(binary), `FB2 binary "${id}"`)
    decodedBytes += data.byteLength
    if (decodedBytes > SECURITY_POLICY.maxFb2DecodedBytes) {
      throw new SecurityError('LIMIT_EXCEEDED', 'The decoded FB2 images exceed the total size limit.')
    }
    records.push({ id, mediaType, data })
  }
  return records
}

function renderInline(
  nodes: readonly OrderedNode[],
  assets: ReadonlyMap<string, Fb2AssetTarget>,
  warnings: string[],
): string {
  return nodes.map((node) => {
    const tag = tagName(node).toLocaleLowerCase('en-US')
    if (tag === '#text') return markdownInline(typeof node['#text'] === 'string' ? node['#text'] : '')
    if (tag === 'image') {
      const reference = safeReference(hrefAttribute(node))
      const target = reference ? assets.get(reference.toLocaleLowerCase('en-US')) : undefined
      if (!target) {
        warnings.push(`An FB2 image reference could not be matched to a safe embedded image and was omitted.`)
        return '[Image omitted]'
      }
      const attributes = nodeAttributes(node)
      const labelValue = typeof attributes['title'] === 'string' ? attributes['title'] : target.defaultLabel
      return `![${normalizedInline(markdownInline(labelValue, 500))}](${target.outputPath})`
    }

    const content = normalizedInline(renderInline(nodeChildren(node), assets, warnings))
    if (!content) return ''
    if (tag === 'strong' || tag === 'b') return `**${content}**`
    if (tag === 'emphasis' || tag === 'i') return `*${content}*`
    if (tag === 'strikethrough') return `~~${content}~~`
    if (tag === 'code') return `\`${content.replace(/`/gu, '\\`')}\``
    if (tag === 'a') {
      const reference = safeReference(hrefAttribute(node))
      if (reference) return `${content} (see note #${markdownInline(reference, 240)})`
      if (hrefAttribute(node) !== undefined) warnings.push('An external or unsafe FB2 link target was removed.')
    }
    return content
  }).join('')
}

function titleText(node: OrderedNode): string | undefined {
  return plainText(firstChild(node, 'title'))
}

function renderTable(
  node: OrderedNode,
  assets: ReadonlyMap<string, Fb2AssetTarget>,
  warnings: string[],
): string {
  const rows = childNodes(node, 'tr').map((row) => childNodes(row, 'th').concat(childNodes(row, 'td'))
    .map((cell) => normalizedInline(renderInline(nodeChildren(cell), assets, warnings)).replace(/\|/gu, '\\|')))
    .filter((row) => row.length > 0)
  if (rows.length === 0) return ''
  const columns = Math.max(...rows.map((row) => row.length))
  const padded = rows.map((row) => [...row, ...Array.from({ length: columns - row.length }, () => '')])
  const first = padded[0] ?? []
  return [`| ${first.join(' | ')} |`, `| ${first.map(() => '---').join(' | ')} |`,
    ...padded.slice(1).map((row) => `| ${row.join(' | ')} |`)].join('\n')
}

function quoteLines(value: string): string {
  return value.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')
}

function renderBlocks(
  nodes: readonly OrderedNode[],
  assets: ReadonlyMap<string, Fb2AssetTarget>,
  warnings: string[],
  depth = 1,
): string {
  const output: string[] = []
  for (const node of nodes) {
    const tag = tagName(node).toLocaleLowerCase('en-US')
    if (tag === '#text') {
      const text = normalizedInline(markdownInline(typeof node['#text'] === 'string' ? node['#text'] : ''))
      if (text) output.push(text)
      continue
    }
    if (tag === 'section') {
      const heading = titleText(node)
      if (heading) output.push(`${'#'.repeat(Math.min(depth, 6))} ${markdownInline(heading, 500).trim()}`)
      output.push(renderBlocks(nodeChildren(node).filter((child) => !tagIs(child, 'title')), assets, warnings, depth + 1))
      continue
    }
    if (tag === 'title') {
      const heading = plainText(node)
      if (heading) output.push(`${'#'.repeat(Math.min(depth, 6))} ${markdownInline(heading, 500).trim()}`)
      continue
    }
    if (tag === 'subtitle') {
      const subtitle = normalizedInline(renderInline(nodeChildren(node), assets, warnings))
      if (subtitle) output.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${subtitle}`)
      continue
    }
    if (tag === 'p' || tag === 'text-author' || tag === 'date') {
      const paragraph = normalizedInline(renderInline(nodeChildren(node), assets, warnings))
      if (paragraph) output.push(paragraph)
      continue
    }
    if (tag === 'image') {
      const image = normalizedInline(renderInline([node], assets, warnings))
      if (image) output.push(image)
      continue
    }
    if (tag === 'empty-line') {
      output.push('')
      continue
    }
    if (tag === 'table') {
      output.push(renderTable(node, assets, warnings))
      continue
    }
    if (tag === 'v') {
      const verse = normalizedInline(renderInline(nodeChildren(node), assets, warnings))
      if (verse) output.push(`> ${verse}`)
      continue
    }
    if (tag === 'epigraph' || tag === 'cite') {
      const quote = renderBlocks(nodeChildren(node), assets, warnings, depth)
      if (quote) output.push(quoteLines(quote))
      continue
    }
    output.push(renderBlocks(nodeChildren(node), assets, warnings, depth))
  }
  return output.filter((part, index, parts) => part || (index > 0 && parts[index - 1])).join('\n\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim()
}

function reportMarkdown(summary: ConversionSummary, sourceName: string): string {
  const warnings = summary.warnings.length
    ? summary.warnings.map((warning) => `- ${markdownInline(warning, 1_000).trim()}`).join('\n')
    : '- No content warnings.'
  return `# Security report

- Source: ${markdownInline(sourceName, 500).trim()}
- Format: FictionBook 2
- Title: ${markdownInline(summary.title, 500).trim()}
- Chapters processed: ${summary.units}
- Signature-checked or sanitized images exported: ${summary.assets}
- XML DTDs and entities allowed: no
- External network content loaded: no
- Active content exported: no
- Passive sanitized visual EPUB companion exported: yes
- Stable figure IDs and reading positions recorded: yes

## Warnings

${warnings}

## Enforced limits

- Input: 80 MB
- FB2 XML: 50 MB
- Individual decoded image: 25 MB
- Total decoded images: 100 MB
- Isolated conversion worker: 120 seconds

The hardening substantially reduces common risks, but it is not a mathematical security guarantee.
`
}

function sourceStem(filename: string): string {
  return safeOutputName(filename.replace(/\.fb2(?:\.zip)?$/iu, ''), 'fb2-export')
}

function chapterName(value: string | undefined, index: number): string {
  return safeOutputName(value ?? `Chapter ${index}`, `Chapter ${index}`)
}

function convertFb2Xml(
  bytes: Uint8Array,
  sourceName: string,
  accounting: ConversionAccounting,
  onProgress: ProgressReporter,
): ConversionResult {
  onProgress({ percent: 12, label: 'Validating the FictionBook XML' })
  const root = documentRoot(parseXmlOrderedSecure(bytes, 'FictionBook document', SECURITY_POLICY.maxFb2Bytes))
  const metadata = readMetadata(root)
  const warnings: string[] = accounting.repair
    ? [
        accounting.repair.level === 'salvage'
          ? 'The damaged compressed FB2 was processed in clearly marked salvage mode; verify completeness.'
          : 'The damaged compressed FB2 structure was repaired automatically before strict processing.',
      ]
    : []
  const outputFiles: Record<string, Uint8Array> = {}
  if (accounting.repair) {
    outputFiles['REPAIR-REPORT.md'] = strToU8(
      repairReportMarkdown(sourceName, accounting.repair, Boolean(accounting.repairedSourceBytes)),
    )
    if (accounting.repairedSourceBytes) {
      outputFiles['repair/source.repaired.fb2.zip'] = accounting.repairedSourceBytes
    }
  }
  const binaryRecords = readBinaries(root)
  const targets = new Map<string, Fb2AssetTarget>()
  const llmAssets = new Map<string, LlmAsset>()
  let assetSequence = 0

  for (const binary of binaryRecords) {
    const descriptor = rasterDescriptor(binary.mediaType)
    if (!descriptor) continue
    if (!descriptor.signature(binary.data)) {
      warnings.push(`FB2 image "${binary.id}" was omitted because its declared type and file signature do not match.`)
      continue
    }
    assetSequence += 1
    const outputPath = outputAssetPath(assetSequence, binary.id.replace(/\.[^.]+$/u, ''), descriptor.extension)
    const target: Fb2AssetTarget = {
      outputPath,
      figureId: figureId(assetSequence),
      mediaType: binary.mediaType,
      defaultLabel: safeOutputName(binary.id, `Image ${assetSequence}`),
    }
    targets.set(binary.id.toLocaleLowerCase('en-US'), target)
    outputFiles[outputPath] = binary.data
    llmAssets.set(outputPath, { ...target, data: binary.data })
  }

  for (const binary of binaryRecords) {
    if (binary.mediaType !== 'image/svg+xml') continue
    try {
      const sanitized = sanitizeSvg(binary.data, `FB2 SVG "${binary.id}"`, (reference) => {
        const id = safeReference(reference)
        const target = id ? targets.get(id.toLocaleLowerCase('en-US')) : undefined
        return target ? outputAssetName(target.outputPath) : null
      })
      assetSequence += 1
      const outputPath = outputAssetPath(assetSequence, binary.id.replace(/\.[^.]+$/u, ''), 'svg')
      const target: Fb2AssetTarget = {
        outputPath,
        figureId: figureId(assetSequence),
        mediaType: 'image/svg+xml',
        defaultLabel: safeOutputName(binary.id, `Image ${assetSequence}`),
      }
      targets.set(binary.id.toLocaleLowerCase('en-US'), target)
      outputFiles[outputPath] = sanitized.content
      llmAssets.set(outputPath, { ...target, data: sanitized.content })
      warnings.push(...sanitized.warnings.map((warning) => `FB2 SVG "${binary.id}": ${warning}`))
    } catch (error) {
      if (!(error instanceof SecurityError)) throw error
      warnings.push(`FB2 SVG "${binary.id}" was omitted: ${error.message}`)
    }
  }

  for (const binary of binaryRecords) {
    if (!rasterDescriptor(binary.mediaType) && binary.mediaType !== 'image/svg+xml') {
      warnings.push(`Embedded binary "${binary.id}" with unsupported type "${binary.mediaType || 'unknown'}" was omitted.`)
    }
  }

  const rawChapters: { readonly title: string; readonly markdown: string }[] = []
  const coverTarget = metadata.coverReference
    ? targets.get(metadata.coverReference.toLocaleLowerCase('en-US'))
    : undefined
  if (coverTarget) {
    rawChapters.push({ title: 'Cover', markdown: `# Cover\n\n![Cover](${coverTarget.outputPath})` })
  }

  for (const [bodyIndex, body] of childNodes(root, 'body').entries()) {
    const bodyNameValue = nodeAttributes(body)['name']
    const bodyName = typeof bodyNameValue === 'string' && bodyNameValue.trim()
      ? safeOutputName(bodyNameValue, `Part ${bodyIndex + 1}`)
      : undefined
    const children = nodeChildren(body)
    const sections = children.filter((child) => tagIs(child, 'section'))
    const loose = children.filter((child) => !tagIs(child, 'section'))
    const looseMarkdown = renderBlocks(loose, targets, warnings)
    if (looseMarkdown) {
      rawChapters.push({ title: bodyName ?? (bodyIndex === 0 ? 'Front matter' : `Part ${bodyIndex + 1}`), markdown: looseMarkdown })
    }
    for (const section of sections) {
      const title = titleText(section) ?? bodyName ?? `Chapter ${rawChapters.length + 1}`
      const markdown = renderBlocks([section], targets, warnings)
      if (markdown) rawChapters.push({ title, markdown })
    }
  }

  if (rawChapters.length === 0) {
    throw new SecurityError('UNSUPPORTED_DOCUMENT', 'The FictionBook contains no readable body content.')
  }

  const chapters: string[] = []
  const llmChapters: LlmChapter[] = []
  const occurrences: FigureOccurrence[] = []
  for (const [index, chapter] of rawChapters.entries()) {
    const sequence = index + 1
    const title = chapterName(chapter.title, sequence)
    const annotated = annotateMarkdownFigures(chapter.markdown, sequence, title, llmAssets)
    chapters.push(annotated.markdown)
    llmChapters.push({
      sequence,
      title,
      rawMarkdown: chapter.markdown,
      annotatedMarkdown: annotated.markdown,
      includeInCanonical: true,
    })
    occurrences.push(...annotated.occurrences)
    outputFiles[`chapters/${String(sequence).padStart(3, '0')}-${title}.md`] = strToU8(
      annotated.markdown.replace(/\]\(assets\//gu, '](../assets/'),
    )
    onProgress({
      percent: 35 + Math.round((sequence / rawChapters.length) * 48),
      label: `Converting FB2 chapter ${sequence} of ${rawChapters.length}`,
    })
  }

  const frontMatter = [
    `# ${markdownInline(metadata.title, 500).trim()}`,
    metadata.author ? `**Author:** ${markdownInline(metadata.author, 500).trim()}` : '',
    metadata.language ? `**Language:** ${markdownInline(metadata.language, 40).trim()}` : '',
  ].filter(Boolean).join('\n\n')
  const combined = `${frontMatter}\n\n---\n\n${chapters.join('\n\n---\n\n')}\n`
  outputFiles['book.md'] = strToU8(combined)

  const llmExport = buildLlmExport(
    {
      title: metadata.title,
      sourceFormat: 'FB2',
      ...(metadata.author ? { author: metadata.author } : {}),
      ...(metadata.language ? { language: metadata.language } : {}),
    },
    llmChapters,
    [...llmAssets.values()],
    occurrences,
  )
  Object.assign(outputFiles, llmExport.files)
  if (llmExport.instructionLikePassages > 0) {
    warnings.push(`The LLM safety scan found ${llmExport.instructionLikePassages} instruction-like passage(s); content was retained and documented in notebooklm/LLM-SAFETY-REPORT.md.`)
  }

  const uniqueWarnings = [...new Set(warnings)].slice(0, 100)
  const provisionalSummary: ConversionSummary = {
    format: 'fb2',
    title: metadata.title,
    ...(metadata.author ? { author: metadata.author } : {}),
    ...(metadata.language ? { language: metadata.language } : {}),
    units: rawChapters.length,
    unitLabel: 'chapters',
    assets: llmAssets.size,
    inputBytes: accounting.inputBytes,
    processedBytes: accounting.processedBytes,
    outputBytes: 0,
    ...(accounting.repair ? { repair: accounting.repair } : {}),
    warnings: uniqueWarnings,
  }
  outputFiles['SECURITY-REPORT.md'] = strToU8(reportMarkdown(provisionalSummary, sourceName))

  onProgress({ percent: 92, label: 'Building the passive FB2 export bundle' })
  const archive = zipSync(outputFiles, { level: 6, mtime: FIXED_ARCHIVE_DATE })
  if (archive.byteLength > SECURITY_POLICY.maxOutputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The export bundle exceeds the output size limit.')
  }
  onProgress({ percent: 100, label: 'Conversion complete' })
  return {
    archive,
    filename: `${sourceStem(sourceName)}-refined.zip`,
    summary: { ...provisionalSummary, outputBytes: archive.byteLength },
    preview: combined.slice(0, 8_000),
  }
}

export function convertFb2(
  bytes: Uint8Array,
  sourceName: string,
  onProgress: ProgressReporter = () => undefined,
): ConversionResult {
  return convertFb2Xml(bytes, sourceName, { inputBytes: bytes.byteLength, processedBytes: bytes.byteLength }, onProgress)
}

export function convertFb2Zip(
  bytes: Uint8Array,
  sourceName: string,
  onProgress: ProgressReporter = () => undefined,
): ConversionResult {
  onProgress({ percent: 7, label: 'Checking the compressed FB2 archive' })
  const archive = openRecoverableArchive(bytes)
  const candidates = [...archive.entries].filter(([path]) => path.toLocaleLowerCase('en-US').endsWith('.fb2'))
  if (candidates.length !== 1) {
    throw new SecurityError('INVALID_DOCUMENT', 'A compressed FB2 archive must contain exactly one .fb2 document.')
  }
  const [, document] = candidates[0]!
  return convertFb2Xml(document, sourceName, {
    inputBytes: bytes.byteLength,
    processedBytes: archive.uncompressedBytes,
    ...(archive.repair ? { repair: archive.repair, repairedSourceBytes: archive.sourceBytes } : {}),
  }, onProgress)
}

export function inspectFb2(bytes: Uint8Array): DocumentInspection {
  return inspectFb2Xml(bytes, {
    inputBytes: bytes.byteLength,
    processedBytes: bytes.byteLength,
  })
}

export function inspectFb2Zip(bytes: Uint8Array): DocumentInspection {
  const archive = openRecoverableArchive(bytes)
  const candidates = [...archive.entries].filter(([path]) =>
    path.toLocaleLowerCase('en-US').endsWith('.fb2'))
  if (candidates.length !== 1) {
    throw new SecurityError('INVALID_DOCUMENT', 'A compressed FB2 archive must contain exactly one .fb2 document.')
  }
  const [, document] = candidates[0]!
  const inspection = inspectFb2Xml(document, {
    inputBytes: bytes.byteLength,
    processedBytes: archive.uncompressedBytes,
  })
  return {
    ...inspection,
    ...(archive.repair ? { repair: archive.repair } : {}),
  }
}
