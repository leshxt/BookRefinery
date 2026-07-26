export const SECURITY_POLICY = {
  maxInputBytes: 80 * 1024 * 1024,
  maxEntries: 5_000,
  maxEntryBytes: 25 * 1024 * 1024,
  maxTotalUncompressedBytes: 250 * 1024 * 1024,
  maxCompressionRatio: 100,
  minCompressionRatioCheckBytes: 4 * 1024 * 1024,
  maxXmlBytes: 2 * 1024 * 1024,
  maxXhtmlBytes: 5 * 1024 * 1024,
  maxSvgBytes: 5 * 1024 * 1024,
  maxFb2Bytes: 50 * 1024 * 1024,
  maxFb2BinaryBytes: 25 * 1024 * 1024,
  maxFb2DecodedBytes: 100 * 1024 * 1024,
  maxOutputBytes: 300 * 1024 * 1024,
  maxPdfPages: 2_000,
  maxPdfTextBytes: 30 * 1024 * 1024,
  maxPdfPageTextBytes: 2 * 1024 * 1024,
  maxVisualPdfPages: 500,
  maxVisualPdfPixels: 480_000_000,
  maxPdfSourceImagePixels: 20_000_000,
  maxPdfPasswordLength: 1_024,
  maxBatchFiles: 20,
  maxOcrPages: 500,
  maxOcrPixels: 1_500_000_000,
  maxOcrPagePixels: 4_500_000,
  maxPathLength: 1_024,
  maxPathSegmentLength: 240,
  workerTimeoutMs: 120_000,
  inspectionTimeoutMs: 120_000,
  ocrWorkerTimeoutMs: 3_600_000,
} as const

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–'
  if (bytes < 1_024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB'] as const
  let value = bytes / 1_024
  let unitIndex = 0

  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}
