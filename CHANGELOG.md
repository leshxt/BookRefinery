# Changelog

## Unreleased

- Added complete FictionBook 2 support for `.fb2` and single-document `.fb2.zip`, including sections,
  note bodies, cover art, embedded raster/SVG graphics, stable figure positions and the synchronized LLM package.
- Added bounded whole-page PDF rendering and a rebuilt passive `document.visual.pdf` so photographs,
  diagrams, vectors, tables and layout remain available without copying source PDF active objects.
- Added stable `PAGE-xxxx` alignment between PDF Markdown and the visual companion, plus one-source NotebookLM guidance.
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
