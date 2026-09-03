import {
  selectionNeedsVisualCompanion,
  type DocumentInspection,
  type OutputSelectionId,
} from './core/contracts'
import {
  LARGE_SAVE_WARNING_BYTES,
  MAX_COMBINED_ZIP_BYTES,
  SECURITY_POLICY,
} from './core/policy'

export interface InspectedResource {
  readonly sourceName: string
  readonly inspection: DocumentInspection
}

export function requiresLargeSaveConfirmation(bytes: number): boolean {
  return bytes > LARGE_SAVE_WARNING_BYTES
}

export function isCombinedZipSizeSupported(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_COMBINED_ZIP_BYTES
}

export function conversionResourceWarnings(
  jobs: readonly InspectedResource[],
  outputs: readonly OutputSelectionId[],
  ocrEnabled: boolean,
): readonly string[] {
  const warnings: string[] = []
  for (const job of jobs) {
    if (job.inspection.format !== 'pdf') continue
    if (
      selectionNeedsVisualCompanion(outputs, 'pdf') &&
      job.inspection.units > SECURITY_POLICY.maxVisualPdfPages
    ) {
      warnings.push(
        `${job.sourceName}: ${job.inspection.units.toLocaleString('en-US')} visual pages exceed the normal ${SECURITY_POLICY.maxVisualPdfPages}-page budget.`,
      )
    }
    const visualPlanPixelCeiling = SECURITY_POLICY.maxVisualPdfPixels /
      (SECURITY_POLICY.minVisualPdfScale ** 2)
    if (
      selectionNeedsVisualCompanion(outputs, 'pdf') &&
      (job.inspection.estimatedVisualPixels ?? 0) > visualPlanPixelCeiling
    ) {
      warnings.push(
        `${job.sourceName}: preserving every visual page exceeds the normal adaptive pixel budget.`,
      )
    }
    if (
      ocrEnabled &&
      (job.inspection.imageOnlyPages ?? 0) > SECURITY_POLICY.maxOcrPages
    ) {
      warnings.push(
        `${job.sourceName}: ${(job.inspection.imageOnlyPages ?? 0).toLocaleString('en-US')} textless pages exceed the normal ${SECURITY_POLICY.maxOcrPages}-page OCR budget.`,
      )
    }
    if (
      ocrEnabled &&
      (job.inspection.estimatedOcrPixels ?? 0) > SECURITY_POLICY.maxOcrPixels
    ) {
      warnings.push(
        `${job.sourceName}: estimated OCR work exceeds the normal per-book pixel budget.`,
      )
    }
  }
  return warnings
}
