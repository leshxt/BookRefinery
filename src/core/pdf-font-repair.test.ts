import { describe, expect, it } from 'vitest'
import {
  fontCharacterRepairs,
  glyphNameToUnicode,
  repairPdfTextItems,
} from './pdf-font-repair'

describe('embedded PDF font repair', () => {
  it('decodes stylistic glyph names without guessing unknown names', () => {
    expect(glyphNameToUnicode('y.alt1')).toBe('y')
    expect(glyphNameToUnicode('C.titl')).toBe('C')
    expect(glyphNameToUnicode('one.lin')).toBe('1')
    expect(glyphNameToUnicode('eacute.alt1')).toBe('é')
    expect(glyphNameToUnicode('uni2197')).toBe('↗')
    expect(glyphNameToUnicode('madeUpGlyph')).toBeNull()
  })

  it('builds character repairs from a sparse PDF differences table', () => {
    const differences: unknown[] = []
    differences[33] = 'y.alt1'
    differences[34] = 'l.alt1'
    differences[35] = 'a.alt1'
    differences[36] = 'J.alt1'
    differences[37] = 'one.alt1'

    expect([...fontCharacterRepairs({ differences })]).toEqual([
      ['!', 'y'],
      ['"', 'l'],
      ['#', 'a'],
      ['$', 'J'],
      ['%', '1'],
    ])
  })

  it('repairs only text items that use the affected embedded font', () => {
    const differences: unknown[] = []
    differences[33] = 'y.alt1'
    differences[34] = 'l.alt1'
    const result = repairPdfTextItems([
      { str: 'Cop', fontName: 'regular', transform: [1, 0, 0, 1, 0, 0] },
      { str: '!', fontName: 'alternate', transform: [1, 0, 0, 1, 0, 0] },
      { str: ' right b', fontName: 'regular', transform: [1, 0, 0, 1, 0, 0] },
      { str: '!"', fontName: 'alternate', transform: [1, 0, 0, 1, 0, 0] },
    ], (fontName) => fontName === 'alternate' ? { differences } : {})

    expect(result.items.map((item) =>
      typeof item === 'object' && item !== null && 'str' in item ? item.str : '')).toEqual([
      'Cop',
      'y',
      ' right b',
      'yl',
    ])
    expect(result.repairedFonts).toBe(1)
    expect(result.repairedGlyphs).toBe(3)
  })
})
