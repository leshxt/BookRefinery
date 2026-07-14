# Book2Markdown

**Convert EPUB and PDF ebooks to clean Markdown — locally, with untrusted input in mind.**

Book2Markdown is a browser-based converter with no backend and no upload. The document
stays on the device, parsing runs in a disposable worker, and the production build cannot
make network connections.

## Supported formats

| Input | Output | Notes |
|---|---|---|
| EPUB 2/3 | `book.md`, individual chapters, safe image assets | Preserves signature-checked raster images and allowlist-sanitized SVG |
| Text-based PDF | `document.md`, separated by page | Extracts text only; no forms, attachments, scripts or images |

Scanned PDFs need OCR, which is intentionally not part of the current release. PDF is a
layout format, so complex columns, tables and reading order may require manual cleanup.

## Start the app

Install [Node.js 24](https://nodejs.org/) and run:

```powershell
git clone https://github.com/leshxt/Book2Markdown.git
cd Book2Markdown
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

For a production-like run:

```powershell
npm run build
npm run preview
```

The static build is written to `dist/`. Keep the generated Content Security Policy intact
when hosting it.

## What the export contains

EPUB exports contain:

- `book.md` with the complete book;
- one Markdown file per text or visual spine item under `chapters/`;
- signature-checked PNG, JPEG, GIF and WebP assets under `assets/`;
- sanitized standalone and inline SVG assets, including safe local raster references;
- `SECURITY-REPORT.md` with enforced limits and removed content.

PDF exports contain `document.md` plus the security report. Images, file attachments,
annotations, forms and embedded JavaScript are not exported.

## Security model

Book2Markdown treats every input as hostile:

- all parsing happens in a dedicated worker with a 120-second watchdog;
- the production CSP includes `connect-src 'none'`;
- ZIP paths, entry counts, sizes and compression ratios are checked before EPUB extraction;
- XML entities and internal DTD subsets are rejected; inert legacy XHTML doctypes are stripped;
- PDF.js receives local bytes only, with fetching, rendering, XFA, system fonts and WASM disabled;
- untrusted HTML or Markdown is never rendered in the application;
- SVG scripts, event handlers, remote or embedded sources, active elements and unsafe styles are removed;
- only passive Markdown, signature-checked raster files and allowlist-sanitized SVG leave the converter.

See [SECURITY.md](SECURITY.md) for the threat model and
[docs/SECURITY-HARDENING.md](docs/SECURITY-HARDENING.md) for the changes compared with the
original project. Future format and OCR ideas are tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

“Hardened” is not an absolute security guarantee. Keep the browser updated; use a disposable
browser profile or virtual machine for exceptionally hostile material.

## Development

```powershell
npm ci
npm run test
npm run build
npm run audit
```

`npm run verify` runs all gates. CI uses SHA-pinned GitHub Actions, and Dependabot checks npm
and workflow dependencies weekly.

## Project history

Book2Markdown is an independent rewrite inspired by
[`uxiew/epub2MD`](https://github.com/uxiew/epub2MD). The original MIT notice is preserved in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). PDF parsing is powered by Mozilla PDF.js
under Apache-2.0.

## License

MIT for the new project code. Third-party components retain their respective licenses.
