import { isRecord } from './xml'

interface PageToken {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly leadingSpace: boolean
  readonly trailingSpace: boolean
  readonly repairedGlyphs: boolean
}

interface PageLine {
  readonly text: string
  readonly x: number
  readonly endX: number
  readonly y: number
  readonly height: number
}

export interface StructuredPageText {
  readonly plain: string
  readonly markdown: string
  readonly lineCount: number
  readonly columnCount: 1 | 2
  readonly headingCount: number
}

function safePlainText(value: string, maxLength = 20_000): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength)
}

function safeMarkdownText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\b(?:https?|ftp):\/\/[^\s<>)\]]+/giu, '[external URL removed]')
    .replace(/\b(?:javascript|vbscript|data|file):[^\s<>)\]]*/giu, '[unsafe URL removed]')
    .replace(/\\/gu, '\\\\')
    .replace(/([`*_[\]{}])/gu, '\\$1')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/^(\s*)(#{1,6}|>|[-+])\s/gmu, '$1\\$2 ')
    .trim()
}

function numberAt(value: unknown, index: number): number | null {
  if (!Array.isArray(value)) return null
  const candidate: unknown = value[index]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function addToken(line: string, token: string): string {
  if (!line) return token
  if (/^[,.;:!?%)}\]]/u.test(token) || /[(\[{„“'/-]$/u.test(line)) return `${line}${token}`
  return `${line} ${token}`
}

function toTokens(items: readonly unknown[]): PageToken[] {
  const tokens: PageToken[] = []
  for (const item of items) {
    if (!isRecord(item) || typeof item['str'] !== 'string') continue
    const sourceText = item['str']
    const text = safePlainText(sourceText)
    if (!text) continue
    const x = numberAt(item['transform'], 4) ?? 0
    const y = numberAt(item['transform'], 5) ?? 0
    const rawHeight = item['height']
    const rawWidth = item['width']
    const height = typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0
      ? rawHeight
      : 12
    const width = typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth >= 0
      ? rawWidth
      : text.length * height * 0.48
    tokens.push({
      text,
      x,
      y,
      width,
      height,
      leadingSpace: /^\s/u.test(sourceText),
      trailingSpace: /\s$/u.test(sourceText),
      repairedGlyphs: item['__bookRefineryRepairedGlyphs'] === true,
    })
  }
  return tokens
}

function groupLines(tokens: readonly PageToken[]): PageLine[] {
  const sorted = [...tokens].sort((left, right) =>
    Math.abs(right.y - left.y) > Math.max(left.height, right.height) * 0.45
      ? right.y - left.y
      : left.x - right.x)
  const groups: PageToken[][] = []

  for (const token of sorted) {
    const current = groups.at(-1)
    const anchor = current?.[0]
    if (!current || !anchor || Math.abs(anchor.y - token.y) > Math.max(anchor.height, token.height) * 0.55) {
      groups.push([token])
    } else {
      current.push(token)
    }
  }

  return groups.flatMap((group) => {
    const ordered = [...group].sort((left, right) => left.x - right.x)
    const segments: PageToken[][] = []
    for (const token of ordered) {
      const segment = segments.at(-1)
      const previous = segment?.at(-1)
      const gap = previous ? token.x - (previous.x + previous.width) : 0
      if (!segment || !previous || gap > Math.max(72, previous.height * 6, token.height * 6)) {
        segments.push([token])
      } else {
        segment.push(token)
      }
    }
    return segments.map((segment) => ({
      text: segment.reduce((line, token, index) => {
        const previous = segment[index - 1]
        if (!previous) return token.text
        const gap = token.x - (previous.x + previous.width)
        const touchTolerance = Math.max(1.5, Math.min(previous.height, token.height) * 0.16)
        const touchesPreviousGlyph = (
          (previous.repairedGlyphs || token.repairedGlyphs) &&
          !previous.trailingSpace &&
          !token.leadingSpace &&
          gap >= -touchTolerance &&
          gap <= touchTolerance
        )
        return touchesPreviousGlyph ? `${line}${token.text}` : addToken(line, token.text)
      }, ''),
      x: Math.min(...segment.map((token) => token.x)),
      endX: Math.max(...segment.map((token) => token.x + token.width)),
      y: segment.reduce((sum, token) => sum + token.y, 0) / segment.length,
      height: Math.max(...segment.map((token) => token.height)),
    }))
  })
}

function readingOrder(lines: readonly PageLine[], pageWidth: number): {
  readonly lines: readonly PageLine[]
  readonly columns: 1 | 2
} {
  if (!(pageWidth > 0) || lines.length < 8) return { lines, columns: 1 }
  const center = pageWidth / 2
  const left = lines.filter((line) => line.endX < center * 1.12)
  const right = lines.filter((line) => line.x > center * 0.88)
  const spanning = lines.filter((line) => !left.includes(line) && !right.includes(line))
  if (left.length < 3 || right.length < 3 || spanning.length > lines.length * 0.45) {
    return { lines, columns: 1 }
  }

  const highestColumnY = Math.max(...left.map((line) => line.y), ...right.map((line) => line.y))
  const lowestColumnY = Math.min(...left.map((line) => line.y), ...right.map((line) => line.y))
  const top = spanning.filter((line) => line.y >= highestColumnY).sort((a, b) => b.y - a.y)
  const bottom = spanning.filter((line) => line.y <= lowestColumnY).sort((a, b) => b.y - a.y)
  const middle = spanning
    .filter((line) => line.y < highestColumnY && line.y > lowestColumnY)
    .sort((a, b) => b.y - a.y)
  return {
    lines: [
      ...top,
      ...left.sort((a, b) => b.y - a.y),
      ...middle,
      ...right.sort((a, b) => b.y - a.y),
      ...bottom,
    ],
    columns: 2,
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted[middle]
  return value ?? 12
}

export function extractStructuredPageText(
  items: readonly unknown[],
  pageWidth: number,
): StructuredPageText {
  const grouped = groupLines(toTokens(items))
  const ordered = readingOrder(grouped, pageWidth)
  const bodyHeight = median(ordered.lines.map((line) => line.height))
  const paragraphs: { readonly text: string; readonly heading: boolean }[] = []
  let previous: PageLine | undefined

  for (const line of ordered.lines) {
    const heading =
      line.height >= bodyHeight * 1.42 &&
      line.text.length >= 2 &&
      line.text.length <= 160 &&
      !/[.!?]$/u.test(line.text)
    const gap = previous ? Math.abs(previous.y - line.y) : 0
    const paragraphBreak = Boolean(previous) && gap > Math.max(previous?.height ?? 0, line.height) * 1.72
    const previousParagraph = paragraphs.at(-1)

    if (
      previousParagraph &&
      !paragraphBreak &&
      !heading &&
      !previousParagraph.heading &&
      previousParagraph.text.endsWith('-') &&
      /^\p{Ll}/u.test(line.text)
    ) {
      paragraphs[paragraphs.length - 1] = {
        text: `${previousParagraph.text.slice(0, -1)}${line.text}`,
        heading: false,
      }
    } else {
      if (paragraphBreak) paragraphs.push({ text: '', heading: false })
      paragraphs.push({ text: line.text, heading })
    }
    previous = line
  }

  const plain = paragraphs
    .map((paragraph) => paragraph.text)
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  const markdown = paragraphs
    .map((paragraph) => {
      const text = safeMarkdownText(paragraph.text)
      return paragraph.heading && text ? `### ${text}` : text
    })
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()

  return {
    plain,
    markdown,
    lineCount: ordered.lines.length,
    columnCount: ordered.columns,
    headingCount: paragraphs.filter((paragraph) => paragraph.heading).length,
  }
}
