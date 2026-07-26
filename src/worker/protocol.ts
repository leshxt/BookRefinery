import type { ConversionProgress, ConversionSummary } from '../core/convert'
import type { ConversionOptions, DocumentInspection } from '../core/contracts'
import type { SecurityErrorCode } from '../core/errors'

export interface ConvertRequest {
  readonly type: 'convert'
  readonly filename: string
  readonly buffer: ArrayBuffer
  readonly options: ConversionOptions
  readonly password?: string
}

export interface InspectRequest {
  readonly type: 'inspect'
  readonly filename: string
  readonly buffer: ArrayBuffer
  readonly password?: string
}

export type WorkerRequest = ConvertRequest | InspectRequest

export type WorkerResponse =
  | { readonly type: 'progress'; readonly progress: ConversionProgress }
  | { readonly type: 'inspection-success'; readonly inspection: DocumentInspection }
  | {
      readonly type: 'success'
      readonly archive: ArrayBuffer
      readonly filename: string
      readonly summary: ConversionSummary
      readonly preview: string
    }
  | { readonly type: 'error'; readonly code: SecurityErrorCode; readonly message: string }
