# Security policy

## Threat model

BookRefinery assumes that every EPUB, FB2 and PDF may be intentionally malicious. The application
has no backend, never uploads a document and ships with a Content Security Policy that blocks all
application-originated network connections.

The goal is to reduce exposure to common archive, XML, active-content and resource-exhaustion
attacks. This is defense in depth, not a proof that every future browser or parser vulnerability
is impossible.

### Native desktop wrapper

- Windows and Linux packages use a minimal Tauri wrapper around the same production web build.
- The Rust layer registers no custom commands and loads no file-system, shell, network, dialog,
  updater, telemetry, or storage plugin.
- The Tauri capability list is explicitly empty. The frontend receives no native file or process
  permissions through IPC.
- HTML5 drag and drop is kept enabled on Windows by disabling Tauri's native file-drop interception;
  selected files still arrive as bounded browser `File` objects.
- The service worker is not registered inside the native wrapper. All executable app assets are
  bundled with the installer.
- The Windows WebView2 instance requests disabled background networking, DNS prefetching, component
  updates, crash reporting, domain reliability, sync, first-run traffic, metrics upload, and
  hyperlink auditing. Host resolution is mapped to failure and an unreachable loopback proxy is
  configured as additional defense in depth. Bundled custom-protocol resources do not need DNS or
  the proxy.
- Those WebView2 command-line switches are not a complete network security boundary. In a live
  Windows test, the current shared WebView2 runtime still contacted Microsoft's Experimentation and
  Configuration Service during startup. The app CSP independently rejects frontend requests, no
  document bytes are passed to the runtime service, and BookRefinery does not modify machine-wide
  WebView2 policy or firewall settings.
- Release actions are pinned to exact commits. Windows and Linux builds are produced independently
  on their native GitHub-hosted runners.

## Enforced boundaries

### All documents

- Preflight and conversion run in disposable Web Workers. Ordinary conversion has a 120-second
  watchdog; opt-in OCR has a separate bounded timeout because language initialization is heavier.
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

### FictionBook 2

- Plain `.fb2` and single-document `.fb2.zip` input are supported; compressed input inherits all
  ZIP path, count, size and compression-ratio boundaries used for EPUB.
- FB2 XML is capped at 50 MB. DTD and entity declarations are rejected before parsing.
- UTF-8, UTF-16, Windows-1251 and Windows-1252/Latin-1 declarations are allowlisted; other declared
  encodings are rejected instead of guessed.
- Each Base64 binary is capped at 25 MB decoded and all decoded binaries at 100 MB total.
- Duplicate or unsafe binary identifiers are rejected. Unsupported embedded binary types are omitted.
- PNG, JPEG, GIF and WebP signatures are checked; SVG uses the same passive allowlist sanitizer as EPUB.
- Sections, nested sections, note bodies, internal note references, poems, tables, cover images and image
  positions are converted to passive output. External link targets are removed.
- The NotebookLM companion is rebuilt as generated EPUB XHTML; source FB2 XML is never copied into it.

### PDF

- The input must start with a PDF signature and may contain at most 2,000 pages.
- Extracted text is capped at 2 MB per page and 30 MB overall.
- PDF.js receives a local byte array; streaming, range loading and worker fetch are disabled.
- XFA, system fonts, font-face loading, browser image decoding and WASM are disabled.
- Password-protected PDFs are rejected.
- Up to 500 pages and 240 million total output pixels may be rendered into the sanitized companion.
  Individual source images are capped at 20 million pixels and temporary canvases at 64 MB.
- Annotation rendering is disabled. Forms, links, attachments, annotations and JavaScript are not copied.
- Every page is flattened to JPEG and embedded in a newly created PDF, then paired with an invisible
  searchable Unicode layer rebuilt from locally extracted text. No source font or content object is copied.
  If every page cannot be rendered within the limits, no partial sanitized PDF is exported.
- Optional OCR runs only on pages without useful extracted text. English and German worker, core and
  language assets ship with the app and are loaded from the same origin; no OCR service or CDN is used.
- OCR is capped at 30 attempted pages, 4.5 million pixels per page and 90 million pixels in total.
  Recovered text enters the normal Markdown and sanitized PDF text layers.

## Known limitations

- A Web Worker provides termination and UI isolation, but browsers do not expose a strict
  per-worker memory quota.
- A native wrapper adds the operating system WebView and Tauri runtime to the trusted computing
  base. Keeping IPC capabilities empty limits the impact, but does not remove WebView, Rust, build
  pipeline, or installer vulnerabilities.
- On Windows, the shared WebView2 runtime may make its own Microsoft configuration request even
  though BookRefinery's application code has no network capability. This is separate from document
  processing and means the native process tree should not be described as physically offline.
- Community Windows installers are currently unsigned and may trigger SmartScreen. GitHub release
  assets should be downloaded only from the official repository and verified before execution.
- The current Tauri Linux dependency graph inherits informational RustSec warnings for unmaintained
  GTK3 Rust bindings and `RUSTSEC-2024-0429` in `glib 0.18`. The affected
  `VariantStrIter` API is not called by BookRefinery or the downloaded Tauri dependency sources, but
  it remains part of the Linux trusted computing base until Tauri's WebKitGTK stack migrates. CI
  reports informational advisories and fails on vulnerability advisories.
- PDF text order is heuristic because PDF stores positioned glyphs rather than semantic blocks.
- OCR is opt-in and may contain recognition errors. It does not replace extractable source text and
  currently supports the bundled English and German models only.
- Raster image decoders and the SVG renderer remain part of the consumer's eventual Markdown
  viewer, not this app. Sanitization reduces active-content risk but does not rasterize SVG.
- Caption and alt-text extraction cannot describe arbitrary visual meaning. The synchronized
  companion preserves the actual graphic so a multimodal consumer can inspect it.

For exceptionally hostile material, additionally use an updated disposable browser profile
or virtual machine.

## Reporting a vulnerability

Do not attach weaponized files to a public issue. Use the repository's private GitHub Security
Advisory flow and include the smallest non-sensitive reproduction possible.
