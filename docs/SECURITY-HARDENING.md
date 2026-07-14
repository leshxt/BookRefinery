# Security hardening and rewrite notes

Book2Markdown began as a security review of `uxiew/epub2MD` and became an independent rewrite.
The original project is small and useful, but its architecture was not designed for adversarial
documents. The changes below describe technical differences, not an allegation of malicious
intent in the upstream project.

The baseline inspected on 14 July 2026 was upstream commit
`87bebe47a077a43cbda333c8302c25ff589e9c9d`.

| Area | Baseline behavior | Book2Markdown |
|---|---|---|
| Dependency state | Frozen lock contained 16 production advisories during the audit | Current exact versions; npm audit is a required local and CI gate |
| ZIP handling | Whole archive synchronously expanded without resource limits | Size, count and compression-ratio checks plus a disposable worker |
| Archive paths | No dedicated canonical path boundary | Rejects traversal, absolute paths, backslashes and case collisions |
| XML | Entity processing remained reachable | Entities and DTD declarations rejected; entity processing disabled |
| Remote resources | Optional localization fetched referenced URLs | No network feature; production CSP uses `connect-src 'none'` |
| Active content | HTML became Markdown without a strict passive-output boundary | Scripts, frames, forms, SVG and dangerous URL schemes are removed |
| UI isolation | Command-line process only | Parsing worker can be cancelled and is terminated after 30 seconds |
| Preview | Not applicable | Plain-text preview; converted content never becomes DOM HTML |
| Supply chain | Release commands used dynamically resolved tooling | Exact lockfile, SHA-pinned Actions and Dependabot |
| Format scope | EPUB | EPUB plus text-based PDF |

## PDF-specific design

PDF support uses the maintained `pdfjs-dist` package but intentionally does not embed the PDF
viewer. The converter requests text content only. Network loading, XFA, rendering, fonts, images
and WASM are disabled, and the outer worker remains subject to the same watchdog as EPUB parsing.

This approach favors a smaller attack surface over visual fidelity. It will not reproduce page
layout and does not attempt OCR.

## Verification

The automated suite covers normal conversion plus traversal paths, duplicate archive names,
extreme compression, XML entities, active HTML, remote URLs and PDF text extraction. The full
gate is:

```text
npm run verify
```

That command runs tests, a strict TypeScript production build and the production dependency
audit.
