import { XMLParser } from 'fast-xml-parser'
import { SecurityError } from './errors'
import { SECURITY_POLICY } from './policy'

const DOCTYPE_DECLARATION = /<!\s*DOCTYPE\b/iu
const ENTITY_DECLARATION = /<!\s*ENTITY\b/iu
const SIMPLE_HTML_DOCTYPE = /<!\s*DOCTYPE\s+html\s*>/giu

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
    throw new SecurityError('INVALID_EPUB', `${label} ist nicht gültig UTF-8-codiert.`)
  }
}

export function parseXmlSecure(bytes: Uint8Array, label: string): unknown {
  if (bytes.byteLength > SECURITY_POLICY.maxXmlBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', `${label} überschreitet das XML-Größenlimit.`)
  }

  const xml = decodeUtf8(bytes, label)
  assertNoUnsafeXmlMarkup(xml, label)

  try {
    const parsed: unknown = parser.parse(xml)
    return parsed
  } catch {
    throw new SecurityError('INVALID_EPUB', `${label} enthält ungültiges XML.`)
  }
}

export function assertNoUnsafeXmlMarkup(xml: string, label: string, allowSimpleHtmlDoctype = false): void {
  const inspected = allowSimpleHtmlDoctype ? xml.replace(SIMPLE_HTML_DOCTYPE, '') : xml
  if (DOCTYPE_DECLARATION.test(inspected) || ENTITY_DECLARATION.test(inspected)) {
    throw new SecurityError('UNSAFE_XML', `${label} enthält eine verbotene DTD- oder Entity-Deklaration.`)
  }
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
