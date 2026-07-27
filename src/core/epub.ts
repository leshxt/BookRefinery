import { strToU8 } from 'fflate'
import { openRecoverableArchive, openSecureArchive, type SecureArchive } from './archive'
import type { DocumentRepairSummary, RepairLevel } from './contracts'
import { SecurityError } from './errors'
import { archiveDirname, resolveArchiveReference } from './path'
import { SECURITY_POLICY } from './policy'
import { buildCanonicalZip, mergeRepairSummaries } from './repair'
import { asRecords, isRecord, parseXmlSecure, readText } from './xml'

export interface ManifestItem {
  readonly id: string
  readonly path: string
  readonly mediaType: string
  readonly properties: readonly string[]
}

export interface EpubPackage {
  readonly title: string
  readonly author?: string
  readonly language?: string
  readonly packagePath: string
  readonly manifest: readonly ManifestItem[]
  readonly spine: readonly ManifestItem[]
  readonly warnings: readonly string[]
  readonly repairs: readonly string[]
  readonly repairLevel?: RepairLevel
}

export interface RepairableEpub {
  readonly archive: SecureArchive
  readonly epub: EpubPackage
  readonly sourceBytes: Uint8Array
  readonly repairedSourceBytes?: Uint8Array
  readonly repair?: DocumentRepairSummary
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new SecurityError('INVALID_DOCUMENT', message)
  return value
}

function firstText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = readText(item)
      if (text) return text
    }
    return undefined
  }
  return readText(value)
}

function inferMediaType(path: string): string | undefined {
  const extension = path.split('.').at(-1)?.toLocaleLowerCase('en-US')
  switch (extension) {
    case 'xhtml':
    case 'xht':
      return 'application/xhtml+xml'
    case 'html':
    case 'htm':
      return 'text/html'
    case 'svg':
      return 'image/svg+xml'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'css':
      return 'text/css'
    case 'ncx':
      return 'application/x-dtbncx+xml'
    default:
      return undefined
  }
}

function findPackagePath(entries: ReadonlyMap<string, Uint8Array>, warnings: string[]): string {
  const containerBytes = entries.get('META-INF/container.xml')
  if (!containerBytes) {
    throw new SecurityError('INVALID_DOCUMENT', 'META-INF/container.xml is missing.')
  }

  const parsed = requireRecord(parseXmlSecure(containerBytes, 'container.xml'), 'container.xml is invalid.')
  const container = requireRecord(parsed['container'], 'container.xml has no container element.')
  const rootfiles = requireRecord(container['rootfiles'], 'container.xml has no rootfiles element.')
  const candidates = asRecords(rootfiles['rootfile'])
    .sort((left, right) => Number(right['media-type'] === 'application/oebps-package+xml') - Number(left['media-type'] === 'application/oebps-package+xml'))

  for (const rootfile of candidates) {
    const fullPath = rootfile['full-path']
    if (typeof fullPath !== 'string' || !fullPath.trim()) continue
    try {
      const resolved = resolveArchiveReference('', fullPath.trim())
      if (entries.has(resolved)) return resolved
    } catch (error) {
      if (!(error instanceof SecurityError)) throw error
      warnings.push('Ignored an unsafe package-document reference in container.xml.')
    }
  }
  throw new SecurityError('INVALID_DOCUMENT', 'container.xml does not point to an available OPF package document.')
}

