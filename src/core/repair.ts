import { inflateSync, zipSync, type Zippable } from 'fflate'
import type { DocumentRepairSummary, RepairLevel } from './contracts'
import { SecurityError } from './errors'
import { validateArchiveEntryName } from './path'
import { SECURITY_POLICY } from './policy'

const LOCAL_FILE_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const FIXED_ARCHIVE_DATE = new Date('2026-01-01T00:00:00Z')
const UTF8_FLAG = 0x0800
const DATA_DESCRIPTOR_FLAG = 0x0008
const ENCRYPTED_FLAG = 0x0001
const ZIP64_SENTINEL = 0xffffffff

interface RecoveredEntry {
  readonly path: string
  readonly data: Uint8Array
}

interface RecoveryCandidate {
  readonly entries: readonly RecoveredEntry[]
  readonly actions: readonly string[]
  readonly level: RepairLevel
  readonly omittedEntries: number
}

export interface ZipRepairResult {
  readonly bytes: Uint8Array
  readonly summary: DocumentRepairSummary
}

function uint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    throw new SecurityError('DAMAGED_ARCHIVE', 'The ZIP archive ends inside a structural field.')
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function uint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    throw new SecurityError('DAMAGED_ARCHIVE', 'The ZIP archive ends inside a structural field.')
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0
}

function hasSignature(bytes: Uint8Array, offset: number, signature: number): boolean {
  return offset >= 0 && offset + 4 <= bytes.byteLength && uint32(bytes, offset) === signature
}

function decodeEntryName(raw: Uint8Array, flags: number): string {
  if ((flags & UTF8_FLAG) === 0 && raw.some((value) => value > 0x7f)) {
    throw new SecurityError(
      'AMBIGUOUS_REPAIR',
      'The damaged ZIP archive uses a legacy filename encoding that cannot be repaired unambiguously.',
    )
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    throw new SecurityError('DAMAGED_ARCHIVE', 'The ZIP archive contains an invalid UTF-8 filename.')
  }
}

