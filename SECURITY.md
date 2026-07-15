# Security policy

## Threat model

Book2Markdown assumes that every EPUB and PDF may be intentionally malicious. The application
has no backend, never uploads a document and ships with a Content Security Policy that blocks
all network connections.

The goal is to reduce exposure to common archive, XML, active-content and resource-exhaustion
attacks. This is defense in depth, not a proof that every future browser or parser vulnerability
is impossible.

## Enforced boundaries

### All documents

- Conversion runs in a dedicated Web Worker with cancellation and a 120-second watchdog.
- Input is capped at 80 MB and generated output at 300 MB.
- Untrusted HTML/Markdown is never rendered; the UI preview is plain text.
- The production CSP blocks `connect`, frames, objects, forms and non-local scripts.
- External and executable URL schemes are removed from Markdown output.

### EPUB

- A ZIP entry is capped at 25 MB, total unpacked data at 250 MB and entries at 5,000.
- Per-entry compression ratio is capped at 100:1.
- Absolute, ambiguous, traversal and case-colliding ZIP paths are rejected.
- XML entities and internal DTD subsets are rejected before parsing; inert legacy XHTML doctypes are stripped.
- Scripts, forms, frames, embedded objects and remote resources are omitted.
- PNG, JPEG, GIF and WebP assets are exported only after their signatures match the declared type.
- Standalone, inline and reading-order SVG are rebuilt from a passive allowlist. Scripts, event
  handlers, `foreignObject`, animation/filter elements, unsafe styles and external or embedded
  references are removed. Safe references to local signature-checked raster assets are rewritten.
- The visual companion EPUB is rebuilt from escaped text and generated passive XHTML. Source HTML,
  source stylesheets, scripts, forms, remote links and package metadata structures are not copied.
- The LLM instruction-pattern scan is advisory and non-destructive. It does not execute or remove
  book text and must not be treated as a complete prompt-injection detector.

### PDF

- The input must start with a PDF signature and may contain at most 2,000 pages.
- Extracted text is capped at 2 MB per page and 30 MB overall.
- PDF.js receives a local byte array; streaming, range loading and worker fetch are disabled.
- Rendering, XFA, system fonts, font-face loading, image decoding and WASM are disabled.
- Password-protected PDFs are rejected.
- Forms, annotations, attachments, JavaScript and images are not exported.

## Known limitations

- A Web Worker provides termination and UI isolation, but browsers do not expose a strict
  per-worker memory quota.
- PDF text order is heuristic because PDF stores positioned glyphs rather than semantic blocks.
- No OCR is performed; scanned pages produce a warning instead of text.
- Raster image decoders and the SVG renderer remain part of the consumer's eventual Markdown
  viewer, not this app. Sanitization reduces active-content risk but does not rasterize SVG.
- Caption and alt-text extraction cannot describe arbitrary visual meaning. The synchronized
  companion preserves the actual graphic so a multimodal consumer can inspect it.

For exceptionally hostile material, additionally use an updated disposable browser profile
or virtual machine.

## Reporting a vulnerability

Do not attach weaponized files to a public issue. Use the repository's private GitHub Security
Advisory flow and include the smallest non-sensitive reproduction possible.
