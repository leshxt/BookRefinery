/// <reference lib="webworker" />

import { convertEpub } from '../core/convert'
import { publicError } from '../core/errors'
import type { WorkerRequest, WorkerResponse } from './protocol'

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope

function isConvertRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate['type'] === 'convert' && typeof candidate['filename'] === 'string' && candidate['buffer'] instanceof ArrayBuffer
}

workerScope.onmessage = (event: MessageEvent<unknown>) => {
  if (!isConvertRequest(event.data)) {
    const response: WorkerResponse = {
      type: 'error',
      code: 'CONVERSION_FAILED',
      message: 'Der Konvertierungsauftrag war ungültig.',
    }
    workerScope.postMessage(response)
    return
  }

  try {
    const request = event.data
    const result = convertEpub(new Uint8Array(request.buffer), request.filename, (progress) => {
      const response: WorkerResponse = { type: 'progress', progress }
      workerScope.postMessage(response)
    })
    const transferable = result.archive.buffer.slice(
      result.archive.byteOffset,
      result.archive.byteOffset + result.archive.byteLength,
    ) as ArrayBuffer
    const response: WorkerResponse = {
      type: 'success',
      archive: transferable,
      filename: result.filename,
      summary: result.summary,
      preview: result.preview,
    }
    workerScope.postMessage(response, [transferable])
  } catch (error) {
    const failure = publicError(error)
    const response: WorkerResponse = { type: 'error', ...failure }
    workerScope.postMessage(response)
  }
}

export {}
