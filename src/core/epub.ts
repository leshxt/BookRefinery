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

function findPackagePath(entries: ReadonlyMap<string, Uint8Array>): string {
  const containerBytes = entries.get('META-INF/container.xml')
  if (!containerBytes) {
    throw new SecurityError('INVALID_DOCUMENT', 'META-INF/container.xml fehlt.')
  }

  const parsed = requireRecord(parseXmlSecure(containerBytes, 'container.xml'), 'container.xml ist ungültig.')
  const container = requireRecord(parsed['container'], 'container.xml enthält kein container-Element.')
  const rootfiles = requireRecord(container['rootfiles'], 'container.xml enthält keine rootfiles.')
  const rootfile = asRecords(rootfiles['rootfile'])[0]
  const fullPath = rootfile?.['full-path']

  if (typeof fullPath !== 'string' || !fullPath.trim()) {
    throw new SecurityError('INVALID_DOCUMENT', 'container.xml nennt keine OPF-Paketdatei.')
  }

  return resolveArchiveReference('', fullPath.trim())
}

export function readEpubPackage(entries: ReadonlyMap<string, Uint8Array>): EpubPackage {
  const mimetype = entries.get('mimetype')
  if (!mimetype || new TextDecoder().decode(mimetype) !== 'application/epub+zip') {
    throw new SecurityError('INVALID_DOCUMENT', 'Der EPUB-MIME-Typ fehlt oder ist ungültig.')
  }

  const packagePath = findPackagePath(entries)
  const packageBytes = entries.get(packagePath)
  if (!packageBytes) {
    throw new SecurityError('INVALID_DOCUMENT', 'Die in container.xml genannte OPF-Datei fehlt.')
  }

  const parsed = requireRecord(parseXmlSecure(packageBytes, 'OPF-Paketdatei'), 'Die OPF-Paketdatei ist ungültig.')
  const packageNode = requireRecord(parsed['package'], 'Die OPF-Datei enthält kein package-Element.')
  const metadata = requireRecord(packageNode['metadata'], 'Die OPF-Datei enthält keine Metadaten.')
  const manifestNode = requireRecord(packageNode['manifest'], 'Die OPF-Datei enthält kein Manifest.')
  const spineNode = requireRecord(packageNode['spine'], 'Die OPF-Datei enthält keine Lesereihenfolge.')

  const baseDirectory = archiveDirname(packagePath)
  const manifest: ManifestItem[] = []
  const byId = new Map<string, ManifestItem>()

  for (const item of asRecords(manifestNode['item'])) {
    const id = item['id']
    const href = item['href']
    const mediaType = item['media-type']
    if (typeof id !== 'string' || typeof href !== 'string' || typeof mediaType !== 'string') continue

    const manifestItem: ManifestItem = {
      id,
      path: resolveArchiveReference(baseDirectory, href),
      mediaType: mediaType.toLocaleLowerCase('en-US'),
      properties: typeof item['properties'] === 'string' ? item['properties'].split(/\s+/u) : [],
    }
    if (byId.has(id)) {
      throw new SecurityError('INVALID_DOCUMENT', 'Das OPF-Manifest enthält doppelte IDs.')
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
      throw new SecurityError('INVALID_DOCUMENT', 'Die Lesereihenfolge verweist auf einen fehlenden Manifest-Eintrag.')
    }
    if (item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html') {
      spine.push(item)
    }
  }

  if (spine.length === 0) {
    throw new SecurityError('UNSUPPORTED_DOCUMENT', 'Das EPUB enthält keine unterstützten XHTML-Kapitel.')
  }

  const author = firstText(metadata['creator'])
  const language = firstText(metadata['language'])

  return {
    title: firstText(metadata['title']) ?? 'Unbenanntes EPUB',
    ...(author ? { author } : {}),
    ...(language ? { language } : {}),
    packagePath,
    manifest,
    spine,
  }
}
