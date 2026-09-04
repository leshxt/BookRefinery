import type { ConversionProgress, ConversionResult, ConversionSummary } from '../core/convert'
import type { ConversionOptions, DocumentInspection } from '../core/contracts'
import { conversionResourcePolicy, SECURITY_POLICY } from '../core/policy'
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
    (candidate['format'] === 'epub' || candidate['format'] === 'fb2' || candidate['format'] === 'pdf') &&
    typeof candidate['units'] === 'number' &&
    (candidate['unitLabel'] === 'chapters' || candidate['unitLabel'] === 'pages') &&
    typeof candidate['assets'] === 'number' &&
    typeof candidate['inputBytes'] === 'number' &&
    typeof candidate['processedBytes'] === 'number' &&
    typeof candidate['outputBytes'] === 'number' &&
    (candidate['ocrPages'] === undefined || typeof candidate['ocrPages'] === 'number') &&
    Array.isArray(candidate['warnings']) &&
    candidate['warnings'].every((warning) => typeof warning === 'string')
  )
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>

  if (candidate['type'] === 'inspection-success') {
    const inspection = candidate['inspection']
    if (typeof inspection !== 'object' || inspection === null) return false
    const inspectionCandidate = inspection as Record<string, unknown>
    return (
      (inspectionCandidate['format'] === 'epub' ||
        inspectionCandidate['format'] === 'fb2' ||
        inspectionCandidate['format'] === 'pdf') &&
      typeof inspectionCandidate['title'] === 'string' &&
      typeof inspectionCandidate['units'] === 'number' &&
      (inspectionCandidate['unitLabel'] === 'chapters' || inspectionCandidate['unitLabel'] === 'pages') &&
      typeof inspectionCandidate['graphics'] === 'number' &&
      typeof inspectionCandidate['inputBytes'] === 'number' &&
      typeof inspectionCandidate['processedBytes'] === 'number' &&
      (inspectionCandidate['textCoverage'] === 'full' ||
        inspectionCandidate['textCoverage'] === 'partial' ||
        inspectionCandidate['textCoverage'] === 'none' ||
        inspectionCandidate['textCoverage'] === 'unknown') &&
      typeof inspectionCandidate['ocrRecommended'] === 'boolean' &&
      Array.isArray(inspectionCandidate['warnings']) &&
      inspectionCandidate['warnings'].every((warning) => typeof warning === 'string')
    )
  }
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

function isPdfJsTransportMessage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate['type'] === undefined &&
    typeof candidate['sourceName'] === 'string' &&
    typeof candidate['targetName'] === 'string' &&
    (typeof candidate['action'] === 'string' || typeof candidate['action'] === 'number')
  )
}

export async function runConversion(
  file: File,
  sourceName: string,
  options: ConversionOptions,
  onProgress: (progress: ConversionProgress) => void,
  signal: AbortSignal,
  password?: string,
): Promise<ConversionResult> {
  const inputBuffer = await file.arrayBuffer()

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./converter.worker.ts', import.meta.url), {
      type: 'module',
      name: 'bookrefinery-converter',
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
      reject(new DOMException('Conversion cancelled.', 'AbortError'))
    }

    const timeoutMs = options.resourceMode === 'extended'
      ? conversionResourcePolicy('extended').workerTimeoutMs
      : options.ocr.enabled && sourceName.toLocaleLowerCase('en-US').endsWith('.pdf')
        ? SECURITY_POLICY.ocrWorkerTimeoutMs
        : SECURITY_POLICY.workerTimeoutMs
    const timeout = globalThis.setTimeout(() => {
      if (settled) return
      cleanup()
      reject(new WorkerConversionError(
        'LIMIT_EXCEEDED',
        `The ${Math.round(timeoutMs / 60_000)}-minute safety timeout was reached.`,
      ))
    }, timeoutMs)

    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => {
      if (settled) return
      cleanup()
      reject(new WorkerConversionError('CONVERSION_FAILED', 'The isolated conversion worker crashed.'))
    }
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return
      // PDF.js uses an internal, namespaced message channel while it parses a
      // document. Those transport packets cannot complete or influence a job.
      if (event.data === undefined || isPdfJsTransportMessage(event.data)) return
      if (!isWorkerResponse(event.data)) {
        cleanup()
        reject(new WorkerConversionError('CONVERSION_FAILED', 'The conversion worker returned invalid data.'))
        return
      }

      const response = event.data
      if (response.type === 'progress') {
        onProgress(response.progress)
        return
      }
      if (response.type === 'inspection-success') {
        cleanup()
        reject(new WorkerConversionError('CONVERSION_FAILED', 'The conversion worker returned an inspection result.'))
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

    const request: WorkerRequest = {
      type: 'convert',
      filename: sourceName,
      buffer: inputBuffer,
      options,
      ...(password === undefined ? {} : { password }),
    }
    worker.postMessage(request, [inputBuffer])
  })
}

export async function runInspection(
  file: File,
  sourceName: string,
  signal: AbortSignal,
  password?: string,
): Promise<DocumentInspection> {
  const inputBuffer = await file.arrayBuffer()

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./converter.worker.ts', import.meta.url), {
      type: 'module',
      name: 'bookrefinery-preflight',
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
      reject(new DOMException('Inspection cancelled.', 'AbortError'))
    }
    const timeout = globalThis.setTimeout(() => {
      if (settled) return
      cleanup()
      reject(new WorkerConversionError(
        'LIMIT_EXCEEDED',
        `The ${Math.round(SECURITY_POLICY.inspectionTimeoutMs / 60_000)}-minute preflight limit was reached.`,
      ))
    }, SECURITY_POLICY.inspectionTimeoutMs)

    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => {
      if (settled) return
      cleanup()
      reject(new WorkerConversionError('CONVERSION_FAILED', 'The isolated preflight worker crashed.'))
    }
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return
      // See the conversion handler above. Dependency transport chatter is not
      // a response and cannot complete, fail, or otherwise influence the job.
      if (event.data === undefined || isPdfJsTransportMessage(event.data)) return
      if (!isWorkerResponse(event.data)) {
        cleanup()
        reject(new WorkerConversionError('CONVERSION_FAILED', 'The preflight worker returned invalid data.'))
        return
      }
      const response = event.data
      if (response.type === 'error') {
        cleanup()
        reject(new WorkerConversionError(response.code, response.message))
        return
      }
      if (response.type !== 'inspection-success') return
      cleanup()
      resolve(response.inspection)
    }

    const request: WorkerRequest = {
      type: 'inspect',
      filename: sourceName,
      buffer: inputBuffer,
      ...(password === undefined ? {} : { password }),
    }
    worker.postMessage(request, [inputBuffer])
  })
}
