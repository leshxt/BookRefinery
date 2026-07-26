import Tesseract from 'tesseract.js'
import type { OcrLanguage } from './contracts'

type OcrWorker = Awaited<ReturnType<typeof Tesseract.createWorker>>

export interface OcrProgress {
  readonly status: string
  readonly progress: number
}

export interface OcrTextRun {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface OcrRecognition {
  readonly text: string
  readonly runs: readonly OcrTextRun[]
}

function normalizedOcrText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export class LocalOcrSession {
  readonly #worker: OcrWorker

  private constructor(worker: OcrWorker) {
    this.#worker = worker
  }

  static async create(
    languages: readonly OcrLanguage[],
    onProgress: (progress: OcrProgress) => void,
  ): Promise<LocalOcrSession> {
    const baseUrl = new URL(import.meta.env.BASE_URL, globalThis.location.href)
    const workerPath = new URL('ocr/worker.min.js', baseUrl).toString()
    const corePath = new URL('ocr/core', baseUrl).toString().replace(/\/$/u, '')
    const langPath = new URL('ocr/lang', baseUrl).toString().replace(/\/$/u, '')
    const worker = await Tesseract.createWorker([...languages], Tesseract.OEM.LSTM_ONLY, {
      workerPath,
      corePath,
      langPath,
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'write',
      legacyCore: false,
      legacyLang: false,
      logger: (message) => onProgress({
        status: message.status,
        progress: message.progress,
      }),
    }, {
      load_system_dawg: '1',
      load_freq_dawg: '1',
      load_unambig_dawg: '1',
      load_punc_dawg: '1',
      load_number_dawg: '1',
      load_bigram_dawg: '1',
    })
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '220',
    })
    return new LocalOcrSession(worker)
  }

  async recognize(image: Blob | OffscreenCanvas): Promise<OcrRecognition> {
    const result = await this.#worker.recognize(
      image,
      { rotateAuto: false },
      { text: true, blocks: true },
    )
    const runs = (result.data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.flatMap((line) =>
          line.words.flatMap((word) => {
            const text = normalizedOcrText(word.text)
            const width = word.bbox.x1 - word.bbox.x0
            const height = word.bbox.y1 - word.bbox.y0
            return text && width > 0 && height > 0
              ? [{
                  text,
                  x: word.bbox.x0,
                  y: word.bbox.y0,
                  width,
                  height,
                }]
              : []
          }))))
    return {
      text: normalizedOcrText(result.data.text),
      runs,
    }
  }

  async terminate(): Promise<void> {
    await this.#worker.terminate()
  }
}
