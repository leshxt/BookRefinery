import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openSecureArchive } from '../core/archive'
import { convertDocument } from '../core/convert'
import { openRepairableEpub, readEpubPackage } from '../core/epub'
import { SecurityError } from '../core/errors'
import { repairZipArchive } from '../core/repair'
import { makeFb2 } from './fb2-fixture'
import { makeEpub } from './fixtures'

const CENTRAL_DIRECTORY_SIGNATURE = new Uint8Array([0x50, 0x4b, 0x01, 0x02])

function findSignature(bytes: Uint8Array, signature: Uint8Array): number {
  for (let offset = 0; offset <= bytes.byteLength - signature.byteLength; offset += 1) {
    if (signature.every((value, index) => bytes[offset + index] === value)) return offset
  }
  throw new Error('Expected ZIP signature was not found')
}

function withoutDirectory(bytes: Uint8Array, trimLocalBytes = 0): Uint8Array {
  const directoryOffset = findSignature(bytes, CENTRAL_DIRECTORY_SIGNATURE)
  return bytes.slice(0, directoryOffset - trimLocalBytes)
}

describe('deterministic ZIP and EPUB repair', () => {
  it('repairs a one-byte-truncated ZIP end record and exports the repaired source', async () => {
    const original = makeEpub()
    const damaged = original.slice(0, -1)
    const result = await convertDocument(damaged, 'truncated.epub')
    const output = unzipSync(result.archive)
    const repaired = output['repair/Sicheres Testbuch.repaired.epub']

    expect(result.summary.repair?.level).toBe('automatic')
    expect(result.summary.repair?.omittedEntries).toBe(0)
    expect(result.summary.repair?.actions.join(' ')).toMatch(/ZIP directory and end record/u)
    expect(output['Sicheres Testbuch.repair-report.md']).toBeDefined()
    expect(repaired).toBeDefined()
    expect(readEpubPackage(openSecureArchive(repaired!).entries).title).toBe('Sicheres Testbuch')
  })

  it('reconstructs a missing central directory from complete local entries', async () => {
    const damaged = withoutDirectory(makeEpub())
    const result = await convertDocument(damaged, 'directory-missing.epub')

    expect(result.summary.repair?.level).toBe('automatic')
    expect(result.summary.repair?.actions.join(' ')).toMatch(/canonical ZIP archive/u)
    expect(result.summary.units).toBe(1)
  })

  it('uses clearly marked salvage mode when only a trailing entry is incomplete', async () => {
    const damaged = withoutDirectory(makeEpub(), 1)
    const result = await convertDocument(damaged, 'partial.epub')
    const output = unzipSync(result.archive)
    const report = strFromU8(output['Sicheres Testbuch.repair-report.md']!)

    expect(result.summary.repair?.level).toBe('salvage')
    expect(result.summary.repair?.omittedEntries).toBe(1)
    expect(report).toContain('Mode: salvage')
    expect(report).toContain('Omitted the incomplete trailing ZIP entry')
  })

  it('repairs a compressed FB2 archive and exports its verified source copy', async () => {
    const damaged = withoutDirectory(makeFb2({ zipped: true }))
    const result = await convertDocument(damaged, 'damaged.fb2.zip')
    const output = unzipSync(result.archive)

    expect(result.summary.format).toBe('fb2')
    expect(result.summary.repair?.level).toBe('automatic')
    expect(output['Visual FB2 Test.repair-report.md']).toBeDefined()
    expect(output['repair/Visual FB2 Test.repaired.fb2.zip']).toBeDefined()
  })

  it('still rejects unsafe paths discovered during reconstruction', async () => {
    const unsafe = zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      '../outside.xhtml': strToU8('<html/>'),
    })
    const damaged = withoutDirectory(unsafe)

    await expect(convertDocument(damaged, 'unsafe.epub')).rejects.toThrow(/unsafe|escape/u)
  })

  it('reports an unsupported ZIP method precisely instead of guessing', () => {
    const damaged = withoutDirectory(makeEpub())
    damaged[8] = 99
    damaged[9] = 0

    expect(() => repairZipArchive(damaged)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_COMPRESSION' }),
    )
  })

  it('refuses local-header recovery when data descriptors make boundaries ambiguous', () => {
    const damaged = withoutDirectory(makeEpub())
    damaged[6] = damaged[6]! | 0x08

    expect(() => repairZipArchive(damaged)).toThrowError(
      expect.objectContaining({ code: 'AMBIGUOUS_REPAIR' }),
    )
  })

  it('rebuilds a missing EPUB container when exactly one valid OPF exists', async () => {
    const entries = unzipSync(makeEpub())
    delete entries['META-INF/container.xml']
    const source = openRepairableEpub(zipSync(entries))

    expect(source.repair?.level).toBe('automatic')
    expect(source.repair?.actions.join(' ')).toContain('Rebuilt META-INF/container.xml')
    expect(source.repairedSourceBytes).toBeDefined()
    expect(source.epub.title).toBe('Sicheres Testbuch')
  })

  it('rebuilds a missing EPUB mimetype entry', () => {
    const entries = unzipSync(makeEpub())
    delete entries['mimetype']
    const source = openRepairableEpub(zipSync(entries))

    expect(source.repair?.actions.join(' ')).toContain('Rebuilt the required uncompressed EPUB mimetype entry')
    expect(unzipSync(source.repairedSourceBytes!)['mimetype']).toEqual(strToU8('application/epub+zip'))
  })

  it('refuses to guess between multiple valid OPF package documents', () => {
    const entries = unzipSync(makeEpub())
    delete entries['META-INF/container.xml']
    entries['ALT/second.opf'] = entries['OEBPS/content.opf']!

    expect(() => openRepairableEpub(zipSync(entries))).toThrowError(SecurityError)
    expect(() => openRepairableEpub(zipSync(entries))).toThrow(/more than one plausible OPF/u)
  })

  it('marks a manifest-order reading-order fallback as salvage', async () => {
    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fallback book</dc:title></metadata>
        <manifest><item id="chapter" href="chapter.xhtml"/></manifest>
        <spine><itemref idref="missing"/></spine>
      </package>`
    const result = await convertDocument(makeEpub({ packageXml }), 'fallback.epub')
    const output = unzipSync(result.archive)

    expect(result.summary.repair?.level).toBe('salvage')
    expect(result.summary.repair?.actions.join(' ')).toMatch(/Inferred application\/xhtml\+xml/u)
    expect(result.summary.repair?.actions.join(' ')).toMatch(/Reconstructed a 1-item reading order/u)
    expect(output['Fallback book.repair-report.md']).toBeDefined()
    expect(output['repair/Fallback book.repaired.epub']).toBeUndefined()
  })
})
