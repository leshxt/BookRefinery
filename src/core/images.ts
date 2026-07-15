import { safeOutputName } from './path'

export interface RasterDescriptor {
  readonly extension: string
  readonly signature: (bytes: Uint8Array) => boolean
}

const RASTER_TYPES = new Map<string, RasterDescriptor>([
  ['image/png', {
    extension: 'png',
    signature: (bytes) =>
      bytes.byteLength >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value),
  }],
  ['image/jpeg', {
    extension: 'jpg',
    signature: (bytes) => bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  }],
  ['image/gif', {
    extension: 'gif',
    signature: (bytes) => {
      const header = String.fromCharCode(...bytes.slice(0, 6))
      return bytes.byteLength >= 6 && (header === 'GIF87a' || header === 'GIF89a')
    },
  }],
  ['image/webp', {
    extension: 'webp',
    signature: (bytes) =>
      bytes.byteLength >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP',
  }],
])

export function rasterDescriptor(mediaType: string): RasterDescriptor | undefined {
  return RASTER_TYPES.get(mediaType.toLocaleLowerCase('en-US'))
}

export function figureId(sequence: number): string {
  return `FIG-${String(sequence).padStart(4, '0')}`
}

export function outputAssetPath(sequence: number, baseName: string, extension: string): string {
  const fallback = `image-${sequence}`
  const safeBaseName = safeOutputName(baseName, fallback).replace(/[()]/gu, '-')
  return `assets/${figureId(sequence)}-${safeBaseName}.${extension}`
}

export function outputAssetName(outputPath: string): string | null {
  return outputPath.split('/').at(-1) ?? null
}
