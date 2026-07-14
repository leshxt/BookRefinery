import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import { SecurityError } from './errors'
import { SECURITY_POLICY } from './policy'
import { assertNoUnsafeXmlMarkup, decodeUtf8, isRecord } from './xml'

type ImageReferenceResolver = (reference: string) => string | null

export interface SanitizedSvg {
  readonly content: Uint8Array
  readonly warnings: readonly string[]
}

const ELEMENT_NAMES = new Map<string, string>([
  'svg', 'g', 'defs', 'desc', 'title', 'symbol', 'use', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath', 'image',
  'lineargradient', 'radialgradient', 'stop', 'pattern',
  'clippath', 'mask', 'marker', 'view', 'a',
].map((name) => [name, name] as const))

ELEMENT_NAMES.set('textpath', 'textPath')
ELEMENT_NAMES.set('lineargradient', 'linearGradient')
ELEMENT_NAMES.set('radialgradient', 'radialGradient')
ELEMENT_NAMES.set('clippath', 'clipPath')

const ATTRIBUTE_NAMES = new Map<string, string>([
  'id', 'class', 'role', 'version', 'xmlns',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'd', 'points', 'pathlength', 'transform', 'viewbox',
  'preserveaspectratio', 'rotate', 'textlength', 'lengthadjust',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'opacity', 'color', 'clip-rule', 'display', 'visibility',
  'vector-effect', 'shape-rendering', 'text-rendering', 'font-family', 'font-size',
  'font-style', 'font-weight', 'text-anchor', 'dominant-baseline',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'offset', 'stop-color',
  'stop-opacity', 'patternunits', 'patterncontentunits', 'patterntransform',
  'maskunits', 'maskcontentunits', 'markerunits', 'markerwidth', 'markerheight',
  'refx', 'refy', 'orient', 'style', 'href', 'xlink:href',
].map((name) => [name, name] as const))

ATTRIBUTE_NAMES.set('pathlength', 'pathLength')
ATTRIBUTE_NAMES.set('viewbox', 'viewBox')
ATTRIBUTE_NAMES.set('preserveaspectratio', 'preserveAspectRatio')
ATTRIBUTE_NAMES.set('textlength', 'textLength')
ATTRIBUTE_NAMES.set('lengthadjust', 'lengthAdjust')
ATTRIBUTE_NAMES.set('gradientunits', 'gradientUnits')
ATTRIBUTE_NAMES.set('gradienttransform', 'gradientTransform')
ATTRIBUTE_NAMES.set('spreadmethod', 'spreadMethod')
ATTRIBUTE_NAMES.set('patternunits', 'patternUnits')
ATTRIBUTE_NAMES.set('patterncontentunits', 'patternContentUnits')
ATTRIBUTE_NAMES.set('patterntransform', 'patternTransform')
ATTRIBUTE_NAMES.set('maskunits', 'maskUnits')
ATTRIBUTE_NAMES.set('maskcontentunits', 'maskContentUnits')
ATTRIBUTE_NAMES.set('markerunits', 'markerUnits')
ATTRIBUTE_NAMES.set('markerwidth', 'markerWidth')
ATTRIBUTE_NAMES.set('markerheight', 'markerHeight')
ATTRIBUTE_NAMES.set('refx', 'refX')
ATTRIBUTE_NAMES.set('refy', 'refY')

const STYLE_PROPERTIES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'opacity', 'color', 'clip-rule', 'display', 'visibility',
  'vector-effect', 'shape-rendering', 'text-rendering', 'font-family', 'font-size',
  'font-style', 'font-weight', 'text-anchor', 'dominant-baseline', 'stop-color', 'stop-opacity',
])

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
})

const builder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: false,
})

function safeFragment(value: string): boolean {
  return /^#[^\s"'<>\\]{1,256}$/u.test(value)
}

