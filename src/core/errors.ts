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

  if (error instanceof Error) {
    const detail = error.message
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 300)
    if (detail) {
      return {
        code: 'CONVERSION_FAILED',
        message: `The isolated converter failed: ${detail}`,
      }
    }
  }

  return {
    code: 'CONVERSION_FAILED',
    message: 'The file could not be processed safely.',
  }
}
