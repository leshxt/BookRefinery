import { SecurityError } from './errors'
import { archiveDirname, resolveArchiveReference } from './path'
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
    const mediaType = item['media-type']
    if (typeof id !== 'string' || typeof href !== 'string' || typeof mediaType !== 'string') continue

    let path: string
    try {
      path = resolveArchiveReference(baseDirectory, href)
    } catch (error) {
      if (!(error instanceof SecurityError)) throw error
      warnings.push(`Ignored manifest item "${id}" because its path is unsafe.`)
      continue
    }
    const manifestItem: ManifestItem = {
      id,
      path,
      mediaType: (mediaType.split(';', 1)[0] ?? mediaType).trim().toLocaleLowerCase('en-US'),
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

  if (spine.length === 0) {
    throw new SecurityError('UNSUPPORTED_DOCUMENT', 'The EPUB contains no supported XHTML or image reading-order items.')
  }

  const author = firstText(metadata['creator'])
  const language = firstText(metadata['language'])

  return {
    title: firstText(metadata['title']) ?? 'Untitled EPUB',
    ...(author ? { author } : {}),
    ...(language ? { language } : {}),
    packagePath,
    manifest,
    spine,
    warnings: [...new Set(warnings)],
  }
}