function safeValue(value: string): string | null {
  if (
    value.length > 1_000_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/u.test(value) ||
    /(?:javascript|vbscript|data|file|https?|ftp)\s*:/iu.test(value) ||
    /(?:@import|expression\s*\()/iu.test(value) ||
    value.includes('\\')
  ) return null

  const urlFunctions = [...value.matchAll(/url\(([^)]*)\)/giu)]
  if (urlFunctions.some((match) => !safeFragment((match[1] ?? '').trim().replace(/^['"]|['"]$/gu, '')))) {
    return null
  }
  return value
}

function sanitizeStyle(value: string): string | null {
  const declarations: string[] = []
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator < 1) continue
    const property = declaration.slice(0, separator).trim().toLocaleLowerCase('en-US')
    const candidate = declaration.slice(separator + 1).trim()
    const sanitized = STYLE_PROPERTIES.has(property) ? safeValue(candidate) : null
    if (sanitized) declarations.push(`${property}: ${sanitized}`)
  }
  return declarations.length ? declarations.join('; ') : null
}

function textNode(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
  return text ? { '#text': text } : null
}

export function sanitizeSvg(
  bytes: Uint8Array,
  label: string,
  resolveImageReference: ImageReferenceResolver,
): SanitizedSvg {
  if (bytes.byteLength > SECURITY_POLICY.maxSvgBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', `${label} exceeds the 5 MB SVG limit.`)
  }

  const source = decodeUtf8(bytes, label)
  assertNoUnsafeXmlMarkup(source, label)

  let parsed: unknown
  try {
    parsed = parser.parse(source)
  } catch {
    throw new SecurityError('INVALID_DOCUMENT', `${label} is not valid SVG XML.`)
  }
  if (!Array.isArray(parsed)) {
    throw new SecurityError('INVALID_DOCUMENT', `${label} has no SVG document root.`)
  }

  const warnings: string[] = []
  let nodeCount = 0
  const warn = (message: string): void => {
    if (!warnings.includes(message) && warnings.length < 100) warnings.push(message)
  }

  const sanitizeNodes = (nodes: readonly unknown[], depth: number): Record<string, unknown>[] => {
    if (depth > 100) throw new SecurityError('LIMIT_EXCEEDED', `${label} exceeds the SVG nesting limit.`)
    const output: Record<string, unknown>[] = []

    for (const candidate of nodes) {
      nodeCount += 1
      if (nodeCount > 50_000) throw new SecurityError('LIMIT_EXCEEDED', `${label} contains too many SVG nodes.`)
      if (!isRecord(candidate)) continue

      if ('#text' in candidate) {
        const sanitizedText = textNode(candidate['#text'])
        if (sanitizedText) output.push(sanitizedText)
        continue
      }

      const rawName = Object.keys(candidate).find((key) => key !== ':@')
      if (!rawName || rawName.startsWith('#') || rawName.startsWith('?') || rawName.startsWith('!')) continue
      const canonicalName = ELEMENT_NAMES.get(rawName.toLocaleLowerCase('en-US'))
      if (!canonicalName) {
        warn(`Removed unsupported or active SVG element <${rawName.slice(0, 40)}>.`)
        continue
      }

      const rawAttributes = isRecord(candidate[':@']) ? candidate[':@'] : {}
      const attributes: Record<string, string> = {}
      let safeImageReference = false

      for (const [prefixedName, rawValue] of Object.entries(rawAttributes)) {
        if (typeof rawValue !== 'string' || !prefixedName.startsWith('@_')) continue
        const originalName = prefixedName.slice(2)
        const lowerName = originalName.toLocaleLowerCase('en-US')
        if (lowerName.startsWith('on')) {
          warn('Removed SVG event-handler attributes.')
          continue
        }
        if (lowerName.startsWith('aria-')) {
          const sanitized = safeValue(rawValue)
          if (sanitized) attributes[originalName] = sanitized.slice(0, 500)
          continue
        }

        const canonicalAttribute = ATTRIBUTE_NAMES.get(lowerName)
        if (!canonicalAttribute) continue
        if (canonicalAttribute === 'xmlns') continue
        if (canonicalAttribute === 'style') {
          const sanitized = sanitizeStyle(rawValue)
          if (sanitized) attributes['style'] = sanitized
          else if (rawValue.trim()) warn('Removed unsafe or unsupported SVG styles.')
          continue
        }
        if (canonicalAttribute === 'href' || canonicalAttribute === 'xlink:href') {
          const reference = rawValue.trim()
          if (canonicalName === 'image') {
            const resolved = resolveImageReference(reference)
            if (resolved) {
              attributes['href'] = resolved
              safeImageReference = true
            } else {
              warn('Removed an SVG image with an external, embedded, missing, or unsafe source.')
            }
          } else if (safeFragment(reference)) {
            attributes['href'] = reference
          } else if (reference) {
            warn('Removed an external or unsafe SVG reference.')
          }
          continue
        }

        const sanitized = safeValue(rawValue)
        if (sanitized !== null) attributes[canonicalAttribute] = sanitized
        else warn('Removed unsafe SVG attribute values.')
      }

      if (canonicalName === 'image' && !safeImageReference) continue
      const rawChildren = candidate[rawName]
      const children = Array.isArray(rawChildren) ? sanitizeNodes(rawChildren, depth + 1) : []
      const node: Record<string, unknown> = { [canonicalName]: children }
      const finalAttributes = canonicalName === 'svg'
        ? { ...attributes, xmlns: 'http://www.w3.org/2000/svg' }
        : attributes
      if (Object.keys(finalAttributes).length) {
        node[':@'] = Object.fromEntries(Object.entries(finalAttributes).map(([name, value]) => [`@_${name}`, value]))
      }
      output.push(node)
    }
    return output
  }

  const sanitized = sanitizeNodes(parsed, 0)
  const root = sanitized.find((node) => 'svg' in node)
  if (!root) throw new SecurityError('INVALID_DOCUMENT', `${label} has no supported SVG root element.`)

  const serialized = builder.build([root])
  const content = new TextEncoder().encode(serialized)
  if (content.byteLength > SECURITY_POLICY.maxSvgBytes) {
    throw new SecurityError('LIMIT_EXCEEDED', `${label} exceeds the sanitized SVG output limit.`)
  }
  return { content, warnings }
}
