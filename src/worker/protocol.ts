import type { ConversionProgress, ConversionSummary } from '../core/convert'
import type { SecurityErrorCode } from '../core/errors'

export interface ConvertRequest {
  readonly type: 'convert'
  readonly filename: string
  readonly buffer: ArrayBuffer
}

export type WorkerRequest = ConvertRequest

export type WorkerResponse =
  | { readonly type: 'progress'; readonly progress: ConversionProgress }
  | {
      readonly type: 'success'
      readonly archive: ArrayBuffer
      readonly filename: string
      readonly summary: ConversionSummary
      readonly preview: string
    }
  | { readonly type: 'error'; readonly code: SecurityErrorCode; readonly message: string }
