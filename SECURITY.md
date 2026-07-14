# Security policy

EPUB Safe Studio treats every input as untrusted. The production app has no backend,
does not upload books and ships with a Content Security Policy that blocks all network
connections.

## Enforced boundaries

- Conversion runs in a dedicated Web Worker with a 20-second watchdog and cancellation.
- Input is capped at 80 MB, an entry at 25 MB and total unpacked data at 250 MB.
- Archives are capped at 5,000 entries and a 100:1 per-entry compression ratio.
- Absolute, ambiguous, traversal and case-colliding ZIP paths are rejected.
- XML DTD and entity declarations are rejected before parsing.
- Scripts, forms, frames, embedded objects, SVG and remote resources are omitted.
- Only signature-checked PNG, JPEG, GIF and WebP assets are exported.
- Untrusted HTML/Markdown is never rendered by the application; the preview is plain text.

These controls reduce the attack surface; they are not a formal guarantee against every
unknown browser, decompressor or image-decoder vulnerability. For exceptionally hostile
material, additionally use an up-to-date browser profile or disposable virtual machine.

## Reporting a vulnerability

Do not include weaponized EPUB files in a public issue. Open a private security advisory
on the eventual GitHub repository and include the smallest non-sensitive reproduction.
