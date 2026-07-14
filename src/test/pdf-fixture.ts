function pdfString(value: string): string {
  return value.replace(/([\\()])/gu, '\\$1')
}

function contentStream(lines: readonly string[]): string {
  const commands = lines.map((line, index) => `${index === 0 ? '' : '0 -22 Td '}(${pdfString(line)}) Tj`).join(' ')
  return `BT /F1 12 Tf 72 720 Td ${commands} ET`
}

export function makePdf(pages: readonly (readonly string[])[] = [['Hallo PDF', 'Zweite Zeile']]): Uint8Array {
  const pageObjectStart = 4
  const contentObjectStart = pageObjectStart + pages.length
  const infoObject = contentObjectStart + pages.length
  const pageRefs = pages.map((_, index) => `${pageObjectStart + index} 0 R`).join(' ')
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
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
  objects.push('<< /Title (Test PDF) /Author (Ada Beispiel) >>')

  const header = '%PDF-1.4\n%Book2Markdown\n'
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
