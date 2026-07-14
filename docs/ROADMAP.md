# Roadmap

Book2Markdown aims to become a focused, local ebook-to-Markdown converter without weakening
its privacy and hostile-input boundaries.

## Current: 0.3

- Hardened EPUB 2/3 conversion
- Signature-checked raster graphics and allowlist-sanitized SVG, including visual spine items
- Text-based PDF conversion
- Chapter/page separation and security report
- Local browser UI with no backend

## Candidates for the next releases

- Better PDF paragraph, column and heading heuristics
- Optional chapter splitting based on PDF outlines
- Batch conversion with independent limits per document
- Reproducible downloadable desktop packaging
- More adversarial corpus and fuzz testing
- Optional safe PDF figure or page-image extraction after a dedicated rendering threat review

## Investigations

- Opt-in, fully local OCR for scanned PDFs in a second disposable worker
- Additional open ebook formats where parsing can remain local and dependency risk stays small
- A safe plugin boundary for custom Markdown cleanup rules

OCR and new formats will not ship merely as UI toggles. Each requires a threat model, size and
time limits, dependency review and hostile-input regression tests.
