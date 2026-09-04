import { basename, extname, isAbsolute } from 'node:path'

export const APP_ORIGIN = 'bookrefinery://app'
export const MAX_NATIVE_SAVE_BYTES = (4 * 1024 * 1024 * 1024) - (1024 * 1024)
export const MAX_NATIVE_SOURCE_PATH_CHARS = 32_767
export const MAX_NATIVE_SOURCE_NAME_CHARS = 255

const EXTERNAL_LINKS = new Set([
  'https://github.com/leshxt',
  'https://github.com/leshxt/BookRefinery',
  'https://github.com/leshxt/BookRefinery/releases',
])

export function isAllowedRendererRequest(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return (
      (url.protocol === 'bookrefinery:' && url.hostname === 'app') ||
      rawUrl.startsWith('blob:bookrefinery://app/')
    )
  } catch {
    return false
  }
}

export function isAllowedExternalLink(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && EXTERNAL_LINKS.has(
      `${url.origin}${url.pathname.replace(/\/$/u, '')}`,
    )
  } catch {
    return false
  }
}

export function safeSaveFilename(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 180) return null
  if (basename(value) !== value || extname(value).toLocaleLowerCase('en-US') !== '.zip') return null
  const sanitized = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    .replace(/[ .]+$/gu, '')
  return sanitized && sanitized.toLocaleLowerCase('en-US').endsWith('.zip') ? sanitized : null
}

export function isValidSaveRequest(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    safeSaveFilename(value.suggestedName) !== null &&
    value.mimeType === 'application/zip' &&
    value.data instanceof ArrayBuffer &&
    value.data.byteLength > 0 &&
    value.data.byteLength <= MAX_NATIVE_SAVE_BYTES
  )
}

export function safeSelectedSourcePath(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_NATIVE_SOURCE_PATH_CHARS ||
    value.includes('\0') ||
    !isAbsolute(value)
  ) {
    return null
  }
  return value
}

export function selectedFilenameFromPath(value) {
  const sourcePath = safeSelectedSourcePath(value)
  if (!sourcePath) return null
  const filename = basename(sourcePath).normalize('NFKC')
  if (
    filename.length < 1 ||
    filename.length > MAX_NATIVE_SOURCE_NAME_CHARS ||
    filename === '.' ||
    filename === '..' ||
    /[\\/\u0000-\u001f\u007f]/u.test(filename)
  ) {
    return null
  }
  return filename
}