let crcTable: Uint32Array | undefined

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let value = 0; value < table.length; value += 1) {
    let current = value
    for (let bit = 0; bit < 8; bit += 1) {
      current = (current & 1) !== 0 ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1)
    }
    table[value] = current >>> 0
  }
  crcTable = table
  return table
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const value of bytes) {
    crc = table[(crc ^ value) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function decompressEntry(
  compressed: Uint8Array,
  method: number,
  expectedSize: number,
  expectedCrc: number,
  path: string,
): Uint8Array {
  let data: Uint8Array
  if (method === 0) {
    data = compressed.slice()
  } else if (method === 8) {
    try {
      data = inflateSync(compressed, { out: new Uint8Array(expectedSize) })
    } catch {
      throw new SecurityError(
        'DAMAGED_ARCHIVE',
        `The compressed data for "${path}" is incomplete or damaged.`,
      )
    }
  } else {
    throw new SecurityError(
      'UNSUPPORTED_COMPRESSION',
      `The ZIP entry "${path}" uses unsupported compression method ${method}.`,
    )
  }

  if (data.byteLength !== expectedSize) {
    throw new SecurityError(
      'DAMAGED_ARCHIVE',
      `The ZIP entry "${path}" does not match its declared uncompressed size.`,
    )
  }
  if (crc32(data) !== expectedCrc) {
    throw new SecurityError(
      'DAMAGED_ARCHIVE',
      `The ZIP entry "${path}" failed its CRC integrity check.`,
    )
  }
  return data
}

function validateDeclaredSize(
  path: string,
  compressedSize: number,
  uncompressedSize: number,
  currentTotal: number,
): number {
  if (uncompressedSize > SECURITY_POLICY.maxEntryBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', `Archive entry "${path}" is too large.`)
  }
  const nextTotal = currentTotal + uncompressedSize
  if (nextTotal > SECURITY_POLICY.maxTotalUncompressedBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The unpacked ebook would exceed the total size limit.')
  }
  const ratio = uncompressedSize / Math.max(compressedSize, 1)
  if (
    uncompressedSize >= SECURITY_POLICY.minCompressionRatioCheckBytes &&
    ratio > SECURITY_POLICY.maxCompressionRatio
  ) {
    throw new SecurityError(
      'UNSAFE_ARCHIVE',
      `Archive entry "${path}" has a suspicious compression ratio.`,
    )
  }
  return nextTotal
}

function validateRecoveredEntries(entries: readonly RecoveredEntry[]): void {
  if (entries.length === 0) {
    throw new SecurityError('DAMAGED_ARCHIVE', 'No complete ZIP entries could be recovered.')
  }
  if (entries.length > SECURITY_POLICY.maxEntries) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The ebook archive contains too many entries.')
  }

  const seen = new Set<string>()
  let totalBytes = 0
  for (const entry of entries) {
    const path = validateArchiveEntryName(entry.path)
    const comparisonKey = path.toLocaleLowerCase('en-US')
    if (seen.has(comparisonKey)) {
      throw new SecurityError('UNSAFE_ARCHIVE', 'The archive contains ambiguous duplicate file paths.')
    }
    seen.add(comparisonKey)
    if (entry.data.byteLength > SECURITY_POLICY.maxEntryBytes) {
      throw new SecurityError('LIMIT_EXCEEDED', `Archive entry "${path}" is too large.`)
    }
    totalBytes += entry.data.byteLength
    if (totalBytes > SECURITY_POLICY.maxTotalUncompressedBytes) {
      throw new SecurityError('LIMIT_EXCEEDED', 'The unpacked ebook would exceed the total size limit.')
    }
  }
}

function recoverCentralDirectoryAt(
  bytes: Uint8Array,
  start: number,
): RecoveryCandidate | null {
  const entries: RecoveredEntry[] = []
  let cursor = start
  let declaredTotal = 0
  let recordCount = 0

  try {
    while (hasSignature(bytes, cursor, CENTRAL_DIRECTORY_SIGNATURE)) {
      recordCount += 1
      if (recordCount > SECURITY_POLICY.maxEntries) {
        throw new SecurityError('LIMIT_EXCEEDED', 'The ebook archive contains too many entries.')
      }
      if (cursor + 46 > bytes.byteLength) return null
      const flags = uint16(bytes, cursor + 8)
      const method = uint16(bytes, cursor + 10)
      const expectedCrc = uint32(bytes, cursor + 16)
      const compressedSize = uint32(bytes, cursor + 20)
      const uncompressedSize = uint32(bytes, cursor + 24)
      const nameLength = uint16(bytes, cursor + 28)
      const extraLength = uint16(bytes, cursor + 30)
      const commentLength = uint16(bytes, cursor + 32)
      const diskStart = uint16(bytes, cursor + 34)
      const localOffset = uint32(bytes, cursor + 42)
      if (
        compressedSize === ZIP64_SENTINEL ||
        uncompressedSize === ZIP64_SENTINEL ||
        localOffset === ZIP64_SENTINEL
      ) {
        throw new SecurityError(
          'UNSUPPORTED_DOCUMENT',
          'ZIP64 recovery is not supported for a damaged ebook archive.',
        )
      }
      if ((flags & ENCRYPTED_FLAG) !== 0) {
        throw new SecurityError(
          'UNSUPPORTED_DOCUMENT',
          'The damaged ZIP archive contains encrypted entries and cannot be repaired safely.',
        )
      }
      if (diskStart !== 0) {
        throw new SecurityError(
          'UNSUPPORTED_DOCUMENT',
          'Multi-disk ZIP archives cannot be repaired safely.',
        )
      }

      const recordEnd = cursor + 46 + nameLength + extraLength + commentLength
      if (recordEnd > bytes.byteLength || !hasSignature(bytes, localOffset, LOCAL_FILE_SIGNATURE)) {
        return null
      }
      const localFlags = uint16(bytes, localOffset + 6)
      const localMethod = uint16(bytes, localOffset + 8)
      const localNameLength = uint16(bytes, localOffset + 26)
      const localExtraLength = uint16(bytes, localOffset + 28)
      if (localFlags !== flags || localMethod !== method) return null

      const centralName = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
      const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)
      if (
        centralName.byteLength !== localName.byteLength ||
        centralName.some((value, index) => value !== localName[index])
      ) {
        return null
      }

      const path = decodeEntryName(centralName, flags)
      if (!path.endsWith('/')) {
        declaredTotal = validateDeclaredSize(path, compressedSize, uncompressedSize, declaredTotal)
      }
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength
      const dataEnd = dataOffset + compressedSize
      if (dataEnd > start) return null
      const compressed = bytes.subarray(dataOffset, dataEnd)
      if (!path.endsWith('/')) {
        entries.push({
          path: validateArchiveEntryName(path),
          data: decompressEntry(compressed, method, uncompressedSize, expectedCrc, path),
        })
      }
      cursor = recordEnd
    }
  } catch (error) {
    if (error instanceof SecurityError) throw error
    return null
  }

  if (entries.length === 0) return null
  const hasEndRecord =
    cursor === bytes.byteLength ||
    hasSignature(bytes, cursor, END_OF_CENTRAL_DIRECTORY_SIGNATURE)
  if (!hasEndRecord) return null

  validateRecoveredEntries(entries)
  return {
    entries,
    actions: [
      `Rebuilt the ZIP directory and end record from ${entries.length.toLocaleString('en-US')} CRC-verified entries.`,
    ],
    level: 'automatic',
    omittedEntries: 0,
  }
}

