import { strToU8, zipSync, type Zippable } from 'fflate'

interface EpubFixtureOptions {
  readonly chapter?: string
  readonly packageXml?: string
  readonly extraFiles?: Readonly<Record<string, Uint8Array>>
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const DEFAULT_PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Sicheres Testbuch</dc:title>
    <dc:creator>Ada Beispiel</dc:creator>
    <dc:language>de</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`

const DEFAULT_CHAPTER = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head>
<body><h1>Kapitel Eins</h1><p>Ein lokaler Text.</p><img src="cover.png" alt="Cover"/></body></html>`

const MINIMAL_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function makeEpub(options: EpubFixtureOptions = {}): Uint8Array {
  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(CONTAINER),
    'OEBPS/content.opf': strToU8(options.packageXml ?? DEFAULT_PACKAGE),
    'OEBPS/chapter.xhtml': strToU8(options.chapter ?? DEFAULT_CHAPTER),
    'OEBPS/cover.png': MINIMAL_PNG,
  }

  for (const [path, data] of Object.entries(options.extraFiles ?? {})) files[path] = data
  return zipSync(files, { level: 6 })
}
