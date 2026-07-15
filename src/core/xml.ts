import { XMLParser } from 'fast-xml-parser'
import { SecurityError } from './errors'
import { SECURITY_POLICY } from './policy'

const DOCTYPE_DECLARATION = /<!\s*DOCTYPE\b/iu
const ENTITY_DECLARATION = /<!\s*ENTITY\b/iu

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
})

const orderedParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
})

const XML_ENCODINGS = new Map<string, string>([
  ['utf-8', 'utf-8'],
  ['utf8', 'utf-8'],
  ['utf-16', 'utf-16le'],
  ['utf-16le', 'utf-16le'],
  ['utf-16be', 'utf-16be'],
  ['windows-1251', 'windows-1251'],
  ['cp1251', 'windows-1251'],
  ['windows-1252', 'windows-1252'],
  ['cp1252', 'windows-1252'],
  ['iso-8859-1', 'windows-1252'],
])

export function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new SecurityError('INVALID_DOCUMENT', `${label} is not valid UTF-8.`)
  }
}

export function decodeXmlText(bytes: Uint8Array, label: string): string {
  let encoding = 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le'
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be'
  else if (bytes[0] === 0x3c && bytes[1] === 0x00) encoding = 'utf-16le'
  else if (bytes[0] === 0x00 && bytes[1] === 0x3c) encoding = 'utf-16be'
  else {
    const declaration = new TextDecoder('windows-1252').decode(bytes.subarray(0, 512))
    const declared = /<\?xml\s[^>]*\bencoding\s*=\s*["']\s*([^"']+?)\s*["']/iu.exec(declaration)?.[1]
    if (declared) {
      const normalized = XML_ENCODINGS.get(declared.toLocaleLowerCase('en-US'))
      if (!normalized) {
        throw new SecurityError('UNSUPPORTED_DOCUMENT', `${label} declares the unsupported XML encoding "${declared}".`)
      }
      encoding = normalized
    }
  }

  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    throw new SecurityError('INVALID_DOCUMENT', `${label} is not valid ${encoding.toUpperCase()}.`)
  }
}

export function parseXmlSecure(bytes: Uint8Array, label: string): unknown {
  if (bytes.byteLength > SECURITY_POLICY.maxXmlBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', `${label} exceeds the XML size limit.`)
  }

  const xml = decodeUtf8(bytes, label)
  assertNoUnsafeXmlMarkup(xml, label)

  try {
    const parsed: unknown = parser.parse(xml)
    return parsed
  } catch {
    throw new SecurityError('INVALID_DOCUMENT', `${label} contains invalid XML.`)
  }
}

export function parseXmlOrderedSecure(bytes: Uint8Array, label: string, maxBytes: number): unknown {
  if (bytes.byteLength > maxBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', `${label} exceeds the XML size limit.`)
  }

  const xml = decodeXmlText(bytes, label)
  assertNoUnsafeXmlMarkup(xml, label)

  try {
    const parsed: unknown = orderedParser.parse(xml)
    return parsed
  } catch {
    throw new SecurityError('INVALID_DOCUMENT', `${label} contains invalid XML.`)
  }
}

export function assertNoUnsafeXmlMarkup(xml: string, label: string): void {
  if (DOCTYPE_DECLARATION.test(xml) || ENTITY_DECLARATION.test(xml)) {
    throw new SecurityError('UNSAFE_XML', `${label} contains a forbidden DTD or entity declaration.`)
  }
}

export function stripInertDocumentTypes(xml: string, label: string): { readonly text: string; readonly removed: boolean } {
  if (ENTITY_DECLARATION.test(xml)) {
    throw new SecurityError('UNSAFE_XML', `${label} contains a forbidden entity declaration.`)
  }

  let output = ''
  let cursor = 0
  let removed = false

  while (true) {
    const remaining = xml.slice(cursor)
    const match = /<!\s*DOCTYPE\b/iu.exec(remaining)
    if (!match) {
      output += remaining
      break
    }

    const start = cursor + match.index
    output += xml.slice(cursor, start)
    let quote: '"' | "'" | null = null
    let end = -1

    for (let index = start; index < xml.length; index += 1) {
      const character = xml[index]
      if (quote) {
        if (character === quote) quote = null
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
        continue
      }
      if (character === '[') {
        throw new SecurityError('UNSAFE_XML', `${label} contains a forbidden internal DTD subset.`)
      }
      if (character === '>') {
        end = index + 1
        break
      }
    }

    if (end < 0) {
      throw new SecurityError('INVALID_DOCUMENT', `${label} contains an unterminated document type declaration.`)
    }
    removed = true
    cursor = end
  }

  return { text: output, removed }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : [value]
  return values.filter(isRecord)
}

export function readText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!isRecord(value)) return undefined

  const text = value['#text']
  return typeof text === 'string' ? text.trim() || undefined : undefined
}