function findCentralDirectoryRecovery(bytes: Uint8Array): RecoveryCandidate | null {
  let signatures = 0
  for (let offset = 0; offset + 4 <= bytes.byteLength; offset += 1) {
    if (!hasSignature(bytes, offset, CENTRAL_DIRECTORY_SIGNATURE)) continue
    signatures += 1
    if (signatures > SECURITY_POLICY.maxEntries * 2) {
      throw new SecurityError(
        'UNSAFE_ARCHIVE',
        'The damaged archive contains too many plausible ZIP directory signatures.',
      )
    }
    const candidate = recoverCentralDirectoryAt(bytes, offset)
    if (candidate) return candidate
  }
  return null
}

function recoverLocalEntries(bytes: Uint8Array): RecoveryCandidate {
  const entries: RecoveredEntry[] = []
  const actions: string[] = []
  let cursor = 0
  let omittedEntries = 0
  let declaredTotal = 0
  let recordCount = 0

  while (hasSignature(bytes, cursor, LOCAL_FILE_SIGNATURE)) {
    recordCount += 1
    if (recordCount > SECURITY_POLICY.maxEntries) {
      throw new SecurityError('LIMIT_EXCEEDED', 'The ebook archive contains too many entries.')
    }
    if (cursor + 30 > bytes.byteLength) {
      omittedEntries += 1
      break
    }
    const flags = uint16(bytes, cursor + 6)
    const method = uint16(bytes, cursor + 8)
    const expectedCrc = uint32(bytes, cursor + 14)
    const compressedSize = uint32(bytes, cursor + 18)
    const uncompressedSize = uint32(bytes, cursor + 22)
    const nameLength = uint16(bytes, cursor + 26)
    const extraLength = uint16(bytes, cursor + 28)
    if ((flags & ENCRYPTED_FLAG) !== 0) {
      throw new SecurityError(
        'UNSUPPORTED_DOCUMENT',
        'The damaged ZIP archive contains encrypted entries and cannot be repaired safely.',
      )
    }
    if ((flags & DATA_DESCRIPTOR_FLAG) !== 0) {
      throw new SecurityError(
        'AMBIGUOUS_REPAIR',
        'The ZIP directory is missing and local entries use data descriptors, so their boundaries cannot be verified unambiguously.',
      )
    }
    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
      throw new SecurityError(
        'UNSUPPORTED_DOCUMENT',
        'ZIP64 recovery is not supported for a damaged ebook archive.',
      )
    }

    const headerEnd = cursor + 30 + nameLength + extraLength
    if (headerEnd > bytes.byteLength) {
      omittedEntries += 1
      break
    }
    const rawName = bytes.subarray(cursor + 30, cursor + 30 + nameLength)
    const path = decodeEntryName(rawName, flags)
    if (!path.endsWith('/')) {
      declaredTotal = validateDeclaredSize(path, compressedSize, uncompressedSize, declaredTotal)
    }
    const dataEnd = headerEnd + compressedSize
    if (dataEnd > bytes.byteLength) {
      omittedEntries += 1
      actions.push(`Omitted the incomplete trailing ZIP entry "${path}".`)
      break
    }

    if (!path.endsWith('/')) {
      const compressed = bytes.subarray(headerEnd, dataEnd)
      entries.push({
        path: validateArchiveEntryName(path),
        data: decompressEntry(compressed, method, uncompressedSize, expectedCrc, path),
      })
    }
    cursor = dataEnd
  }

  if (entries.length === 0) {
    throw new SecurityError('DAMAGED_ARCHIVE', 'No complete ZIP entries could be recovered.')
  }
  if (cursor < bytes.byteLength && omittedEntries === 0) {
    const remaining = bytes.byteLength - cursor
    actions.push(`Removed ${remaining.toLocaleString('en-US')} unreferenced trailing byte(s).`)
  }
  actions.unshift(
    `Reconstructed a canonical ZIP archive from ${entries.length.toLocaleString('en-US')} verified local entries.`,
  )
  validateRecoveredEntries(entries)
  return {
    entries,
    actions,
    level: omittedEntries > 0 ? 'salvage' : 'automatic',
    omittedEntries,
  }
}

