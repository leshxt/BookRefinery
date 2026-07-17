import Tesseract from 'tesseract.js'
import type { OcrLanguage } from './contracts'

type OcrWorker = Awaited<ReturnType<typeof Tesseract.createWorker>>

export interface OcrProgress {
  readonly status: string
  readonly progress: number
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

  async recognize(image: Blob | OffscreenCanvas): Promise<string> {
    const result = await this.#worker.recognize(image, { rotateAuto: true })
    return result.data.text
      .normalize('NFKC')
      .replace(/\r\n?/gu, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
      .replace(/[ \t]+\n/gu, '\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim()
  }

  async terminate(): Promise<void> {
    await this.#worker.terminate()
  }
}
