import { NodeHtmlMarkdown } from 'node-html-markdown'
import { SecurityError } from './errors'
import { archiveDirname, resolveArchiveReference } from './path'

const IGNORED_ELEMENTS = [
  'head',
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'link',
  'meta',
  'base',
  'math',
  'video',
  'audio',
  'source',
] as const

const EXTERNAL_SCHEME = /^[a-z][a-z\d+.-]*:/i
const SAFE_FRAGMENT = /^#[a-z\d_.:-]{1,200}$/i

export interface MarkdownResult {
  readonly markdown: string
  readonly warnings: readonly string[]
}

type InlineSvgExporter = (svg: string, alt: string) => string | null
type InternalLinkResolver = (href: string) => string | null

interface ImageElement {
  getAttribute(name: string): string | null | undefined
  closest(selector: string): {
    querySelector(query: string): { readonly textContent: string | null } | null
  } | null
}

function escapeLabel(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/[\[\]\\]/gu, '\\$&')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 200)
}

function imageLabel(node: ImageElement): string {
  const figureCaption = node.closest('figure')?.querySelector('figcaption')?.textContent ?? undefined
  const candidates = [
    node.getAttribute('alt'),
    figureCaption,
    node.getAttribute('title'),
    node.getAttribute('aria-label'),
  ]
    .map((value) => value ? escapeLabel(value) : '')
    .filter(Boolean)

  return [...new Set(candidates)].join(' - ').slice(0, 300) || 'Image'
}

export function xhtmlToSafeMarkdown(
  html: string,
  chapterPath: string,
  imageTargets: ReadonlyMap<string, string>,
  exportInlineSvg?: InlineSvgExporter,
  resolveInternalLink?: InternalLinkResolver,
): MarkdownResult {
  const warnings: string[] = []
  const baseDirectory = archiveDirname(chapterPath)

  const markdown = NodeHtmlMarkdown.translate(
    html,
    {
      preferNativeParser: false,
      keepDataImages: false,
      useLinkReferenceDefinitions: false,
      useInlineLinks: true,
      ignore: [...IGNORED_ELEMENTS],
      bulletMarker: '-',
      codeBlockStyle: 'fenced',
      maxConsecutiveNewlines: 2,
    },
    {
      img: ({ node }) => {
        const alt = imageLabel(node)
        const source = node.getAttribute('src')?.trim() ?? ''
        if (!source || source.startsWith('//') || EXTERNAL_SCHEME.test(source)) {
          warnings.push('Removed an external or embedded image.')
          return { content: `[Image removed: ${alt}]`, recurse: false }
        }

        try {
          const archivePath = resolveArchiveReference(baseDirectory, source)
          const outputPath = imageTargets.get(archivePath)
          if (!outputPath) {
            warnings.push('Removed an unsupported or missing image.')
            return { content: `[Image removed: ${alt}]`, recurse: false }
          }
          return { content: `![${alt}](${outputPath})`, recurse: false }
        } catch (error) {
          if (!(error instanceof SecurityError)) throw error
          warnings.push('Removed an image with an unsafe path.')
          return { content: `[Image removed: ${alt}]`, recurse: false }
        }
      },
      svg: ({ node }) => {
        const alt = escapeLabel(node.querySelector('title')?.text ?? node.getAttribute('aria-label') ?? 'Inline SVG') || 'Inline SVG'
        const outputPath = exportInlineSvg?.(node.outerHTML, alt)
        if (!outputPath) {
          warnings.push('Removed an inline SVG that could not be sanitized safely.')
          return { content: `[Image removed: ${alt}]`, recurse: false }
        }
        return { content: `![${alt}](${outputPath})`, recurse: false }
      },
      a: ({ node }) => {
        const href = node.getAttribute('href')?.trim() ?? ''
        if (SAFE_FRAGMENT.test(href)) {
          return { prefix: '', postfix: ` (see note ${escapeLabel(href)})` }
        }
        if (href && !href.startsWith('//') && !EXTERNAL_SCHEME.test(href)) {
          const destination = resolveInternalLink?.(href)
          if (destination) return { prefix: '', postfix: ` (see ${escapeLabel(destination)})` }
        }
        if (href) warnings.push('Unlinked an external or cross-file link.')
        return { prefix: '', postfix: '' }
      },
    },
  )

  const hardened = markdown
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\b(?:https?|ftp):\/\/[^\s<>)\]]+/giu, '[external URL removed]')
    .replace(/\b(?:javascript|vbscript|data|file):[^\s<>)\]]*/giu, '[unsafe URL removed]')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()

  return { markdown: hardened, warnings: [...new Set(warnings)] }
}
