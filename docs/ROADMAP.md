# Roadmap

Book2Markdown aims to become a focused, local ebook-sanitization and LLM-preparation studio
without weakening its privacy and hostile-input boundaries. Markdown remains an important
portable output, but not the product's only destination.

## Current: unreleased

- Hardened EPUB 2/3 conversion
- Signature-checked raster graphics and allowlist-sanitized SVG, including visual spine items
- Text-based PDF conversion
- Searchable sanitized PDF companion with stable page IDs and a rebuilt Unicode text layer
- Plain and compressed FictionBook 2 conversion with the same multimodal image contract as EPUB
- Chapter/page separation and security report
- Local browser UI with no backend
- Synchronized Markdown + sanitized visual EPUB package with stable figure IDs for multimodal notebooks
- Normalized LLM hierarchy, figure index, navigation de-duplication and instruction-like-content report

## Candidates for the next releases

- Better PDF paragraph, column and heading heuristics
- Optional chapter splitting based on PDF outlines
- Batch conversion with independent limits per document
- Reproducible downloadable desktop packaging
- More adversarial corpus and fuzz testing
- Better adaptive quality and performance for very large sanitized PDF companions
- Optional fully local OCR for text inside EPUB figures, provided language data and resource use can remain bounded
- Optional local visual descriptions for diagrams after a privacy-preserving model and threat review

## Investigations

- Opt-in, fully local OCR for scanned PDFs in a second disposable worker
- Additional open ebook formats where parsing can remain local and dependency risk stays small
- A safe plugin boundary for custom Markdown cleanup rules

OCR and new formats will not ship merely as UI toggles. Each requires a threat model, size and
time limits, dependency review and hostile-input regression tests.
