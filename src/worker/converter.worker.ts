/// <reference lib="webworker" />

import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import {
  OUTPUT_PROFILE_IDS,
  OUTPUT_SELECTION_IDS,
  type ConversionOptions,
  type OcrLanguage,
} from '../core/contracts'
import { convertDocument } from '../core/convert'
import { publicError } from '../core/errors'
import { inspectDocument } from '../core/inspection'
import { SECURITY_POLICY } from '../core/policy'
import type { WorkerRequest, WorkerResponse } from './protocol'

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope
GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function isConversionOptions(value: unknown): value is ConversionOptions {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const ocr = candidate['ocr']
  const outputs = candidate['outputs']
  if (
    !(candidate['profile'] === 'custom' || OUTPUT_PROFILE_IDS.includes(candidate['profile'] as never)) ||
    !(candidate['resourceMode'] === 'standard' || candidate['resourceMode'] === 'extended') ||
    !Array.isArray(outputs) ||
    outputs.length === 0 ||
    !outputs.every((output) => OUTPUT_SELECTION_IDS.includes(output as never)) ||
    typeof ocr !== 'object' ||
    ocr === null
  ) {
    return false
  }
  const ocrCandidate = ocr as Record<string, unknown>
  const languages = ocrCandidate['languages']
  return (
    typeof ocrCandidate['enabled'] === 'boolean' &&
    Array.isArray(languages) &&
    languages.length > 0 &&
    languages.every((language): language is OcrLanguage => language === 'eng' || language === 'deu')
  )
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const password = candidate['password']
  const hasValidPassword = password === undefined || (
    typeof password === 'string' &&
    password.length > 0 &&
    password.length <= SECURITY_POLICY.maxPdfPasswordLength
  )
  if (
    candidate['type'] === 'inspect' &&
    typeof candidate['filename'] === 'string' &&
    candidate['buffer'] instanceof ArrayBuffer &&
    hasValidPassword
  ) {
    return true
  }
  return (
    candidate['type'] === 'convert' &&
    typeof candidate['filename'] === 'string' &&
    candidate['buffer'] instanceof ArrayBuffer &&
    hasValidPassword &&
    isConversionOptions(candidate['options'])
  )
}

async function handleRequest(value: unknown): Promise<void> {
  if (!isWorkerRequest(value)) {
    const response: WorkerResponse = {
      type: 'error',
      code: 'CONVERSION_FAILED',
      message: 'The conversion request was invalid.',
    }
    workerScope.postMessage(response)
    return
  }

  try {
    if (value.type === 'inspect') {
      const inspection = await inspectDocument(
        new Uint8Array(value.buffer),
        value.filename,
        value.password,
      )
      const response: WorkerResponse = { type: 'inspection-success', inspection }
      workerScope.postMessage(response)
      return
    }
    const result = await convertDocument(new Uint8Array(value.buffer), value.filename, (progress) => {
      const response: WorkerResponse = { type: 'progress', progress }
      workerScope.postMessage(response)
    }, value.options, value.password)
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
