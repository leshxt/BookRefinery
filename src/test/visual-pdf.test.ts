import { PDFArray, PDFDocument, PDFName } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { VisualPdfBuilder } from '../core/visual-pdf'

const TEST_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAGADASIAAhEBAxEB/8QAGQABAAMBAQAAAAAAAAAAAAAAAAYHCQgF/8QANBAAAQIFAgQCBwkBAAAAAAAAAgEDAAQFBhIHEQgTFCIhMQkVFiY0QlIjJTIzUWFyc5OS/8QAHAEAAgICAwAAAAAAAAAAAAAAAAQBCAIDBQYH/8QAKBEAAgECBQMDBQAAAAAAAAAAAAECAxEEBSExcQYSYUFRgRQiYvDx/9oADAMBAAIRAxEAPwBCEIXKZCEIQAIQhABnfCEIbLVCEIk2nemd16tXKxb9nUCeuKru4r08iyp8sFMQ5jhfhbbQjBFcNRAck3VICUr6IjMI0x4d/RHfBVrWKtfQ97LUN3+s8Jma/wBWzBlP0IH4z01Ms5jT/UCv27KVqRuSRp02bMrWKbMNPS86xvu08JNOOAmYKJKGaqCqol3CqRBslSlBJyW53VCEIVKoCEIQAIQj1bZtWsXlVW6bRKdMVOdPZeVLgpYipIORL5CKKSbkSoib+KpAZwhOpJQgrt7JaszaiTad6Z3Xq1crFv2dQJ64qu7ivTyLKnywUxDmOF+FttCMEVw1EByTdUjQvh39Ed8FWtYq19D3stQ3f6zwmZr/AFbMGU/Qgfizb647OH/hHtobP0po0jdE0xgvQWuYNSGaAyPMmJ7YkecJrb7QEeNSaUXFFfGGrlslQsu6o7IrLh39Ed8FWtYq19D3stQ3f6zwmZr/AFbMGU/Qgfizb647OH/hHtobP0po0jdE0xgvQWuYNSGaAyPMmJ7YkecJrb7QEeNSaUXFFfGM89feNHVXiN5spcte6C3j293aKJS0gu3LXvHJTe72hcTnGeJKuGKLtFGwEutGGlJfJeWvvGjqrxG82UuWvdBbx7e7tFEpaQXblr3jkpvd7QuJzjPElXDFF2ijYQiRVycnds0QhCPVtm1axeVVbptEp0xU509l5UuCliKkg5EvkIopJuRKiJv4qkKFVoQnUkoQV29ktWeVHq2zatYvKqt02iU6Yqc6ey8qXBSxFSQciXyEUUk3IlRE38VSOlNNODL8ifvae+k/VFPP+JYuu/8AYkIfsouRK7g4g9ONGaUlEs+Rl6s63ivT0lRCXyxbTJyY2XMlD5k5iqobEqL4xl2+53rDdLSo01is4qqhT9nrN8L+vwRTTTgy/In72nvpP1RTz/iWLrv/AGJCH7KLkSu4OIPTjRmlJRLPkZerOt4r09JUQl8sW0ycmNlzJQ+ZOYqqGxKi+Mc16i66XfqdmzVaj09NLb7skUVqX+Ve5N1U+4EJM1LZd9tvKK/ib22N0+o8JlcXRyKh2v1qS1m+FsvnT8Ucw6+8aOqvEbzZS5a90FvHt7u0USlpBduWveOSm93tC4nOM8SVcMUXaKNhCGD2lycndsQhCAxEIQgA0VlHglppl1xhuabbMTJh5SQHERd1ElFULZfJdlRfHwVI7EmuJPTjS+1ZKSs+kdU66y0/6ulBFkWiIG/iHu7J3BdlVOYuTaiSovjHG0IVTsV0yvOsTk8an0qj3Tt9zSbXHPm68Fgai66XfqdmzVaj09NLb7skUVqX+Ve5N1U+4EJM1LZd9tvKK/hCIOJxOKr4yo62Im5Sfq3f94EIQgFjO+EIQ2WqEIQgAQhCAD//2Q=='

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

describe('passive visual PDF builder', () => {
  it('rebuilds page images into a new PDF without source objects', async () => {
    const builder = await VisualPdfBuilder.create({ title: 'Visual test', author: 'Ada Example' })
    await builder.addJpegPage(decodeBase64(TEST_JPEG), 595, 842)
    await builder.addJpegPage(decodeBase64(TEST_JPEG), 612, 792)
    const output = await builder.save()
    const verificationOutput = process.env['VISUAL_PDF_OUTPUT']
    if (verificationOutput) await writeFile(verificationOutput, output)
    const document = await PDFDocument.load(output)

    expect(output.slice(0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))
    expect(document.getPageCount()).toBe(2)
    expect(document.getTitle()).toBe('Visual test')
    expect(document.getAuthor()).toBe('Ada Example')
    expect(document.catalog.get(PDFName.of('Names'))).toBeUndefined()
    expect(document.getPages().every((page) => {
      const annotations = page.node.get(PDFName.of('Annots'))
      return annotations === undefined || (annotations instanceof PDFArray && annotations.size() === 0)
    })).toBe(true)
  })
})
