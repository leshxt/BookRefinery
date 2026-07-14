import type { ConversionProgress, ConversionResult, ConversionSummary } from '../core/convert'
import { SECURITY_POLICY } from '../core/policy'
import type { SecurityErrorCode } from '../core/errors'
import type { WorkerRequest, WorkerResponse } from './protocol'

export class WorkerConversionError extends Error {
  readonly code: SecurityErrorCode

  constructor(code: SecurityErrorCode, message: string) {
    super(message)
    this.name = 'WorkerConversionError'
    this.code = code
  }
}

function isSummary(value: unknown): value is ConversionSummary {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['title'] === 'string' &&
    typeof candidate['chapters'] === 'number' &&
    typeof candidate['assets'] === 'number' &&
    typeof candidate['inputBytes'] === 'number' &&
    typeof candidate['uncompressedBytes'] === 'number' &&
    typeof candidate['outputBytes'] === 'number' &&
    Array.isArray(candidate['warnings']) &&
    candidate['warnings'].every((warning) => typeof warning === 'string')
  )
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>

  if (candidate['type'] === 'progress') {
    const progress = candidate['progress']
    return (
      typeof progress === 'object' &&
      progress !== null &&
      typeof (progress as Record<string, unknown>)['percent'] === 'number' &&
      typeof (progress as Record<string, unknown>)['label'] === 'string'
    )
  }
  if (candidate['type'] === 'success') {
    return (
      candidate['archive'] instanceof ArrayBuffer &&
      typeof candidate['filename'] === 'string' &&
      typeof candidate['preview'] === 'string' &&
      isSummary(candidate['summary'])
    )
  }
  return candidate['type'] === 'error' && typeof candidate['code'] === 'string' && typeof candidate['message'] === 'string'
}

export async function runConversion(
  file: File,
  onProgress: (progress: ConversionProgress) => void,
  signal: AbortSignal,
): Promise<ConversionResult> {
  const inputBuffer = await file.arrayBuffer()

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./epub.worker.ts', import.meta.url), {
      type: 'module',
      name: 'epub-safe-converter',
    })
    let settled = false

    const cleanup = (): void => {
      settled = true
      globalThis.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }

    const abort = (): void => {
      if (settled) return
      cleanup()
      reject(new DOMException('Konvertierung abgebrochen.', 'AbortError'))
    }

    const timeout = globalThis.setTimeout(() => {
      if (settled) return
      cleanup()
      reject(new WorkerConversionError('LIMIT_EXCEEDED', 'Die Sicherheits-Zeitgrenze von 20 Sekunden wurde erreicht.'))
    }, SECURITY_POLICY.workerTimeoutMs)

    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => {
      if (settled) return
      cleanup()
      reject(new WorkerConversionError('CONVERSION_FAILED', 'Der isolierte Konvertierungsprozess ist abgestürzt.'))
    }
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return
      if (!isWorkerResponse(event.data)) {
        cleanup()
        reject(new WorkerConversionError('CONVERSION_FAILED', 'Der Konvertierungsprozess lieferte ungültige Daten.'))
        return
      }

      const response = event.data
      if (response.type === 'progress') {
        onProgress(response.progress)
        return
      }
      if (response.type === 'error') {
        cleanup()
        reject(new WorkerConversionError(response.code, response.message))
        return
      }

      cleanup()
      resolve({
        archive: new Uint8Array(response.archive),
        filename: response.filename,
        summary: response.summary,
        preview: response.preview,
      })
    }

    const request: WorkerRequest = { type: 'convert', filename: file.name, buffer: inputBuffer }
    worker.postMessage(request, [inputBuffer])
  })
}