export function readEpubPackage(entries: ReadonlyMap<string, Uint8Array>): EpubPackage {
  const warnings: string[] = []
  const repairs: string[] = []
  const mimetype = entries.get('mimetype')
  const mimetypeValue = mimetype ? new TextDecoder().decode(mimetype) : ''
  if (mimetypeValue !== 'application/epub+zip') {
    warnings.push('The EPUB mimetype entry is missing or non-standard; the package structure was validated instead.')
  }

  const packagePath = findPackagePath(entries, warnings)
  const packageBytes = entries.get(packagePath)
  if (!packageBytes) {
    throw new SecurityError('INVALID_DOCUMENT', 'The OPF package document referenced by container.xml is missing.')
  }

  const parsed = requireRecord(parseXmlSecure(packageBytes, 'OPF package document'), 'The OPF package document is invalid.')
  const packageNode = requireRecord(parsed['package'], 'The OPF document has no package element.')
  const metadata = requireRecord(packageNode['metadata'], 'The OPF document has no metadata element.')
  const manifestNode = requireRecord(packageNode['manifest'], 'The OPF document has no manifest.')
  const spineNode = requireRecord(packageNode['spine'], 'The OPF document has no reading order.')

  const baseDirectory = archiveDirname(packagePath)
  const manifest: ManifestItem[] = []
  const byId = new Map<string, ManifestItem>()

  for (const item of asRecords(manifestNode['item'])) {
    const id = item['id']
    const href = item['href']
    if (typeof id !== 'string' || typeof href !== 'string') continue

    let path: string
    try {
      path = resolveArchiveReference(baseDirectory, href)
    } catch (error) {
      if (!(error instanceof SecurityError)) throw error
      warnings.push(`Ignored manifest item "${id}" because its path is unsafe.`)
      continue
    }
    const declaredMediaType = typeof item['media-type'] === 'string'
      ? (item['media-type'].split(';', 1)[0] ?? item['media-type']).trim().toLocaleLowerCase('en-US')
      : ''
    const inferredMediaType = inferMediaType(path)
    const mediaType = declaredMediaType && declaredMediaType !== 'application/octet-stream'
      ? declaredMediaType
      : inferredMediaType
    if (!mediaType) {
      warnings.push(`Ignored manifest item "${id}" because its media type is missing or unsupported.`)
      continue
    }
    if (mediaType !== declaredMediaType) {
      repairs.push(`Inferred ${mediaType} for manifest item "${id}" from its safe archive path.`)
    }
    const manifestItem: ManifestItem = {
      id,
      path,
      mediaType,
      properties: typeof item['properties'] === 'string' ? item['properties'].split(/\s+/u) : [],
    }
    if (byId.has(id)) {
      warnings.push(`Ignored duplicate manifest ID "${id}".`)
      continue
    }
    manifest.push(manifestItem)
    byId.set(id, manifestItem)
  }

  const spine: ManifestItem[] = []
  for (const itemref of asRecords(spineNode['itemref'])) {
    const idref = itemref['idref']
    if (typeof idref !== 'string') continue
    const item = byId.get(idref)
    if (!item) {
      warnings.push(`Skipped reading-order item "${idref}" because it is missing from the safe manifest.`)
      continue
    }
    if (
      item.mediaType === 'application/xhtml+xml' ||
      item.mediaType === 'text/html' ||
      item.mediaType.startsWith('image/')
    ) {
      spine.push(item)
    } else {
      warnings.push(`Skipped unsupported reading-order item "${idref}" (${item.mediaType}).`)
    }
  }

  let repairLevel: RepairLevel | undefined = repairs.length > 0 ? 'automatic' : undefined
  if (spine.length === 0) {
    const fallback = manifest.filter((item) =>
      entries.has(item.path) &&
      !item.properties.includes('nav') &&
      (
        item.mediaType === 'application/xhtml+xml' ||
        item.mediaType === 'text/html' ||
        item.mediaType.startsWith('image/')
      ))
    if (fallback.length === 0) {
      throw new SecurityError('UNSUPPORTED_DOCUMENT', 'The EPUB contains no supported XHTML or image reading-order items.')
    }
    spine.push(...fallback)
    repairLevel = 'salvage'
    repairs.push(
      `Reconstructed a ${fallback.length.toLocaleString('en-US')}-item reading order from the safe manifest because the original spine was unusable.`,
    )
    warnings.push('Salvage mode reconstructed reading order from manifest order; verify chapter order against another copy if possible.')
  }

  const author = firstText(metadata['creator'])
  const language = firstText(metadata['language'])
  const uniqueRepairs = [...new Set(repairs)]
  const reportedRepairs = uniqueRepairs.length > SECURITY_POLICY.maxRepairActions
    ? [
        ...uniqueRepairs.slice(0, SECURITY_POLICY.maxRepairActions),
        `Omitted ${uniqueRepairs.length - SECURITY_POLICY.maxRepairActions} additional repetitive repair action(s) from the report.`,
      ]
    : uniqueRepairs

  return {
    title: firstText(metadata['title']) ?? 'Untitled EPUB',
    ...(author ? { author } : {}),
    ...(language ? { language } : {}),
    packagePath,
    manifest,
    spine,
    warnings: [...new Set(warnings)],
    repairs: reportedRepairs,
    ...(repairLevel ? { repairLevel } : {}),
  }
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}

