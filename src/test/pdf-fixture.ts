function pdfString(value: string): string {
  return value.replace(/([\\()])/gu, '\\$1')
}

function contentStream(lines: readonly string[]): string {
  const commands = lines.map((line, index) => `${index === 0 ? '' : '0 -22 Td '}(${pdfString(line)}) Tj`).join(' ')
  return `BT /F1 12 Tf 72 720 Td ${commands} ET`
}

export interface PdfFixtureOptions {
  readonly outline?: readonly { readonly title: string; readonly page: number }[]
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
  objects.push('<< /Title (Test PDF) /Author (Ada Beispiel) >>')

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
