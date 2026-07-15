import { PDFDocument } from 'pdf-lib'

const FIXED_DATE = new Date('2026-01-01T00:00:00Z')

export interface VisualPdfMetadata {
  readonly title: string
  readonly author?: string
}

export class VisualPdfBuilder {
  readonly #document: PDFDocument

  private constructor(document: PDFDocument) {
    this.#document = document
  }

  static async create(metadata: VisualPdfMetadata): Promise<VisualPdfBuilder> {
    const document = await PDFDocument.create({ updateMetadata: false })
    document.setTitle(metadata.title, { showInWindowTitleBar: true })
    if (metadata.author) document.setAuthor(metadata.author)
    document.setCreator('Book2Markdown')
    document.setProducer('Book2Markdown passive visual PDF builder')
    document.setCreationDate(FIXED_DATE)
    document.setModificationDate(FIXED_DATE)
    return new VisualPdfBuilder(document)
  }

  async addJpegPage(jpeg: Uint8Array, widthPoints: number, heightPoints: number): Promise<void> {
    if (!(widthPoints > 0) || !(heightPoints > 0)) throw new Error('Visual PDF page dimensions must be positive.')
    const image = await this.#document.embedJpg(jpeg)
    const page = this.#document.addPage([widthPoints, heightPoints])
    page.drawImage(image, { x: 0, y: 0, width: widthPoints, height: heightPoints })
  }

  async save(): Promise<Uint8Array> {
    return this.#document.save({ addDefaultPage: false, useObjectStreams: true })
  }
}
