export const OUTPUT_PROFILE_IDS = ['notebooklm', 'rag', 'markdown', 'archive'] as const

export type OutputProfileId = typeof OUTPUT_PROFILE_IDS[number]
export type DocumentFormat = 'epub' | 'fb2' | 'pdf'
export type OcrLanguage = 'eng' | 'deu'

export interface ConversionOptions {
  readonly profile: OutputProfileId
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
  readonly sampledPages?: number
  readonly imageOnlySampledPages?: number
  readonly ocrRecommended: boolean
  readonly warnings: readonly string[]
}

export const OUTPUT_PROFILES = [
  {
    id: 'notebooklm',
    name: 'NotebookLM',
    summary: 'One primary multimodal source, import guidance, visual fallbacks, and safety reports.',
  },
  {
    id: 'rag',
    name: 'RAG / Knowledge Base',
    summary: 'Chunkable Markdown, stable page or chapter files, graphics, indexes, and machine metadata.',
  },
  {
    id: 'markdown',
    name: 'Readable Markdown',
    summary: 'A compact human-readable Markdown document with contextual graphics and safety records.',
  },
  {
    id: 'archive',
    name: 'Safe Archive',
    summary: 'Every sanitized representation and supporting file in one reproducible bundle.',
  },
] as const satisfies readonly OutputProfile[]

export const DEFAULT_CONVERSION_OPTIONS: ConversionOptions = {
  profile: 'archive',
  ocr: {
    enabled: false,
    languages: ['eng', 'deu'],
  },
}

const COMMON_REPORTS: readonly OutputFileSpec[] = [
  {
    path: 'SECURITY-REPORT.md',
    format: 'Markdown',
    description: 'Limits, removals, warnings, and the applied security policy.',
  },
  {
    path: 'EXPORT-MANIFEST.json',
    format: 'JSON',
    description: 'Deterministic file inventory with SHA-256 checksums.',
  },
]

function bookPrimary(format: 'epub' | 'fb2'): OutputFileSpec {
  return {
    path: 'notebooklm/book.sanitized.epub',
    format: 'EPUB',
    description: `Sanitized visual ${format.toUpperCase()} content rebuilt as one passive multimodal ebook.`,
  }
}

function pdfPrimary(): OutputFileSpec {
  return {
    path: 'notebooklm/document.sanitized.pdf',
    format: 'PDF',
    description: 'Page-faithful sanitized PDF with a rebuilt searchable Unicode text layer.',
    optional: true,
  }
}

function notebookOutputs(format: DocumentFormat): readonly OutputFileSpec[] {
  const primary = format === 'pdf' ? pdfPrimary() : bookPrimary(format)
  return [
    primary,
    {
      path: format === 'pdf' ? 'notebooklm/document.md' : 'notebooklm/book.md',
      format: 'Markdown',
      description: 'Text-only fallback with stable reading-position identifiers.',
    },
    {
      path: 'notebooklm/README.md',
      format: 'Markdown',
      description: 'Exact import instructions for the generated source.',
    },
    ...(format === 'pdf'
      ? []
      : [
          {
            path: 'notebooklm/FIGURE-INDEX.md',
            format: 'Markdown',
            description: 'Maps each figure to its reading position and nearby text.',
          },
          {
            path: 'assets/*.{png,jpg,gif,webp,svg}',
            format: 'Images',
            description: 'Sanitized standalone figure fallbacks.',
            optional: true,
          },
        ]),
    ...COMMON_REPORTS,
  ]
}

function ragOutputs(format: DocumentFormat): readonly OutputFileSpec[] {
  return [
    {
      path: format === 'pdf' ? 'document.md' : 'book.md',
      format: 'Markdown',
      description: 'Canonical document with stable page, chapter, and figure identifiers.',
    },
    {
      path: format === 'pdf' ? 'pages/PAGE-*.md' : 'chapters/*.md',
      format: 'Markdown',
      description: 'Bounded, independently indexable retrieval units.',
    },
    ...(format === 'pdf'
      ? [
          pdfPrimary(),
          {
            path: 'sections/*.md',
            format: 'Markdown',
            description: 'Outline-derived PDF sections when a usable outline exists.',
            optional: true,
          },
          {
            path: 'OUTLINE.md',
            format: 'Markdown',
            description: 'Stable PDF outline-to-page mapping.',
            optional: true,
          },
        ]
      : [
          {
            path: 'assets/*.{png,jpg,gif,webp,svg}',
            format: 'Images',
            description: 'Sanitized graphics referenced by stable figure identifiers.',
            optional: true,
          },
          {
            path: 'notebooklm/FIGURE-INDEX.md',
            format: 'Markdown',
            description: 'Figure-to-context mapping for multimodal retrieval.',
          },
        ]),
    {
      path: 'notebooklm/LLM-SAFETY-REPORT.md',
      format: 'Markdown',
      description: 'Instruction-like source passages retained for review.',
      optional: format === 'pdf',
    },
    ...COMMON_REPORTS,
  ]
}

function markdownOutputs(format: DocumentFormat): readonly OutputFileSpec[] {
  return [
    {
      path: format === 'pdf' ? 'document.md' : 'book.md',
      format: 'Markdown',
      description: 'One readable document with stable visual references.',
    },
    ...(format === 'pdf'
      ? [pdfPrimary()]
      : [
          {
            path: 'assets/*.{png,jpg,gif,webp,svg}',
            format: 'Images',
            description: 'Sanitized graphics referenced from the Markdown document.',
            optional: true,
          },
        ]),
    ...COMMON_REPORTS,
  ]
}

export function profileOutputFiles(
  profile: OutputProfileId,
  format: DocumentFormat,
): readonly OutputFileSpec[] {
  switch (profile) {
    case 'notebooklm':
      return notebookOutputs(format)
    case 'rag':
      return ragOutputs(format)
    case 'markdown':
      return markdownOutputs(format)
    case 'archive':
      return [
        ...notebookOutputs(format),
        ...ragOutputs(format).filter((candidate) =>
          !notebookOutputs(format).some((existing) => existing.path === candidate.path)),
        ...markdownOutputs(format).filter((candidate) =>
          !notebookOutputs(format).some((existing) => existing.path === candidate.path) &&
          !ragOutputs(format).some((existing) => existing.path === candidate.path)),
      ]
  }
}

export function profileNeedsVisualCompanion(
  profile: OutputProfileId,
  format: DocumentFormat,
): boolean {
  return format === 'pdf' || profile === 'notebooklm' || profile === 'archive'
}
