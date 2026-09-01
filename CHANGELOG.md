# Changelog

## 0.9.2 - 2026-09-01

- Added a subtle application version label beside the BookRefinery name in the main header.
- Sourced the displayed version from validated package metadata at build time so web and desktop
  editions cannot drift from the published package version.

## 0.9.1 - 2026-09-01

- Restored long Windows filenames inside the desktop sandbox instead of displaying DOS aliases such
  as `FINANZ~1.PDF`, while returning only the filename and never exposing the private source path.
- Passed the recovered source name consistently through preflight, conversion, password prompts,
  reports, and output naming without changing the selected source file.
- Improved PDF title fallback behavior for missing, generic, or DOS-alias metadata and cleaned
  catalog-style filenames into readable book titles.
- Updated PDF.js to a patched release for CVE-2026-16633; BookRefinery continues to use only its
  parser API without loading PDF.js viewer or scripting components.
- Refreshed audited transitive build dependencies after newly published advisories.
- Added desktop policy, title-selection, and PDF conversion regression tests for the affected cases.

## 0.9.0 - 2026-07-27

- Added bounded automatic repair for damaged EPUB and compressed FB2 ZIP containers with CRC
  verification, canonical reconstruction, and strict reuse of the normal archive security gate.
- Added safe EPUB package repair for missing `mimetype` or `container.xml` records and missing
  manifest media types, plus clearly labeled salvage for incomplete trailing entries or recovered
  manifest-order reading order.
- Added title-based repair reports and optional repaired source copies without modifying the input.
- Increased the sequential queue from 20 to 100 books so 20-book batches fit comfortably while
  retaining independent per-file security and worker limits.
- Replaced long dashes in BookRefinery-authored UI, documentation, and generated labels with ordinary
  hyphens while preserving punctuation that belongs to source book content.
- Reduced GitHub Actions token permissions and corrected the private security-report link.
- Updated Electron, Chromium, React, Vite, and the React build plugin to their current compatible
  patch releases.
- Added a repository-wide security audit and adversarial repair regression tests.

## 0.6.2 - 2026-07-17

- Added public GitHub noreply maintainer metadata required by Debian packages.

## 0.6.1 - 2026-07-17

- Replaced the Windows WebView2/Tauri wrapper with a bundled Electron runtime whose private session
  blocks every remote renderer request, disables background networking and updates, denies permissions,
  uses hardened Electron fuses, and exposes only a bounded user-mediated Save As bridge.
- Added real Save As behavior to the desktop edition and supporting Chromium browsers, plus a clearly
  reported download-folder fallback where the File System Access API is unavailable.
- Increased the bounded batch queue from 12 to 20 books while retaining sequential isolated conversion.
- Simplified output-profile explanations, marked NotebookLM as the recommended default, and clarified
  that RAG adds chunks, Markdown is the smallest package, and Archive includes every representation.
- Repaired incomplete embedded PDF Unicode maps deterministically from embedded glyph names, recorded
  repair counts in reports, and allowed bundled same-origin OCR assets through the otherwise closed CSP.
- Added the concrete PDF font-map regression corpus, native request/save policy tests, and Electron
  Windows/Linux packaging workflow.
- Fixed the hardened Electron executable lookup for Linux AppImage and Debian packaging.

## 0.4.0 - 2026-07-17

- Renamed the project from Book2Markdown to BookRefinery across the app, package, generated
  metadata, documentation, PWA, and repository links.
- Added isolated preflight inspection and a sequential 12-file batch workflow.
- Added NotebookLM, RAG, Readable Markdown, and Safe Archive profiles with exact output paths and
  formats visible before processing.
- Added profile-aware bundle filtering and deterministic SHA-256 `EXPORT-MANIFEST.json` records.
- Added opt-in, fully bundled English/German OCR for image-only PDF pages with explicit page,
  pixel, and runtime limits.
- Improved PDF column order, heading detection, page chunks, outline sections, and adaptive visual
  companion quality.
- Added an installable complete-offline PWA and expanded hostile-input/profile regression coverage.
- Repositioned the interface around local ebook sanitization and LLM preparation, added format-specific
  output guidance, a graphical `by leshxt` GitHub credit, and clearer success metrics.
- Added complete FictionBook 2 support for `.fb2` and single-document `.fb2.zip`, including sections,
  note bodies, cover art, embedded raster/SVG graphics, stable figure positions and the synchronized LLM package.
- Added bounded whole-page PDF rendering and a rebuilt searchable `document.sanitized.pdf`: passive
  page images preserve visual layout while a parser-tested Unicode layer keeps extracted source text machine-readable.
- Added stable `PAGE-xxxx` alignment between PDF Markdown and the sanitized companion, plus one-source NotebookLM guidance.
- Added the application screenshot to the README.
- Fixed EPUB conversion in the browser by removing a Node-only `process.env.LOG_PERF` access from the bundled HTML-to-Markdown dependency.
- Added a regression test for both development and production browser configuration.
- Added a synchronized multimodal EPUB export for NotebookLM and similar tools: normalized `book.md`, passive visual companion EPUB, stable figure IDs, figure index and import instructions.
- Made the sanitized visual EPUB the primary one-source NotebookLM recommendation; Markdown remains an optional text-retrieval fallback to avoid duplicate passages and citations.
- Preserved figure position, nearby text, alt text and `<figcaption>` content; unreferenced sanitized graphics now remain available in a labeled appendix.
- Retained safe cross-chapter reference meaning and removed only manifest-declared navigation boilerplate from the canonical LLM source.
- Added a non-destructive heuristic report for instruction-like passages that could be interpreted as prompt injection.

## 0.3.0 - 2026-07-14

- Switched the complete application interface and generated reports to English.
- Fixed EPUB 2 compatibility by stripping inert legacy XHTML doctypes while still rejecting entities and internal subsets.
- Added allowlist-based sanitization for standalone and inline SVG images.
- Added support for SVG and raster images used directly in the EPUB reading order.
- Preserved safe local raster references inside sanitized SVG files.
- Relaxed recoverable PDF parsing and extended the isolated worker timeout to 120 seconds.
- Added concrete error codes and expanded real-world compatibility tests.

## 0.2.0 - 2026-07-14

- Renamed the project from EPUB Safe Studio to Book2Markdown.
- Added local, text-only PDF-to-Markdown conversion with strict limits.
- Added PDF security and fidelity documentation.
- Expanded the interface and export summaries for EPUB and PDF.

## 0.1.0 - 2026-07-14

- Rewrote EPUB conversion around a disposable worker and strict archive limits.
- Added a local-first React interface and passive Markdown export.
- Added CSP, security tests, pinned CI and dependency automation.
