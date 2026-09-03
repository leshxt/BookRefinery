export interface DesktopSaveRequest {
  readonly suggestedName: string
  readonly mimeType: string
  readonly data: ArrayBuffer
}

export interface BookRefineryDesktopBridge {
  resolveSelectedFileName(file: File): Promise<unknown>
  saveFile(request: DesktopSaveRequest): Promise<{ readonly canceled: boolean }>
}

export type SaveFileResult = 'saved' | 'cancelled' | 'browser-download'

interface SaveFilePickerHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>
    close(): Promise<void>
  }>
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    readonly suggestedName: string
    readonly types: readonly [{
      readonly description: string
      readonly accept: Readonly<Record<string, readonly string[]>>
    }]
  }) => Promise<SaveFilePickerHandle>
}

declare global {
  interface Window {
    readonly bookRefineryDesktop?: BookRefineryDesktopBridge
  }
}

function exactArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (
    data.buffer instanceof ArrayBuffer &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength
  ) {
    return data.buffer
  }
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return buffer
}

function isSafeSelectedFilename(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/\u0000-\u001f\u007f]/u.test(value)
  )
}

export async function selectedFileName(file: File): Promise<string> {
  const desktopBridge = window.bookRefineryDesktop
  if (!desktopBridge) return file.name
  try {
    const resolvedName = await desktopBridge.resolveSelectedFileName(file)
    return isSafeSelectedFilename(resolvedName) ? resolvedName : file.name
  } catch {
    return file.name
  }
}

function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function extensionFor(filename: string): string {
  const match = /(\.[A-Za-z0-9]{1,12})$/u.exec(filename)
  return match?.[1]?.toLocaleLowerCase('en-US') ?? '.zip'
}

export async function savePreparedFile(
  data: Uint8Array,
  filename: string,
  mimeType = 'application/zip',
): Promise<SaveFileResult> {
  const buffer = exactArrayBuffer(data)
  const desktopBridge = window.bookRefineryDesktop
  if (desktopBridge) {
    const result = await desktopBridge.saveFile({
      suggestedName: filename,
      mimeType,
      data: buffer,
    })
    return result.canceled ? 'cancelled' : 'saved'
  }

  const picker = (window as SaveFilePickerWindow).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{
          description: 'BookRefinery ZIP package',
          accept: { [mimeType]: [extensionFor(filename)] },
        }],
      })
      const writable = await handle.createWritable()
      await writable.write(new Blob([buffer], { type: mimeType }))
      await writable.close()
      return 'saved'
    } catch (error) {
      if (isCancellation(error)) return 'cancelled'
      throw error
    }
  }

  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  return 'browser-download'
}
