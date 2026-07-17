# Security hardening and rewrite notes

BookRefinery began as a security review of `uxiew/epub2MD` and became an independent rewrite.
The original project is small and useful, but its architecture was not designed for adversarial
documents. The changes below describe technical differences, not an allegation of malicious
intent in the upstream project.

The baseline inspected on 14 July 2026 was upstream commit
`87bebe47a077a43cbda333c8302c25ff589e9c9d`.

| Area | Baseline behavior | BookRefinery |
|---|---|---|
| Dependency state | Frozen lock contained 16 production advisories during the audit | Current exact versions; npm audit is a required local and CI gate |
| ZIP handling | Whole archive synchronously expanded without resource limits | Size, count and compression-ratio checks plus a disposable worker |
| Archive paths | No dedicated canonical path boundary | Rejects traversal, absolute paths, backslashes and case collisions |
| XML | Entity processing remained reachable | Entities and DTD declarations rejected; entity processing disabled |
| Remote resources | Optional localization fetched referenced URLs | No network feature; CSP permits only bundled same-origin OCR assets and the desktop session rejects every remote request |
| Active content | HTML became Markdown without a strict passive-output boundary | Scripts, frames, forms and dangerous URL schemes are removed; SVG is rebuilt from a passive allowlist |
| UI isolation | Command-line process only | Disposable preflight/conversion workers; ordinary jobs stop after 120 seconds and bounded opt-in OCR has a separate timeout |
| Preview | Not applicable | Plain-text preview; converted content never becomes DOM HTML |
| Supply chain | Release commands used dynamically resolved tooling | Exact lockfile, SHA-pinned Actions and Dependabot |
| Image handling | Referenced files could pass through without format-specific sanitization | Raster signatures are verified; SVG scripts, events, active elements and unsafe references are stripped |
| LLM ingestion | No dedicated output contract | NotebookLM, RAG, readable Markdown and safe-archive profiles declare their exact files before processing; stable IDs synchronize text and visuals |
| Format scope | EPUB | EPUB 2/3, FictionBook 2 and PDF with synchronized text/visual outputs |

## PDF-specific design

PDF support uses the maintained `pdfjs-dist` package but intentionally does not embed its viewer.
The converter extracts text and renders pages to bounded offscreen canvases with annotations
disabled. Network loading, XFA, system fonts, browser image decoders and WASM are disabled, and
the outer worker remains subject to the same watchdog as ebook parsing. `pdf-lib` then builds a
new document containing the JPEG page renderings plus a non-rendering Unicode text layer generated
from PDF.js extraction; the original object graph, content streams and fonts are not copied.
Incomplete embedded Unicode tables are repaired conservatively from the PDF font's own glyph-name
differences before Markdown or the searchable layer is generated; unknown names are never guessed.

This sandwich design preserves visible page content and placement while keeping text searchable for
LLM ingestion and discarding source links, forms, scripts, attachments and annotations. The generated
Unicode CMaps are parser-tested. Optional English/German OCR runs only for pages without useful
extractable text, uses bundled same-origin worker/core/language assets, and writes recovered text into
the same Markdown and rebuilt PDF text layers rather than creating a disconnected duplicate.

PDF text order is reconstructed from positioned glyphs with bounded line grouping, two-column reading
order, dehyphenation and heading heuristics. Page-level Markdown is always emitted for retrieval
profiles; usable source outlines additionally produce a stable outline map and section files. Page
render scale and JPEG quality adapt to the remaining page/pixel budget, but the converter never exports
a partial visual companion.

## Export integrity and profiles

Every profile is an explicit allowlist over the converter's complete safe intermediate output. The UI
shows the exact paths, formats and optional files for the selected input format before a job starts.
Every saved ZIP includes `SECURITY-REPORT.md` and a deterministic `EXPORT-MANIFEST.json` whose
SHA-256 entries cover every other exported file.

## FB2-specific design

FictionBook is parsed as ordered XML so sections, notes and images retain their document position.
DTD/entity declarations and unsupported encodings are rejected. Embedded Base64 data is decoded
under individual and aggregate limits, raster signatures are verified and SVG is sanitized. The
same canonical Markdown and rebuilt visual EPUB contract used for EPUB is then generated from the
safe intermediate representation; source XML is never copied to the companion.

## SVG-specific design

SVG is XML and can also be active web content. BookRefinery therefore never copies an SVG
verbatim. It parses the file with entity processing disabled, keeps only passive drawing, text,
gradient, clipping and grouping elements, filters attributes and styles, and rewrites references
only when they resolve to a signature-checked local raster asset. Unsupported nodes are removed
with a warning; a malformed or structurally unsafe SVG is omitted without rejecting otherwise
convertible book content.

## Multimodal companion design

The visual companion is not the source EPUB with a new filename. It is a new EPUB containing only
generated XHTML, fixed local CSS and assets that already passed the raster signature check or SVG
allowlist sanitizer. Figure IDs appear at matching reading positions in the visual document and
canonical Markdown. Packaged graphics without a surviving spine reference are placed in a labeled
appendix so sanitization does not silently discard potentially meaningful information.

## Verification

The automated suite covers normal conversion plus traversal paths, duplicate archive names,
extreme compression, XML entities, legacy EPUB 2 doctypes, active HTML, hostile SVG, visual SVG
spine items, FB2 notes/images/Base64 mismatches, remote URLs, PDF text extraction and searchable PDF
rebuilding. It also includes seeded unknown-binary fuzz cases, profile/manifest contracts, PDF
layout/outline regression fixtures and PWA asset-integrity checks. The full
gate is:

```text
npm run verify
```

That command runs tests, a strict TypeScript production build and the production dependency
audit.
