function pdfString(value: string): string {
  return value.replace(/([\\()])/gu, '\\$1')
}

function contentStream(lines: readonly string[]): string {
  const commands = lines.map((line, index) => `${index === 0 ? '' : '0 -22 Td '}(${pdfString(line)}) Tj`).join(' ')
  return `BT /F1 12 Tf 72 720 Td ${commands} ET`
}

export interface PdfFixtureOptions {
  readonly outline?: readonly { readonly title: string; readonly page: number }[]
  readonly metadataTitle?: string | null
}

const PASSWORD_PDF_BASE64 =
  'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGMwMjJjMDA1ZmYxODFmODVkN2ZmZmI1MDVhMWZjOGFmNWU0NGJhNTU1NzVhZmRmMDI0NDI1ZWUzM2Y1OGQ1MTQ+Ci9UaXRsZSA8NzZkNjQ5MTg2YmU2ZWI2NmZlNTBlMjIwZjRhNGVmMjc2ZTJlYzk0MzRhYTUyMGFjODA1MWViZmZjNmEyNzM5Zj4KPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9Db3VudCAxCi9LaWRzIFsgNCAwIFIgXQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1Jlc291cmNlcyA8PAo+PgovTWVkaWFCb3ggWyAwLjAgMC4wIDYxMiA3OTIgXQovUGFyZW50IDIgMCBSCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9WIDUKL1IgNQovTGVuZ3RoIDI1NgovUCA0Mjk0OTY3MjkyCi9GaWx0ZXIgL1N0YW5kYXJkCi9PIDxmOGNhMDI4MDMwODUyNmFkNjhlNTQ5MDcyZDUyMGIwYTY3ODg4YTJmODZhZWJjMzNiYjU3YTZiMDM5YjU0NDJlMDA5ZjMyYjliNWUzMjgyMWQ1NzFkODk2NDZkZGUzYzM+Ci9VIDxmOGZjNDMwMmVlZjllMTBiNWYzNWU0OTE2MDNhNDg0YTU4YTg5MDk0NWJjMmI2M2FiZDYzODhlODkxZGI3MDY0NWVjNWExMWMwOTZlMTc4ZDBlODdkODQ4MjcyZmJkZjk+Ci9DRiA8PAovU3RkQ0YgPDwKL0F1dGhFdmVudCAvRG9jT3BlbgovQ0ZNIC9BRVNWMwovTGVuZ3RoIDMyCj4+Cj4+Ci9TdG1GIC9TdGRDRgovU3RyRiAvU3RkQ0YKL09FIDw1Njg4MGQyMzNhMjYwNDU1YWU1ODZlNzkwNTI5YTUzZDRiM2M3M2I0ZjFhZDg0OWU0MjliYzY1OGM2ZGFjYTM3PgovVUUgPDFjY2ZkZjdkYmYyMTNkNjUxODFlMzZiYmVhNjUyZjBiZjAzMjM0Y2QwYThlYWZiODJhYTAyYjQwN2I2YzA2M2U+Ci9QZXJtcyA8OTRkOTI3ZmZhZTZkNmZhNmNhODEzMTI1YmQyMjYyOGE+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDE4NyAwMDAwMCBuIAowMDAwMDAwMjQ2IDAwMDAwIG4gCjAwMDAwMDAyOTUgMDAwMDAgbiAKMDAwMDAwMDM4OSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDYzMzMzMzYzMzU2MjYyNjM2NTYyMzk2NDMzNjY2MTMzMzQzNjMxNjM2NDMwMzE2MjY1NjM2MTMyNjU2NDM5Mzk+IDw2MzMzMzM2MzM1NjI2MjYzNjU2MjM5NjQzMzY2NjEzMzM0MzYzMTYzNjQzMDMxNjI2NTYzNjEzMjY1NjQzOTM5PiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo5NDQKJSVFT0YK'

export function makePasswordPdf(): Uint8Array {
  const binary = globalThis.atob(PASSWORD_PDF_BASE64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function makePdf(
  pages: readonly (readonly string[])[] = [['Hallo PDF', 'Zweite Zeile']],
  options: PdfFixtureOptions = {},
): Uint8Array {
  const pageObjectStart = 4
  const contentObjectStart = pageObjectStart + pages.length
  const outlineRootObject = contentObjectStart + pages.length
  const outlineItemStart = outlineRootObject + 1
  const outline = options.outline?.filter((item) => item.page >= 1 && item.page <= pages.length) ?? []
  const infoObject = outline.length > 0
    ? outlineItemStart + outline.length
    : contentObjectStart + pages.length
  const pageRefs = pages.map((_, index) => `${pageObjectStart + index} 0 R`).join(' ')
  const catalogOutline = outline.length > 0 ? ` /Outlines ${outlineRootObject} 0 R` : ''
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R${catalogOutline} >>`,
    `<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  for (const [index] of pages.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectStart + index} 0 R >>`,
    )
  }
  for (const page of pages) {
    const stream = contentStream(page)
    objects.push(`<< /Length ${new TextEncoder().encode(stream).byteLength} >>\nstream\n${stream}\nendstream`)
  }
  if (outline.length > 0) {
    objects.push(
      `<< /Type /Outlines /First ${outlineItemStart} 0 R /Last ${outlineItemStart + outline.length - 1} 0 R /Count ${outline.length} >>`,
    )
    for (const [index, item] of outline.entries()) {
      const previous = index > 0 ? ` /Prev ${outlineItemStart + index - 1} 0 R` : ''
      const next = index < outline.length - 1 ? ` /Next ${outlineItemStart + index + 1} 0 R` : ''
      objects.push(
        `<< /Title (${pdfString(item.title)}) /Parent ${outlineRootObject} 0 R /Dest [${pageObjectStart + item.page - 1} 0 R /Fit]${previous}${next} >>`,
      )
    }
  }
  const metadataTitle = options.metadataTitle === undefined ? 'Test PDF' : options.metadataTitle
  objects.push(`<<${metadataTitle === null ? '' : ` /Title (${pdfString(metadataTitle)})`} /Author (Ada Beispiel) >>`)

  const header = '%PDF-1.4\n%BookRefinery\n'
  let body = header
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(body).byteLength)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }

  const xrefOffset = new TextEncoder().encode(body).byteLength
  const xrefEntries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefEntries}\n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObject} 0 R >>\n`
  body += `startxref\n${xrefOffset}\n%%EOF\n`

  return new TextEncoder().encode(body)
}
