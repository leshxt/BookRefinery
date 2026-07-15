import { unzipSync, type UnzipFileInfo } from 'fflate'
import { SecurityError } from './errors'
import { validateArchiveEntryName } from './path'
import { SECURITY_POLICY } from './policy'

export interface SecureArchive {
  readonly entries: ReadonlyMap<string, Uint8Array>
  readonly entryCount: number
  readonly uncompressedBytes: number
}

function assertZipSignature(bytes: Uint8Array): void {
  const isZip =
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)

  if (!isZip) {
    throw new SecurityError('INVALID_DOCUMENT', 'The file is not a valid ZIP-based ebook archive.')
  }
}

export function openSecureArchive(bytes: Uint8Array): SecureArchive {
  if (bytes.byteLength > SECURITY_POLICY.maxInputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The ebook archive exceeds the 80 MB input limit.')
  }
  assertZipSignature(bytes)

  let declaredBytes = 0
  let entryCount = 0
  const seen = new Set<string>()

  const filter = (file: UnzipFileInfo): boolean => {
    entryCount += 1
    if (entryCount > SECURITY_POLICY.maxEntries) {
      throw new SecurityError('LIMIT_EXCEEDED', 'The ebook archive contains too many entries.')
    }

    const path = validateArchiveEntryName(file.name)
    const comparisonKey = path.toLocaleLowerCase('en-US')
    if (seen.has(comparisonKey)) {
      throw new SecurityError('UNSAFE_ARCHIVE', 'The ebook archive contains ambiguous duplicate file paths.')
    }
    seen.add(comparisonKey)

    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) {
      throw new SecurityError('UNSAFE_ARCHIVE', 'The ebook archive reports an invalid file size.')
    }
    if (file.originalSize > SECURITY_POLICY.maxEntryBytes) {
      throw new SecurityError('LIMIT_EXCEEDED', `Archive entry "${path}" is too large.`)
    }

    declaredBytes += file.originalSize
    if (declaredBytes > SECURITY_POLICY.maxTotalUncompressedBytes) {
      throw new SecurityError('LIMIT_EXCEEDED', 'The unpacked ebook would exceed the total size limit.')
    }

    const ratio = file.originalSize / Math.max(file.size, 1)
    if (
      file.originalSize >= SECURITY_POLICY.minCompressionRatioCheckBytes &&
      ratio > SECURITY_POLICY.maxCompressionRatio
    ) {
      throw new SecurityError('UNSAFE_ARCHIVE', `Archive entry "${path}" has a suspicious compression ratio.`)
    }

    return !file.name.endsWith('/')
  }

  let unpacked: Record<string, Uint8Array>
  try {
    unpacked = unzipSync(bytes, { filter })
  } catch (error) {
    if (error instanceof SecurityError) throw error
    throw new SecurityError('INVALID_DOCUMENT', 'The ZIP archive is damaged or uses an unsupported compression method.')
  }

  const entries = new Map<string, Uint8Array>()
  let actualBytes = 0
  for (const [rawPath, data] of Object.entries(unpacked)) {
    const path = validateArchiveEntryName(rawPath)
    actualBytes += data.byteLength
    if (data.byteLength > SECURITY_POLICY.maxEntryBytes || actualBytes > SECURITY_POLICY.maxTotalUncompressedBytes) {
      throw new SecurityError('LIMIT_EXCEEDED', 'The unpacked ebook exceeds a security limit.')
    }
    entries.set(path, data)
  }

  return { entries, entryCount, uncompressedBytes: actualBytes }
}
