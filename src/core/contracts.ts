export const OUTPUT_PROFILE_IDS = ['notebooklm', 'rag', 'markdown', 'archive'] as const
export const OUTPUT_SELECTION_IDS = ['visual-source', 'markdown', 'chunks', 'assets'] as const

export type OutputProfileId = typeof OUTPUT_PROFILE_IDS[number]
export type OutputModeId = OutputProfileId | 'custom'
export type OutputSelectionId = typeof OUTPUT_SELECTION_IDS[number]
export type DocumentFormat = 'epub' | 'fb2' | 'pdf'
export type OcrLanguage = 'eng' | 'deu'
export type RepairLevel = 'automatic' | 'salvage'
export type ResourceMode = 'standard' | 'extended'

export interface DocumentRepairSummary {
  readonly level: RepairLevel
  readonly actions: readonly string[]
  readonly originalBytes: number
  readonly repairedBytes: number
  readonly omittedEntries: number
}

export interface ConversionOptions {
  readonly profile: OutputModeId
  readonly outputs: readonly OutputSelectionId[]
  readonly resourceMode: ResourceMode
  readonly ocr: {
    readonly enabled: boolean
    readonly languages: readonly OcrLanguage[]
  }
}

export interface OutputFileSpec {
  readonly path: string
  readonly format: string
  readonly description: string
  readonly optional?: boolean
}

export interface OutputProfile {
  readonly id: OutputProfileId
  readonly name: string
  readonly summary: string
  readonly difference: string
  readonly outputs: readonly OutputSelectionId[]
  readonly recommended?: boolean
}

export interface OutputSelection {
  readonly id: OutputSelectionId
  readonly name: string
  readonly formats: string
  readonly useCase: string
  readonly description: string
}

export interface DocumentInspection {
  readonly format: DocumentFormat
  readonly title: string
  readonly author?: string
  readonly language?: string
  readonly units: number
  readonly unitLabel: 'chapters' | 'pages'
  readonly graphics: number
  readonly inputBytes: number
  readonly processedBytes: number
  readonly textCoverage: 'full' | 'partial' | 'none' | 'unknown'
  readonly checkedPages?: number
  readonly imageOnlyPages?: number
  readonly estimatedVisualPixels?: number
  readonly estimatedOcrPixels?: number
  readonly ocrWithinBudget?: boolean
  readonly passwordProtected?: boolean
  readonly ocrRecommended: boolean
  readonly warnings: readonly string[]
  readonly repair?: DocumentRepairSummary
}

export const OUTPUT_PROFILES = [
  {
    id: 'notebooklm',
    name: 'NotebookLM',
    summary: 'One visual, searchable source without duplicate passages.',
    difference: 'Best default for NotebookLM and multimodal chat.',
    outputs: ['visual-source'],
    recommended: true,
  },
  {
    id: 'rag',
    name: 'RAG / Knowledge Base',
    summary: 'Markdown, retrieval chunks, and separate figures.',
    difference: 'For indexing pipelines that retrieve small, independent files.',
    outputs: ['markdown', 'chunks', 'assets'],
  },
  {
    id: 'markdown',
    name: 'Markdown Workspace',
    summary: 'One readable Markdown document plus separate figures.',
    difference: 'For editing, Git, Obsidian, and text-first tools.',
    outputs: ['markdown', 'assets'],
  },
  {
    id: 'archive',
    name: 'Safe Archive',
    summary: 'Every sanitized representation in one documented bundle.',
    difference: 'For preservation and maximum flexibility.',
    outputs: ['visual-source', 'markdown', 'chunks', 'assets'],
  },
] as const satisfies readonly OutputProfile[]

export const OUTPUT_SELECTIONS = [
  {
    id: 'visual-source',
    name: 'Sanitized visual source',
    formats: 'PDF or EPUB',
    useCase: 'NotebookLM, multimodal chat, visual verification',
    description: 'Keeps selectable text together with the original page or figure context in one passive file.',
  },
  {
    id: 'markdown',
    name: 'Complete Markdown',
    formats: 'MD',
    useCase: 'Obsidian, editing, Git, simple LLM uploads',
    description: 'A single readable text document with stable page, chapter, and figure identifiers.',
  },
  {
    id: 'chunks',
    name: 'Retrieval chunks',
    formats: 'MD + outline',
    useCase: 'RAG, embeddings, knowledge bases',
    description: 'Separate pages or chapters, plus PDF sections and outline data when available.',
  },
  {
    id: 'assets',
    name: 'Visual assets',
    formats: 'Images + index or PDF',
    useCase: 'Visual RAG, figure auditing, image-capable LLMs',
    description: 'Exports sanitized EPUB/FB2 figures with stable locations. For PDF, it keeps visuals in their page context inside the sanitized PDF.',
  },
] as const satisfies readonly OutputSelection[]

