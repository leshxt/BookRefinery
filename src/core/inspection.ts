import { openSecureArchive } from './archive'
import { detectInputFormat } from './convert'
import type { DocumentInspection } from './contracts'
import { readEpubPackage } from './epub'
import { SecurityError } from './errors'
import { inspectFb2, inspectFb2Zip } from './fb2'
import { rasterDescriptor } from './images'
import { inspectPdf } from './pdf'
import { SECURITY_POLICY } from './policy'

export async function inspectDocument(
  bytes: Uint8Array,
  sourceName: string,
  password?: string,
): Promise<DocumentInspection> {
  if (bytes.byteLength > SECURITY_POLICY.maxInputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The file exceeds the 80 MB input limit.')
  }
  const format = detectInputFormat(bytes, sourceName)
  if (format === 'pdf') return inspectPdf(bytes, sourceName, password)
  if (format === 'fb2') return inspectFb2(bytes)
  if (format === 'fb2zip') return inspectFb2Zip(bytes)

  const archive = openSecureArchive(bytes)
  const epub = readEpubPackage(archive.entries)
  const graphics = epub.manifest.filter((item) =>
    Boolean(rasterDescriptor(item.mediaType)) || item.mediaType === 'image/svg+xml').length
  return {
    format: 'epub',
    title: epub.title,
    ...(epub.author ? { author: epub.author } : {}),
    ...(epub.language ? { language: epub.language } : {}),
    units: epub.spine.length,
    unitLabel: 'chapters',
    graphics,
    inputBytes: bytes.byteLength,
    processedBytes: archive.uncompressedBytes,
    textCoverage: 'full',
    ocrRecommended: false,
    warnings: epub.warnings,
  }
}
