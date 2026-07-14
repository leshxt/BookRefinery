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
  'svg',
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

function escapeLabel(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/[\[\]\\]/gu, '\\$&')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 200)
}

export function xhtmlToSafeMarkdown(
  html: string,
  chapterPath: string,
  imageTargets: ReadonlyMap<string, string>,
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
        const alt = escapeLabel(node.getAttribute('alt') ?? 'Bild') || 'Bild'
        const source = node.getAttribute('src')?.trim() ?? ''
        if (!source || source.startsWith('//') || EXTERNAL_SCHEME.test(source)) {
          warnings.push('Ein externes oder eingebettetes Bild wurde entfernt.')
          return { content: `[Bild entfernt: ${alt}]`, recurse: false }
        }

        try {
          const archivePath = resolveArchiveReference(baseDirectory, source)
          const outputPath = imageTargets.get(archivePath)
          if (!outputPath) {
            warnings.push('Ein nicht unterstütztes oder fehlendes Bild wurde entfernt.')
            return { content: `[Bild entfernt: ${alt}]`, recurse: false }
          }
          return { content: `![${alt}](${outputPath})`, recurse: false }
        } catch (error) {
          if (!(error instanceof SecurityError)) throw error
          warnings.push('Ein Bild mit unsicherem Pfad wurde entfernt.')
          return { content: `[Bild entfernt: ${alt}]`, recurse: false }
        }
      },
      a: ({ node }) => {
        const href = node.getAttribute('href')?.trim() ?? ''
        if (SAFE_FRAGMENT.test(href)) {
          return { prefix: '[', postfix: `](${href})` }
        }
        if (href) warnings.push('Ein externer oder dateiübergreifender Link wurde entlinkt.')
        return { prefix: '', postfix: '' }
      },
    },
  )

  const hardened = markdown
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\b(?:https?|ftp):\/\/[^\s<>)\]]+/giu, '[externe URL entfernt]')
    .replace(/\b(?:javascript|vbscript|data|file):[^\s<>)\]]*/giu, '[unsichere URL entfernt]')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()

  return { markdown: hardened, warnings: [...new Set(warnings)] }
}
