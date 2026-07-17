interface FontRepairResult {
  readonly items: readonly unknown[]
  readonly repairedFonts: number
  readonly repairedGlyphs: number
}

const NAMED_GLYPHS: Readonly<Record<string, string>> = {
  Euro: '€',
  H22073: '□',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  emdash: '—',
  endash: '–',
  eacute: 'é',
  eight: '8',
  eightinferior: '₈',
  eightsuperior: '⁸',
  five: '5',
  fiveinferior: '₅',
  fivesuperior: '⁵',
  four: '4',
  fourinferior: '₄',
  foursuperior: '⁴',
  hyphen: '-',
  lalt: 'l',
  minus: '−',
  multiply: '×',
  nine: '9',
  nineinferior: '₉',
  ninesuperior: '⁹',
  one: '1',
  oneinferior: '₁',
  onequarter: '¼',
  onesuperior: '¹',
  parenleft: '(',
  parenright: ')',
  periodcentered: '·',
  plus: '+',
  quotedblleft: '“',
  quotedblright: '”',
  quoteleft: '‘',
  quoteright: '’',
  radical: '√',
  seven: '7',
  seveninferior: '₇',
  sevensuperior: '⁷',
  six: '6',
  sixinferior: '₆',
  sixsuperior: '⁶',
  slash: '/',
  space: ' ',
  three: '3',
  threeinferior: '₃',
  threequarters: '¾',
  threesuperior: '³',
  two: '2',
  twoinferior: '₂',
  twosuperior: '²',
  uacute: 'ú',
  zero: '0',
  zeroinferior: '₀',
  zerosuperior: '⁰',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function removeStylisticSuffixes(glyphName: string): string {
  let result = glyphName
  while (/\.(?:alt\d*|lin|sc|titl)$/u.test(result)) {
    result = result.replace(/\.(?:alt\d*|lin|sc|titl)$/u, '')
  }
  return result
}

/**
 * Resolve the conservative subset of Adobe glyph names that occurs in broken
 * embedded PDF font maps. Unknown names stay unknown instead of being guessed.
 */
export function glyphNameToUnicode(glyphName: string): string | null {
  const normalized = removeStylisticSuffixes(glyphName)
  const named = NAMED_GLYPHS[normalized]
  if (named !== undefined) return named
  if (/^[A-Za-z]$/u.test(normalized)) return normalized

  const unicodeMatch = /^(?:uni|u)([0-9A-Fa-f]{4,6})$/u.exec(normalized)
  if (!unicodeMatch?.[1]) return null
  const codePoint = Number.parseInt(unicodeMatch[1], 16)
  if (
    !Number.isFinite(codePoint) ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return null
  }
  return String.fromCodePoint(codePoint)
}

export function fontCharacterRepairs(font: unknown): ReadonlyMap<string, string> {
  if (!isRecord(font) || !Array.isArray(font['differences'])) return new Map()
  const repairs = new Map<string, string>()
  for (const [characterCode, glyph] of font['differences'].entries()) {
    if (typeof glyph !== 'string' || characterCode > 0xffff) continue
    const replacement = glyphNameToUnicode(glyph)
    const source = String.fromCharCode(characterCode)
    if (replacement !== null && replacement !== source) repairs.set(source, replacement)
  }
  return repairs
}

export function repairPdfTextItems(
  items: readonly unknown[],
  fontForName: (fontName: string) => unknown,
): FontRepairResult {
  const repairByFont = new Map<string, ReadonlyMap<string, string>>()
  let repairedGlyphs = 0
  const repairedFontNames = new Set<string>()

  const repairedItems = items.map((item): unknown => {
    if (
      !isRecord(item) ||
      typeof item['str'] !== 'string' ||
      typeof item['fontName'] !== 'string'
    ) {
      return item
    }

    const fontName = item['fontName']
    let repairs = repairByFont.get(fontName)
    if (!repairs) {
      repairs = fontCharacterRepairs(fontForName(fontName))
      repairByFont.set(fontName, repairs)
    }
    if (repairs.size === 0) return item

    let changed = false
    const repairedText = [...item['str']].map((character) => {
      const replacement = repairs.get(character)
      if (replacement === undefined) return character
      changed = true
      repairedGlyphs += 1
      return replacement
    }).join('')

    if (!changed) return item
    repairedFontNames.add(fontName)
    return { ...item, str: repairedText, __bookRefineryRepairedGlyphs: true }
  })

  return {
    items: repairedItems,
    repairedFonts: repairedFontNames.size,
    repairedGlyphs,
  }
}
