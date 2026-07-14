/// <reference lib="webworker" />

import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { convertDocument } from '../core/convert'
import { publicError } from '../core/errors'
import type { WorkerRequest, WorkerResponse } from './protocol'

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope
GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function isConvertRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate['type'] === 'convert' && typeof candidate['filename'] === 'string' && candidate['buffer'] instanceof ArrayBuffer
}

async function handleRequest(value: unknown): Promise<void> {
  if (!isConvertRequest(value)) {
    const response: WorkerResponse = {
      type: 'error',
      code: 'CONVERSION_FAILED',
      message: 'The conversion request was invalid.',
    }
    workerScope.postMessage(response)
    return
  }

  try {
    const result = await convertDocument(new Uint8Array(value.buffer), value.filename, (progress) => {
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

workerScope.onmessage = (event: MessageEvent<unknown>) => {
  void handleRequest(event.data)
}

export {}
