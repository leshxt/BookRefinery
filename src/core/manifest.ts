import { strToU8, unzipSync, zipSync } from 'fflate'
import type { ConversionResult } from './convert'
import type { ConversionOptions, OutputSelectionId } from './contracts'
import { SecurityError } from './errors'
import { safeOutputName } from './path'
import { conversionResourcePolicy } from './policy'

const FIXED_ARCHIVE_DATE = new Date('2026-01-01T00:00:00Z')

interface ManifestFile {
  readonly path: string
  readonly mediaType: string
  readonly bytes: number
  readonly sha256: string
}

function keepForSelection(
  path: string,
  outputs: readonly OutputSelectionId[],
  profile: ConversionOptions['profile'],
): boolean {
  if (
    path === 'SECURITY-REPORT.md' ||
    path === 'REPAIR-REPORT.md' ||
    path === 'notebooklm/LLM-SAFETY-REPORT.md' ||
    path.startsWith('repair/')
  ) return true
  if (profile === 'archive' && (path === 'notebooklm/book.md' || path === 'notebooklm/document.md')) {
    return true
  }
  if (outputs.includes('visual-source') && (
    path === 'notebooklm/book.sanitized.epub' ||
    path === 'notebooklm/document.sanitized.pdf' ||
    path === 'notebooklm/README.md'
  )) return true
  if (outputs.includes('assets') && path === 'notebooklm/document.sanitized.pdf') return true
  if (outputs.includes('markdown') && (path === 'book.md' || path === 'document.md')) return true
  if (outputs.includes('chunks') && (
    path.startsWith('chapters/') ||
    path.startsWith('pages/') ||
    path.startsWith('sections/') ||
    path === 'OUTLINE.md'
  )) return true
  return outputs.includes('assets') && (
    path.startsWith('assets/') ||
    path === 'notebooklm/FIGURE-INDEX.md'
  )
}

function titledPath(path: string, titleStem: string): string {
  switch (path) {
    case 'book.md':
    case 'document.md':
      return `${titleStem}.md`
    case 'notebooklm/book.sanitized.epub':
      return `notebooklm/${titleStem}.sanitized.epub`
    case 'notebooklm/document.sanitized.pdf':
      return `notebooklm/${titleStem}.sanitized.pdf`
    case 'notebooklm/book.md':
    case 'notebooklm/document.md':
      return `notebooklm/${titleStem}.md`
    case 'notebooklm/FIGURE-INDEX.md':
      return `notebooklm/${titleStem}.figure-index.md`
    case 'notebooklm/LLM-SAFETY-REPORT.md':
      return `notebooklm/${titleStem}.llm-safety-report.md`
    case 'SECURITY-REPORT.md':
      return `${titleStem}.security-report.md`
    case 'REPAIR-REPORT.md':
      return `${titleStem}.repair-report.md`
    case 'repair/source.repaired.epub':
      return `repair/${titleStem}.repaired.epub`
    case 'repair/source.repaired.fb2.zip':
      return `repair/${titleStem}.repaired.fb2.zip`
    case 'OUTLINE.md':
      return `${titleStem}.outline.md`
    default:
      return path
  }
}

function mediaType(path: string): string {
  const extension = path.split('.').at(-1)?.toLocaleLowerCase('en-US')
  switch (extension) {
    case 'md':
      return 'text/markdown'
    case 'json':
      return 'application/json'
    case 'epub':
      return 'application/epub+zip'
    case 'pdf':
      return 'application/pdf'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

async function sha256(data: Uint8Array): Promise<string> {
  const source = new ArrayBuffer(data.byteLength)
  new Uint8Array(source).set(data)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function outputFilename(titleStem: string, profile: ConversionOptions['profile']): string {
  const suffix = profile === 'archive' ? 'safe-archive' : profile
  return `${titleStem}-${suffix}.zip`
}

export async function packageConversionResult(
  result: ConversionResult,
  options: Pick<ConversionOptions, 'profile' | 'outputs' | 'resourceMode'>,
): Promise<ConversionResult> {
  const unpacked = unzipSync(result.archive)
  const titleStem = safeOutputName(result.summary.title, 'Untitled book')
  const selectedEntries = Object.entries(unpacked)
    .filter(([path]) => keepForSelection(path, options.outputs, options.profile))
    .map(([path, data]) => [titledPath(path, titleStem), data] as const)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))

  const files: Record<string, Uint8Array> = {}
  const manifestFiles: ManifestFile[] = []
  for (const [path, data] of selectedEntries) {
    if (files[path]) throw new SecurityError('CONVERSION_FAILED', `Two generated files resolved to ${path}.`)
    files[path] = data
    manifestFiles.push({
      path,
      mediaType: mediaType(path),
      bytes: data.byteLength,
      sha256: await sha256(data),
    })
  }

  const manifest = {
    schemaVersion: 2,
    generator: 'BookRefinery',
    profile: options.profile,
    selectedOutputs: options.outputs,
    source: {
      format: result.summary.format,
      title: result.summary.title,
      ...(result.summary.author ? { author: result.summary.author } : {}),
      ...(result.summary.language ? { language: result.summary.language } : {}),
      inputBytes: result.summary.inputBytes,
      ...(result.summary.repair ? { repair: result.summary.repair } : {}),
    },
    output: {
      units: result.summary.units,
      unitLabel: result.summary.unitLabel,
      sanitizedGraphics: result.summary.assets,
      files: manifestFiles,
    },
  }
  const manifestPath = `${titleStem}.export-manifest.json`
  files[manifestPath] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)

  const archive = zipSync(files, { level: 6, mtime: FIXED_ARCHIVE_DATE })
  if (archive.byteLength > conversionResourcePolicy(options.resourceMode).maxOutputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The selected outputs exceed the output size limit.')
  }

  return {
    ...result,
    archive,
    filename: outputFilename(titleStem, options.profile),
    summary: {
      ...result.summary,
      outputBytes: archive.byteLength,
    },
  }
}
