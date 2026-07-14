import { SecurityError } from './errors'
import { SECURITY_POLICY } from './policy'

const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i
const WINDOWS_DRIVE = /^[a-z]:/i

function validateSegments(path: string): void {
  if (path.length > SECURITY_POLICY.maxPathLength) {
    throw new SecurityError('UNSAFE_ARCHIVE', 'An archive path is unusually long.')
  }

  for (const segment of path.split('/')) {
    if (segment.length > SECURITY_POLICY.maxPathSegmentLength) {
      throw new SecurityError('UNSAFE_ARCHIVE', 'An archive path contains an unusually long segment.')
    }
  }
}

export function validateArchiveEntryName(input: string): string {
  if (!input || input.includes('\0') || input.includes('\\')) {
    throw new SecurityError('UNSAFE_ARCHIVE', 'The archive contains an unsafe file path.')
  }

  if (input.startsWith('/') || input.startsWith('//') || WINDOWS_DRIVE.test(input)) {
    throw new SecurityError('UNSAFE_ARCHIVE', 'Absolute file paths are not allowed in EPUB files.')
  }

  const withoutTrailingSlash = input.endsWith('/') ? input.slice(0, -1) : input
  const segments = withoutTrailingSlash.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new SecurityError('UNSAFE_ARCHIVE', 'The archive attempts to escape a directory boundary.')
  }

  const normalized = withoutTrailingSlash.normalize('NFC')
  validateSegments(normalized)
  return normalized
}

export function archiveDirname(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash === -1 ? '' : path.slice(0, lastSlash)
}

export function resolveArchiveReference(baseDirectory: string, reference: string): string {
  const pathOnly = reference.split(/[?#]/u, 1)[0] ?? ''
  let decoded: string

  try {
    decoded = decodeURIComponent(pathOnly)
  } catch {
    throw new SecurityError('UNSAFE_ARCHIVE', 'The EPUB contains an invalid encoded reference.')
  }

  if (
    !decoded ||
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    WINDOWS_DRIVE.test(decoded) ||
    URI_SCHEME.test(decoded)
  ) {
    throw new SecurityError('UNSAFE_ARCHIVE', 'The EPUB contains an external or unsafe reference.')
  }

  const output = baseDirectory ? baseDirectory.split('/') : []
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (output.length === 0) {
        throw new SecurityError('UNSAFE_ARCHIVE', 'An EPUB reference escapes the archive.')
      }
      output.pop()
      continue
    }
    output.push(segment)
  }

  const resolved = output.join('/').normalize('NFC')
  validateSegments(resolved)
  return resolved
}

export function safeOutputName(input: string, fallback: string): string {
  const normalized = input
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .trim()
    .slice(0, 90)

  return normalized || fallback
}
