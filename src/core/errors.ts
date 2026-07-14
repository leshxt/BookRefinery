export type SecurityErrorCode =
  | 'INVALID_DOCUMENT'
  | 'LIMIT_EXCEEDED'
  | 'UNSAFE_ARCHIVE'
  | 'UNSAFE_XML'
  | 'UNSUPPORTED_DOCUMENT'
  | 'CONVERSION_FAILED'

export class SecurityError extends Error {
  readonly code: SecurityErrorCode

  constructor(code: SecurityErrorCode, message: string) {
    super(message)
    this.name = 'SecurityError'
    this.code = code
  }
}

export function publicError(error: unknown): { code: SecurityErrorCode; message: string } {
  if (error instanceof SecurityError) {
    return { code: error.code, message: error.message }
  }

  return {
    code: 'CONVERSION_FAILED',
    message: 'Die Datei konnte nicht sicher verarbeitet werden.',
  }
}
