export interface DesktopSaveRequest {
  readonly suggestedName: string
  readonly mimeType: string
  readonly data: ArrayBuffer
}

export interface BookRefineryDesktopBridge {
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
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return buffer
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
