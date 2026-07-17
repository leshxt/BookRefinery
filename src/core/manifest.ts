import { strToU8, unzipSync, zipSync } from 'fflate'
import type { ConversionResult } from './convert'
import type { OutputProfileId } from './contracts'
import { SecurityError } from './errors'
import { SECURITY_POLICY } from './policy'

const FIXED_ARCHIVE_DATE = new Date('2026-01-01T00:00:00Z')

interface ManifestFile {
  readonly path: string
  readonly mediaType: string
  readonly bytes: number
  readonly sha256: string
}

function keepForProfile(path: string, profile: OutputProfileId): boolean {
  if (path === 'SECURITY-REPORT.md') return true
  if (profile === 'archive') return true
  if (profile === 'notebooklm') {
    return path.startsWith('notebooklm/') || path.startsWith('assets/')
  }
  if (profile === 'rag') {
    return (
      path === 'book.md' ||
      path === 'document.md' ||
      path === 'notebooklm/document.sanitized.pdf' ||
      path.startsWith('chapters/') ||
      path.startsWith('pages/') ||
      path.startsWith('sections/') ||
      path === 'OUTLINE.md' ||
      path.startsWith('assets/') ||
      path === 'notebooklm/FIGURE-INDEX.md' ||
      path === 'notebooklm/LLM-SAFETY-REPORT.md'
    )
  }
  return (
    path === 'book.md' ||
    path === 'document.md' ||
    path === 'notebooklm/document.sanitized.pdf' ||
    path.startsWith('assets/')
  )
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

function outputFilename(filename: string, profile: OutputProfileId): string {
  const suffix = {
    notebooklm: 'notebooklm',
    rag: 'rag',
    markdown: 'markdown',
    archive: 'safe-archive',
  }[profile]
  return filename.replace(/-refined\.zip$/u, `-${suffix}.zip`)
}

export async function packageConversionResult(
  result: ConversionResult,
  profile: OutputProfileId,
): Promise<ConversionResult> {
  const unpacked = unzipSync(result.archive)
  const selectedEntries = Object.entries(unpacked)
    .filter(([path]) => keepForProfile(path, profile))
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))

  const files: Record<string, Uint8Array> = Object.fromEntries(selectedEntries)
  const manifestFiles: ManifestFile[] = []
  for (const [path, data] of selectedEntries) {
    manifestFiles.push({
      path,
      mediaType: mediaType(path),
      bytes: data.byteLength,
      sha256: await sha256(data),
    })
  }

  const manifest = {
    schemaVersion: 1,
    generator: 'BookRefinery',
    profile,
    source: {
      format: result.summary.format,
      title: result.summary.title,
      ...(result.summary.author ? { author: result.summary.author } : {}),
      ...(result.summary.language ? { language: result.summary.language } : {}),
      inputBytes: result.summary.inputBytes,
    },
    output: {
      units: result.summary.units,
      unitLabel: result.summary.unitLabel,
      sanitizedGraphics: result.summary.assets,
      files: manifestFiles,
    },
  }
  files['EXPORT-MANIFEST.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)

  const archive = zipSync(files, { level: 6, mtime: FIXED_ARCHIVE_DATE })
  if (archive.byteLength > SECURITY_POLICY.maxOutputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The selected export profile exceeds the output size limit.')
  }

  return {
    ...result,
    archive,
    filename: outputFilename(result.filename, profile),
    summary: {
      ...result.summary,
      outputBytes: archive.byteLength,
    },
  }
}
