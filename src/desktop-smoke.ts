import { LocalOcrSession } from './core/ocr'
import { convertPdf } from './core/pdf'
import { unzipSync } from 'fflate'
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface DesktopSmokeResult {
  readonly ocrInitialized: boolean
  readonly recognizedText: string
}

export async function runDesktopSmokeTest(): Promise<DesktopSmokeResult> {
  const canvas = new OffscreenCanvas(900, 220)
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Desktop smoke-test canvas is unavailable.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#000000'
  context.font = '700 72px sans-serif'
  context.fillText('LOCAL OCR TEST 123', 45, 140)

  const session = await LocalOcrSession.create(['eng'], () => {})
  try {
    const recognizedText = await session.recognize(canvas)
    return {
      ocrInitialized: /(?:LOCAL|OCR|TEST|123)/iu.test(recognizedText),
      recognizedText: recognizedText.slice(0, 120),
    }
  } finally {
    await session.terminate()
    canvas.width = 0
    canvas.height = 0
  }
}

export async function runDesktopPdfSmokeTest(): Promise<{
  readonly pdfRendered: boolean
  readonly repairedTextPages: number
  readonly repairedGlyphs: number
  readonly markdownSample: string
}> {
  const response = await fetch('bookrefinery://app/__smoke__/source.pdf')
  if (!response.ok) throw new Error('Desktop PDF smoke-test source is unavailable.')
  const result = await convertPdf(
    new Uint8Array(await response.arrayBuffer()),
    'invincible-company-smoke.pdf',
    () => {},
    {
      profile: 'notebooklm',
      ocr: { enabled: false, languages: ['eng', 'deu'] },
    },
  )
  const files = unzipSync(result.archive)
  const sanitizedPdf = files['notebooklm/document.sanitized.pdf']
  const markdown = files['notebooklm/document.md']
  if (!sanitizedPdf || !markdown) throw new Error('Desktop PDF smoke-test output is incomplete.')

  const [pdfSave, markdownSave] = await Promise.all([
    fetch('bookrefinery://app/__smoke__/output.pdf', {
      method: 'PUT',
      body: new Blob([sanitizedPdf], { type: 'application/pdf' }),
    }),
    fetch('bookrefinery://app/__smoke__/output.md', {
      method: 'PUT',
      body: new Blob([markdown], { type: 'text/markdown' }),
    }),
  ])
  if (!pdfSave.ok || !markdownSave.ok) throw new Error('Desktop PDF smoke-test output could not be saved.')

  return {
    pdfRendered: sanitizedPdf.byteLength > 1_000,
    repairedTextPages: result.summary.repairedTextPages ?? 0,
    repairedGlyphs: result.summary.repairedGlyphs ?? 0,
    markdownSample: new TextDecoder().decode(markdown).slice(0, 5_000),
  }
}