export function buildCanonicalZip(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const files = Object.create(null) as Zippable
  const mimetype = entries.get('mimetype')
  if (mimetype) files['mimetype'] = [mimetype, { level: 0 }]

  const paths = [...entries.keys()]
    .filter((path) => path !== 'mimetype')
    .sort((left, right) => left.localeCompare(right, 'en-US'))
  for (const path of paths) {
    files[path] = entries.get(path)!
  }

  return zipSync(files, { level: 6, mtime: FIXED_ARCHIVE_DATE })
}

function canonicalizeRecoveredEntries(entries: readonly RecoveredEntry[]): Uint8Array {
  const map = new Map(entries.map((entry) => [entry.path, entry.data]))
  const bytes = buildCanonicalZip(map)
  if (bytes.byteLength > SECURITY_POLICY.maxInputBytes) {
    throw new SecurityError(
      'LIMIT_EXCEEDED',
      'The repaired ebook archive would exceed the 80 MB input limit.',
    )
  }
  return bytes
}

export function repairZipArchive(bytes: Uint8Array): ZipRepairResult {
  if (bytes.byteLength > SECURITY_POLICY.maxInputBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', 'The ebook archive exceeds the 80 MB input limit.')
  }
  if (!hasSignature(bytes, 0, LOCAL_FILE_SIGNATURE)) {
    throw new SecurityError(
      'DAMAGED_ARCHIVE',
      'The file has no recoverable ZIP local-file header at its beginning.',
    )
  }

  const candidate = findCentralDirectoryRecovery(bytes) ?? recoverLocalEntries(bytes)
  const repaired = canonicalizeRecoveredEntries(candidate.entries)
  return {
    bytes: repaired,
    summary: {
      level: candidate.level,
      actions: candidate.actions,
      originalBytes: bytes.byteLength,
      repairedBytes: repaired.byteLength,
      omittedEntries: candidate.omittedEntries,
    },
  }
}

export function mergeRepairSummaries(
  left: DocumentRepairSummary | undefined,
  right: DocumentRepairSummary | undefined,
): DocumentRepairSummary | undefined {
  if (!left) return right
  if (!right) return left
  return {
    level: left.level === 'salvage' || right.level === 'salvage' ? 'salvage' : 'automatic',
    actions: [...left.actions, ...right.actions],
    originalBytes: left.originalBytes,
    repairedBytes: right.repairedBytes,
    omittedEntries: left.omittedEntries + right.omittedEntries,
  }
}

function markdownInline(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/([\\`*_[\]{}()#+.!|>~])/gu, '\\$1')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .trim()
    .slice(0, maxLength)
}

export function repairReportMarkdown(
  sourceName: string,
  summary: DocumentRepairSummary,
  repairedSourceIncluded: boolean,
): string {
  const actions = summary.actions.map((action) => `- ${markdownInline(action, 1_000)}`).join('\n')
  return `# Repair report

- Source: ${markdownInline(sourceName, 500)}
- Mode: ${summary.level === 'salvage' ? 'salvage' : 'automatic content-preserving repair'}
- Original bytes: ${summary.originalBytes.toLocaleString('en-US')}
- Repaired bytes: ${summary.repairedBytes.toLocaleString('en-US')}
- Omitted incomplete entries: ${summary.omittedEntries.toLocaleString('en-US')}
- Structurally repaired source included: ${repairedSourceIncluded ? 'yes' : 'no'}

## Actions

${actions}

## Safety boundary

The original file was not modified. Every recovered entry passed path, size, compression, decompression,
and CRC checks before the repaired structure entered the normal strict BookRefinery preflight.
${summary.level === 'salvage'
    ? 'At least one incomplete entry was omitted. Treat the output as partial and verify its reading order and assets.'
    : 'No incomplete entry was omitted. This report confirms container integrity, not the truth or completeness of the book content.'}
`
}