export const DEFAULT_CONVERSION_OPTIONS: ConversionOptions = {
  profile: 'archive',
  outputs: ['visual-source', 'markdown', 'chunks', 'assets'],
  resourceMode: 'standard',
  ocr: {
    enabled: true,
    languages: ['eng', 'deu'],
  },
}

const COMMON_REPORTS: readonly OutputFileSpec[] = [
  {
    path: '{Book title}.security-report.md',
    format: 'Markdown',
    description: 'Limits, removals, warnings, and the applied security policy. Always included.',
  },
  {
    path: '{Book title}.export-manifest.json',
    format: 'JSON',
    description: 'SHA-256 inventory of every selected file. Always included.',
  },
  {
    path: '{Book title}.repair-report.md',
    format: 'Markdown',
    description: 'Exact automatic repair or salvage actions. Included only when the source needed repair.',
    optional: true,
  },
  {
    path: 'repair/{Book title}.repaired.epub or .fb2.zip',
    format: 'EPUB or FB2 ZIP',
    description: 'Structurally repaired source copy. Included only when it can be rebuilt without guessing.',
    optional: true,
  },
]

function visualSourceOutputs(format: DocumentFormat): readonly OutputFileSpec[] {
  return [
    {
      path: format === 'pdf'
        ? 'notebooklm/{Book title}.sanitized.pdf'
        : 'notebooklm/{Book title}.sanitized.epub',
      format: format === 'pdf' ? 'PDF' : 'EPUB',
      description: format === 'pdf'
        ? 'High-quality passive page renderings with a rebuilt, position-aligned selectable text layer.'
        : `Passive ${format.toUpperCase()} content with live text and sanitized graphics in reading order.`,
      optional: format === 'pdf',
    },
    {
      path: 'notebooklm/README.md',
      format: 'Markdown',
      description: 'Import guidance for the selected visual source.',
    },
  ]
}

function markdownOutputs(): readonly OutputFileSpec[] {
  return [{
    path: '{Book title}.md',
    format: 'Markdown',
    description: 'Complete readable text with stable page, chapter, and figure identifiers.',
  }]
}

function chunkOutputs(format: DocumentFormat): readonly OutputFileSpec[] {
  return format === 'pdf'
    ? [
        {
          path: 'pages/PAGE-*.md',
          format: 'Markdown',
          description: 'One independently indexable file per PDF page.',
        },
        {
          path: 'sections/*.md',
          format: 'Markdown',
          description: 'Outline-derived sections when a usable PDF outline exists.',
          optional: true,
        },
        {
          path: '{Book title}.outline.md',
          format: 'Markdown',
          description: 'Stable outline-to-page mapping when present.',
          optional: true,
        },
      ]
    : [{
        path: 'chapters/*.md',
        format: 'Markdown',
        description: 'One independently indexable file per chapter.',
      }]
}

function assetOutputs(format: DocumentFormat): readonly OutputFileSpec[] {
  if (format === 'pdf') {
    return [{
      path: 'notebooklm/{Book title}.sanitized.pdf',
      format: 'Searchable PDF',
      description: 'PDF graphics stay at their exact page positions with selectable text; no disconnected duplicate image set is created.',
    }]
  }
  return [
    {
      path: 'assets/*.{png,jpg,gif,webp,svg}',
      format: 'Images',
      description: 'Sanitized standalone graphics referenced by stable figure identifiers.',
      optional: true,
    },
    {
      path: 'notebooklm/{Book title}.figure-index.md',
      format: 'Markdown',
      description: 'Maps each figure to its reading position and nearby text.',
    },
  ]
}

export function outputsForProfile(profile: OutputProfileId): readonly OutputSelectionId[] {
  return OUTPUT_PROFILES.find((candidate) => candidate.id === profile)?.outputs ?? []
}

export function outputFilesForSelection(
  outputs: readonly OutputSelectionId[],
  format: DocumentFormat,
): readonly OutputFileSpec[] {
  const selected: OutputFileSpec[] = []
  if (outputs.includes('visual-source')) selected.push(...visualSourceOutputs(format))
  if (outputs.includes('markdown')) selected.push(...markdownOutputs())
  if (outputs.includes('chunks')) selected.push(...chunkOutputs(format))
  if (outputs.includes('assets')) selected.push(...assetOutputs(format))
  selected.push(...COMMON_REPORTS)
  return selected.filter((candidate, index, all) =>
    all.findIndex((existing) => existing.path === candidate.path) === index)
}

export function profileOutputFiles(
  profile: OutputProfileId,
  format: DocumentFormat,
): readonly OutputFileSpec[] {
  return outputFilesForSelection(outputsForProfile(profile), format)
}

export function selectionNeedsVisualCompanion(
  outputs: readonly OutputSelectionId[],
  format: DocumentFormat,
): boolean {
  return format === 'pdf' && (
    outputs.includes('visual-source') ||
    outputs.includes('assets')
  )
}

export function profileNeedsVisualCompanion(
  profile: OutputProfileId,
  format: DocumentFormat,
): boolean {
  return selectionNeedsVisualCompanion(outputsForProfile(profile), format)
}
