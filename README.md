# EPUB Safe Studio

A local-first, hardened EPUB-to-Markdown converter with a modern React interface. It is an
independent rewrite inspired by [`uxiew/epub2MD`](https://github.com/uxiew/epub2MD), designed
for EPUB files that should not be trusted.

## Why a rewrite?

The security boundary is architectural rather than cosmetic: parsing happens in a disposable
Web Worker, the production page cannot make network connections, archives are inspected under
strict resource limits, and active content never reaches the rendered UI.

The export is a ZIP containing:

- `book.md` with the complete book;
- individual Markdown files under `chapters/`;
- signature-checked raster images under `assets/`;
- `SECURITY-REPORT.md` documenting removals and enforced limits.

## Run locally

Requirements: a current Node.js release supported by Vite 8.

```bash
npm install
npm run dev
```

Production verification:

```bash
npm run verify
```

The static production build is written to `dist/` and can be served by any static host. Keep
the generated Content Security Policy intact.

## Security model

See [SECURITY.md](SECURITY.md). This project deliberately rejects some malformed, encrypted,
DRM-protected, unusually large or exotic EPUBs. “Hardened” is not the same as “infallible”;
keep the browser updated when processing hostile files.

## License and attribution

New code is available under the MIT License. Original-project attribution is preserved in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
