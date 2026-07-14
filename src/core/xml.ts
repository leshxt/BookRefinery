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

export function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new SecurityError('INVALID_DOCUMENT', `${label} is not valid UTF-8.`)
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
