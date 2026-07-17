# BookRefinery

**Safe ebook preparation for NotebookLM, RAG, Markdown, and long-term archives — local,
multimodal, and built for untrusted input.**

BookRefinery is an installable browser app by [`leshxt`](https://github.com/leshxt). It inspects,
sanitizes, optionally OCRs, and restructures EPUB, FictionBook 2, and PDF ebooks without uploading
them. Searchable text remains connected to essential graphics and page visuals; scripts, remote
resources, forms, attachments, and active markup do not enter the prepared output.

![BookRefinery private ebook preparation workspace](docs/assets/bookrefinery-ui.png)

## What it prepares

| Input | Preserved output | Structure |
|---|---|---|
| EPUB 2/3 | Passive sanitized EPUB, Markdown, verified raster images, allowlist-sanitized SVG | Reading order, chapters, metadata, stable `FIG-xxxx` references |
| FictionBook 2 (`.fb2`, `.fb2.zip`) | The same multimodal book contract as EPUB | Sections, notes, cover art, embedded graphics |
| PDF | Page-faithful sanitized PDF, rebuilt searchable text layer, Markdown | Stable `PAGE-xxxx` files, detected headings and columns, optional outline sections |

Preflight runs in a disposable worker before conversion. It reports format, title, page or chapter
count, graphics, text coverage, decompressed size, warnings, and whether local OCR is recommended.
Up to 12 books can then be processed sequentially, each with independent limits and cancellation.

## Output profiles

The app shows these paths and file formats directly in the profile selector before processing.

### NotebookLM

- EPUB/FB2: `notebooklm/book.sanitized.epub`, optional `notebooklm/book.md`, import guidance,
  figure index, sanitized image fallbacks, security report, and JSON manifest.
- PDF: `notebooklm/document.sanitized.pdf`, optional `notebooklm/document.md`, import guidance,
  security report, and JSON manifest.

The sanitized EPUB or PDF is the primary one-source import. The Markdown file is a fallback, not a
second default upload, which avoids duplicate passages and competing citations.

### RAG / Knowledge Base

- `book.md` or `document.md`
- `chapters/*.md` or `pages/PAGE-*.md`
- the page-faithful searchable `notebooklm/document.sanitized.pdf` for PDF visual grounding
- PDF `sections/*.md` and `OUTLINE.md` when a usable outline exists
- sanitized `assets/*` plus the figure index for EPUB/FB2
- LLM-safety report, security report, and `EXPORT-MANIFEST.json`

### Readable Markdown

- one canonical `book.md` or `document.md`
- contextual sanitized graphics for EPUB/FB2
- the page-faithful searchable PDF companion for PDF visual grounding
- security report and checksum manifest

### Safe Archive

Every sanitized representation above in one reproducible ZIP.

`EXPORT-MANIFEST.json` inventories every selected output file with media type, byte size, and
SHA-256 checksum.

## Local OCR

OCR is opt-in and only runs on PDF pages without an extractable text layer. English and German
language data, the Tesseract WebAssembly runtime, and its worker are bundled with the application;
no model or language file is downloaded from a CDN. OCR text is written back into the normal
Markdown and searchable-PDF layers, so it does not become a disconnected duplicate source.

OCR is bounded to 30 pages, 90 million pixels, 4.5 million pixels per page, and a separate extended
worker timeout. Recognition is probabilistic: verify important passages against the preserved page
image.

## Start the app

Install [Node.js 24](https://nodejs.org/) and run:

```powershell
git clone https://github.com/leshxt/BookRefinery.git
cd BookRefinery
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

For the installable production version:

```powershell
npm run build
npm run preview
```

Open the preview URL, then use the browser's **Install BookRefinery** action. The production build
generates a versioned service worker that precaches the complete app, PDF runtime, OCR worker,
WebAssembly core, and English/German language data for subsequent offline use.

## Security model

BookRefinery treats every input as hostile:

- preflight and conversion run in disposable workers;
- ordinary conversion has a 120-second watchdog; opt-in OCR has a separate bounded timeout;
- every batch item receives independent path, archive, page, pixel, text, and output limits;
- ZIP paths, entry counts, sizes, compression ratios, XML entities, and DTDs are checked;
- PDF.js receives local bytes only; fetching, XFA, browser decoders, system fonts, and annotations
  are disabled;
- PDF output is rebuilt from bounded local page renderings and passive Unicode text, never copied
  from the original object graph;
- raster images are signature-checked and SVG is allowlist-sanitized;
- untrusted book HTML or Markdown is never rendered in the application;
- the production document CSP blocks connections and active embedding;
- every result contains security records and a SHA-256 output inventory.

See [SECURITY.md](SECURITY.md) for the threat model and
[docs/SECURITY-HARDENING.md](docs/SECURITY-HARDENING.md) for the upstream comparison.
“Hardened” is not an absolute guarantee; use a current browser and a disposable browser profile or
virtual machine for exceptionally hostile material.

## Development

```powershell
npm ci
npm run verify
```

`npm run verify` runs the unit/integration corpus, TypeScript build, production PWA build, and
high-severity production dependency audit. The test corpus includes deterministic malformed binary
inputs, archive traversal, XML entities, prompt-injection-like book passages, profile contracts,
manifest checksums, PDF text extraction, Unicode searchable PDFs, and layout heuristics.

## Project history

BookRefinery is an independent rewrite inspired by
[`uxiew/epub2MD`](https://github.com/uxiew/epub2MD). It was previously named Book2Markdown; the
broader name reflects that Markdown is now only one of several safe outputs. The original MIT notice
is preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

PDF parsing/rendering uses Mozilla PDF.js, passive PDF rebuilding uses pdf-lib, and optional local
OCR uses Tesseract.js with bundled English and German language data.

## License

MIT for the new project code. Third-party components retain their respective licenses.
