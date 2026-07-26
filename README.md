# BookRefinery

![BookRefinery logo](docs/assets/bookrefinery-wordmark-card.png)

**Safe ebook preparation for NotebookLM, RAG, Markdown, and long-term archives — local,
multimodal, and built for untrusted input.**

BookRefinery is a local browser and native desktop app by [`leshxt`](https://github.com/leshxt). It
inspects, sanitizes, optionally OCRs, and restructures EPUB, FictionBook 2, and PDF ebooks without
uploading them. Searchable text remains connected to essential graphics and page visuals; scripts,
remote resources, forms, attachments, and active markup do not enter the prepared output.

![BookRefinery private ebook preparation workspace](docs/assets/bookrefinery-ui.png)

## What it prepares

| Input | Preserved output | Structure |
|---|---|---|
| EPUB 2/3 | Passive sanitized EPUB, Markdown, verified raster images, allowlist-sanitized SVG | Reading order, chapters, metadata, stable `FIG-xxxx` references |
| FictionBook 2 (`.fb2`, `.fb2.zip`) | The same multimodal book contract as EPUB | Sections, notes, cover art, embedded graphics |
| PDF | Page-faithful sanitized PDF, rebuilt searchable text layer, Markdown | Stable `PAGE-xxxx` files, detected headings and columns, optional outline sections |

Preflight runs in a disposable worker before conversion. It reports format, title, page or chapter
count, graphics, text coverage, decompressed size, warnings, and whether local OCR is recommended.
Up to 20 books can then be queued and processed sequentially, each with independent limits and
cancellation. Sequential conversion keeps large PDF batches from exhausting memory.

## Selectable outputs and presets

NotebookLM, RAG, Markdown Workspace, and Safe Archive are shortcut buttons. After choosing one, every
output group can still be enabled or disabled independently:

| Output group | Best for | Contains |
|---|---|---|
| Sanitized visual source | NotebookLM, multimodal chat, visual verification | A passive EPUB or high-quality PDF with selectable text aligned to the original figures/pages |
| Complete Markdown | Obsidian, editing, Git, simple LLM uploads | One complete `.md` file with stable chapter, page, and figure identifiers |
| Retrieval chunks | RAG, embeddings, knowledge bases | `chapters/*.md` or `pages/PAGE-*.md`, plus PDF outline sections when available |
| Visual assets | Visual RAG and figure auditing | Sanitized EPUB/FB2 images plus a figure-to-context index; for PDF, the page-faithful sanitized PDF |

Generated file and ZIP names come from the analyzed book title, for example
`The Invincible Company.sanitized.pdf`, `The Invincible Company.md`, and
`The Invincible Company-notebooklm.zip`. Every bundle also contains title-based security and
SHA-256 manifest files.

For NotebookLM, the sanitized EPUB or PDF remains the recommended single-source upload. Select
Complete Markdown only as a fallback when the target tool cannot use the visual source or text
retrieval is insufficient; uploading both by default can create duplicate passages and citations.

## Local OCR

OCR is opt-in and only runs on PDF pages without an extractable text layer. English and German
language data, the Tesseract WebAssembly runtime, and its worker are bundled with the application;
no model or language file is downloaded from a CDN. OCR text is written into the normal Markdown
and position-aligned selectable PDF layers, so it does not become a disconnected duplicate source.

OCR is bounded to 30 pages, 90 million pixels, 4.5 million pixels per page, and a separate extended
worker timeout. Recognition is probabilistic: verify important passages against the preserved page
image.

Before OCR, BookRefinery also repairs incomplete embedded PDF font maps from their local glyph names.
This recovers deterministic character mappings such as stylistic alternate letters without guessing
or rasterizing otherwise extractable text. The generated security report records repaired pages and
character counts.

## Start the app

Install [Node.js 24](https://nodejs.org/) and run:

```powershell
git clone https://github.com/leshxt/BookRefinery.git
cd BookRefinery
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

### Install as a desktop app

Native packages are published on the
[GitHub Releases page](https://github.com/leshxt/BookRefinery/releases):

- **Windows:** download the `BookRefinery-...-win-x64.exe` NSIS installer.
- **Linux:** download the `.AppImage` for a portable launch or the `.deb` package for Debian/Ubuntu.

The desktop edition bundles its own current Electron/Chromium runtime instead of using Microsoft
WebView2. Its private renderer session denies every remote request, DNS is mapped to failure,
background networking and component updates are disabled, and there is no app updater, telemetry,
remote code, or backend. The only native renderer bridge opens a user-triggered **Save As** dialog
for a bounded generated ZIP. Document parsing still runs in the same disposable sandboxed workers.

This makes the installer larger than the former WebView wrapper, but it gives BookRefinery control
over the exact runtime and removes the observed WebView2 configuration request. The initial community
packages are not code-signed, so Windows may display a SmartScreen warning.

For Chrome and Edge, BookRefinery also remains installable as an offline-capable PWA. Build and serve
the web production version:

```powershell
npm run build
npm run preview
```

Open the preview URL, then use the visible **Install browser app** button once the browser reports
that the app is installable. Firefox desktop does not currently provide manifest-based PWA
installation; use a native package there instead. The installed PWA gets its own window and launcher
icon.

The production build generates a versioned service worker that precaches the complete app, PDF
runtime, OCR worker, WebAssembly core, and English/German language data for subsequent offline use.

To build the native package from source:

```powershell
npm ci
npm run desktop:build:windows
```

Use `npm run desktop:build:linux` on Linux. `npm run verify:desktop` checks the web application,
desktop request/save boundary, production build, and all npm dependencies.

Linux bundles are built on Ubuntu 22.04 in the release workflow for a stable glibc baseline.
Pushing a `desktop-v*` tag, or manually starting **Build desktop installers**, creates a prerelease
with the Windows NSIS installer, Linux AppImage, and Debian package.

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
- the desktop renderer additionally rejects non-packaged requests before the network stack can use them;
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

Native changes additionally run syntax, request-policy, IPC/save-boundary, and dependency checks in CI.

## Project history

BookRefinery is an independent rewrite inspired by
[`uxiew/epub2MD`](https://github.com/uxiew/epub2MD). It was previously named Book2Markdown; the
broader name reflects that Markdown is now only one of several safe outputs. The original MIT notice
is preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

PDF parsing/rendering uses Mozilla PDF.js, passive PDF rebuilding uses pdf-lib, and optional local
OCR uses Tesseract.js with bundled English and German language data.

## License

MIT for the new project code. Third-party components retain their respective licenses.
