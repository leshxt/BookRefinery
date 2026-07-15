import {
  beginText,
  endText,
  PDFHexString,
  PDFDocument,
  PDFString,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFPage,
} from 'pdf-lib'

const FIXED_DATE = new Date('2026-01-01T00:00:00Z')

export interface SearchablePdfMetadata {
  readonly title: string
  readonly author?: string
}

function unicodeHex(character: string): string {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) throw new Error('Searchable PDF text contains an invalid character.')
  if (codePoint <= 0xffff) return codePoint.toString(16).padStart(4, '0').toUpperCase()
  const value = codePoint - 0x10000
  const high = 0xd800 + (value >> 10)
  const low = 0xdc00 + (value & 0x3ff)
  return `${high.toString(16).padStart(4, '0')}${low.toString(16).padStart(4, '0')}`.toUpperCase()
}

function createToUnicodeCMap(characters: readonly string[]): string {
  const mappings = characters.map((character, index) =>
    `<${(index + 1).toString(16).padStart(4, '0')}> <${unicodeHex(character)}>`)
  const sections: string[] = []
  for (let offset = 0; offset < mappings.length; offset += 100) {
    const section = mappings.slice(offset, offset + 100)
    sections.push(`${section.length} beginbfchar\n${section.join('\n')}\nendbfchar`)
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Book2MarkdownSearch def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${sections.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`
}

function addSearchableTextLayer(page: PDFPage, text: string): void {
  if (!text) return
  const cidByCharacter = new Map<string, number>()
  let encodedText = ''
  let characterCount = 0
  for (const character of text) {
    characterCount += 1
    let cid = cidByCharacter.get(character)
    if (cid === undefined) {
      cid = cidByCharacter.size + 1
      if (cid > 0xffff) throw new Error('A PDF page contains too many distinct Unicode characters.')
      cidByCharacter.set(character, cid)
    }
    encodedText += cid.toString(16).padStart(4, '0')
  }

  const context = page.doc.context
  const characters = [...cidByCharacter.keys()]
  const toUnicodeRef = context.register(context.flateStream(createToUnicodeCMap(characters)))
  const fontDescriptorRef = context.register(context.obj({
    Type: 'FontDescriptor',
    FontName: 'Book2MarkdownSearch',
    Flags: 4,
    FontBBox: [0, 0, 1000, 1000],
    ItalicAngle: 0,
    Ascent: 800,
    Descent: -200,
    CapHeight: 700,
    StemV: 80,
  }))
  const cidSystemInfo = context.obj({
    Registry: PDFString.of('Adobe'),
    Ordering: PDFString.of('Identity'),
    Supplement: 0,
  })
  const descendantFontRef = context.register(context.obj({
    Type: 'Font',
    Subtype: 'CIDFontType2',
    BaseFont: 'Book2MarkdownSearch',
    CIDSystemInfo: cidSystemInfo,
    FontDescriptor: fontDescriptorRef,
    DW: 1000,
  }))
  const searchFontRef = context.register(context.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: 'Book2MarkdownSearch',
    Encoding: 'Identity-H',
    DescendantFonts: [descendantFontRef],
    ToUnicode: toUnicodeRef,
  }))
  const fontKey = page.node.newFontDictionary('SearchText', searchFontRef)
  const textScale = Math.min(0.001, page.getWidth() / Math.max(characterCount * 2, 1))
  page.pushOperators(
    beginText(),
    setFontAndSize(fontKey, 1),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setTextMatrix(textScale, 0, 0, textScale, 0, 0),
    showText(PDFHexString.of(encodedText)),
    endText(),
  )
}

export class SearchablePdfBuilder {
  readonly #document: PDFDocument

  private constructor(document: PDFDocument) {
    this.#document = document
  }

  static async create(metadata: SearchablePdfMetadata): Promise<SearchablePdfBuilder> {
    const document = await PDFDocument.create({ updateMetadata: false })
    document.setTitle(metadata.title, { showInWindowTitleBar: true })
    if (metadata.author) document.setAuthor(metadata.author)
    document.setCreator('Book2Markdown')
    document.setProducer('Book2Markdown passive searchable PDF builder')
    document.setCreationDate(FIXED_DATE)
    document.setModificationDate(FIXED_DATE)
    return new SearchablePdfBuilder(document)
  }

  async addJpegPage(
    jpeg: Uint8Array,
    widthPoints: number,
    heightPoints: number,
    searchableText: string,
  ): Promise<void> {
    if (!(widthPoints > 0) || !(heightPoints > 0)) throw new Error('Sanitized PDF page dimensions must be positive.')
    const image = await this.#document.embedJpg(jpeg)
    const page = this.#document.addPage([widthPoints, heightPoints])
    page.drawImage(image, { x: 0, y: 0, width: widthPoints, height: heightPoints })
    addSearchableTextLayer(page, searchableText)
  }

  async save(): Promise<Uint8Array> {
    return this.#document.save({ addDefaultPage: false, useObjectStreams: true })
  }
}
