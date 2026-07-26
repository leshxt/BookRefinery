# Roadmap

BookRefinery is a local ebook-inspection, sanitization, OCR, and LLM-preparation studio. Markdown is
one portable output, not the product boundary.

## 0.4 — Refinery workflow

- [x] Isolated preflight with format, metadata, structure, text coverage, graphics, and warnings
- [x] Four output profiles with exact paths and file formats visible before processing
- [x] Batch queue for up to 20 books with independent workers, limits, progress, and cancellation
- [x] Persistent per-item results, add-more flow, individual Save As, and combined Save As
- [x] Default-on bundled English/German full-book OCR with exact textless-page preflight and page, pixel, and runtime budgets
- [x] Ephemeral per-file password prompt for PDFs that require local unlocking
- [x] Improved PDF line grouping, column reading order, de-hyphenation, and heading heuristics
- [x] Stable PDF page files plus outline-derived section files and outline index
- [x] Adaptive sanitized-PDF render scale and JPEG quality under a global pixel budget
- [x] Installable production PWA with a versioned complete offline cache
- [x] Bundled Windows/Linux desktop runtime with remote-request denial and a narrow Save As bridge
- [x] Deterministic adversarial corpus, fuzz rejection, profile tests, and SHA-256 export manifests

## Existing foundations

- Hardened EPUB 2/3 and FictionBook 2 conversion
- Signature-checked raster graphics and allowlist-sanitized SVG
- Searchable sanitized PDF companion with rebuilt Unicode text
- Synchronized Markdown and visual ebook packages with stable figure/page identifiers
- Navigation de-duplication and instruction-like-content reporting
- Local browser UI with no backend

## Future investigations

- Additional bundled OCR languages without making the default install excessively large
- Optional local visual descriptions after a privacy, model-size, and hallucination review
- More advanced PDF table reconstruction without inventing structure
- Reproducible signed native wrappers once there is a release-signing process
- Additional open ebook formats whose parsers can meet the same hostile-input boundary

New formats and models require a threat model, explicit limits, dependency review, offline
packaging, and hostile-input regression tests before they become selectable.