function containerDocument(packagePath: string): Uint8Array {
  return strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${escapeXmlAttribute(packagePath)}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`)
}

function findUniquePackageRepair(
  entries: ReadonlyMap<string, Uint8Array>,
): { readonly packagePath: string; readonly epub: EpubPackage } | null {
  const candidates: { readonly packagePath: string; readonly epub: EpubPackage }[] = []
  const packagePaths = [...entries.keys()].filter((path) =>
    path.toLocaleLowerCase('en-US').endsWith('.opf'))
  if (packagePaths.length > SECURITY_POLICY.maxRepairOpfCandidates) {
    throw new SecurityError(
      'AMBIGUOUS_REPAIR',
      'The EPUB contains too many possible OPF package documents for a bounded automatic repair.',
    )
  }
  for (const packagePath of packagePaths) {
    const candidateEntries = new Map(entries)
    candidateEntries.set('META-INF/container.xml', containerDocument(packagePath))
    try {
      candidates.push({ packagePath, epub: readEpubPackage(candidateEntries) })
    } catch (error) {
      if (!(error instanceof SecurityError)) throw error
    }
  }
  if (candidates.length > 1) {
    throw new SecurityError(
      'AMBIGUOUS_REPAIR',
      'The EPUB contains more than one plausible OPF package document, so container.xml cannot be rebuilt unambiguously.',
    )
  }
  return candidates[0] ?? null
}

export function openRepairableEpub(bytes: Uint8Array): RepairableEpub {
  const recovered = openRecoverableArchive(bytes)
  const entries = new Map(recovered.entries)
  const structuralActions: string[] = []
  const mimetype = entries.get('mimetype')
  if (!mimetype || new TextDecoder().decode(mimetype) !== 'application/epub+zip') {
    entries.set('mimetype', strToU8('application/epub+zip'))
    structuralActions.push('Rebuilt the required uncompressed EPUB mimetype entry.')
  }

  let epub: EpubPackage
  try {
    epub = readEpubPackage(entries)
  } catch (originalError) {
    if (!(originalError instanceof SecurityError)) throw originalError
    const repairedPackage = findUniquePackageRepair(entries)
    if (!repairedPackage) throw originalError
    entries.set('META-INF/container.xml', containerDocument(repairedPackage.packagePath))
    structuralActions.push(
      `Rebuilt META-INF/container.xml to reference the unique package document "${repairedPackage.packagePath}".`,
    )
    epub = readEpubPackage(entries)
  }

  let sourceBytes = recovered.sourceBytes
  let structuralRepair: DocumentRepairSummary | undefined
  if (structuralActions.length > 0) {
    sourceBytes = buildCanonicalZip(entries)
    openSecureArchive(sourceBytes)
    structuralRepair = {
      level: 'automatic',
      actions: structuralActions,
      originalBytes: recovered.sourceBytes.byteLength,
      repairedBytes: sourceBytes.byteLength,
      omittedEntries: 0,
    }
  }

  const packageRepair: DocumentRepairSummary | undefined = epub.repairs.length > 0
    ? {
        level: epub.repairLevel ?? 'automatic',
        actions: epub.repairs,
        originalBytes: sourceBytes.byteLength,
        repairedBytes: sourceBytes.byteLength,
        omittedEntries: 0,
      }
    : undefined
  const repair = mergeRepairSummaries(
    mergeRepairSummaries(recovered.repair, structuralRepair),
    packageRepair,
  )

  return {
    archive: openSecureArchive(sourceBytes),
    epub,
    sourceBytes,
    ...(repair ? { repair } : {}),
    ...(repair && epub.repairs.length === 0 ? { repairedSourceBytes: sourceBytes } : {}),
  }
}
