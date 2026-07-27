# Security audit - 2026-07-27

## Executive summary

This review covered the BookRefinery 0.9.0 candidate based on main commit
`556229ab46a05c7ac336fc211d4d4c25e12ab4c5`. The scope included application and worker code,
EPUB/FB2/PDF parsing boundaries, the new repair parser, output construction, the Electron wrapper,
build scripts, locked dependencies, Git history, GitHub Actions, releases, and live repository
security settings.

No critical or high-severity vulnerability was identified. No malware behavior, embedded credential,
unexpected application network client, arbitrary code execution primitive, or known npm advisory was
found. This is an evidence-based review, not a guarantee that every future parser or browser flaw is
impossible.

## Findings

| ID | Severity | Status | Finding |
|---|---|---|---|
| BR-01 | Medium | Open | GitHub Dependabot alerts and automatic security updates are disabled even though weekly dependency-update configuration exists. CI audits the current lockfile, but a new advisory on an unchanged dependency will not create a security alert or pull request. |
| BR-02 | Medium | Open | GitHub private vulnerability reporting is disabled. The repository link was corrected from the former project name, but the private advisory form will remain unavailable until the repository setting is enabled. |
| BR-03 | Low | Open | GitHub code scanning has no analysis. TypeScript, adversarial tests, manual review, and dependency audits provide meaningful coverage, but CodeQL would add an independent static-analysis layer. |
| BR-04 | Low | Open | Repository Actions policy allows all actions and does not enforce SHA pinning. Every current action reference is pinned to an exact 40-character commit, so this is a policy-enforcement gap rather than a current unpinned dependency. |
| BR-05 | Medium | Accepted for now | Windows and Linux packages are not code-signed. HTTPS release transport and GitHub-hosted immutable release assets help, but users cannot verify publisher identity through the operating system. |
| BR-06 | Informational | Upstream | The desktop packaging tree contains deprecated transitive packages through `electron-builder`. They are development-only and both production and full-tree npm audits currently report zero vulnerabilities. |

The open GitHub settings were inspected but not changed during this code audit. Enabling them affects
repository-wide policy and notification behavior and should be an explicit maintainer action.

## Remediation included in 0.9.0

- Updated Electron to 43.2.0 and its newer Chromium runtime, plus current compatible React, Vite,
  and React-plugin patch releases.
- Reduced normal CI permissions to `contents: read`.
- Reduced the release workflow to `contents: read` by default and grants `contents: write` only to
  the tag release job.
- Corrected the private security-report link to the BookRefinery repository.
- Added bounded archive repair that can only follow generic structural ZIP failure. Existing unsafe
  path, expansion, ratio, XML, and policy failures cannot enter the repair fallback.
- Added declared-size checks before decompression, bounded inflate output, CRC verification,
  duplicate/path rejection, total entry accounting including directory records, explicit unsupported
  compression errors, and ambiguity refusal.
- Added deterministic tests for truncated ZIP end records, missing directories, incomplete trailing
  entries, unsupported methods, data-descriptor ambiguity, unsafe paths, missing EPUB package
  records, duplicate OPF candidates, and reading-order salvage.

## Existing controls verified

### Untrusted document boundary

- File size is rejected before queue processing and rechecked inside inspection and conversion.
- Every preflight and conversion runs in a disposable worker with a watchdog and cancellation.
- Archive entry count, individual size, total expanded size, compression ratio, normalized path,
  path collision, XML declaration, DTD/entity, SVG node, image signature, page, pixel, text, and
  output limits are enforced.
- Untrusted book HTML and Markdown are converted to passive data and never rendered in the UI.
- Repair never overwrites the input and always emits a report. Partial reconstruction is labeled
  salvage rather than silently treated as complete.
- PDF.js receives local bytes with remote loading, annotations, XFA, browser decoders, and system
  fonts disabled. Generated PDFs are rebuilt from bounded local renderings and passive Unicode text.

### Desktop boundary

- Electron uses sandboxing, context isolation, disabled Node integration, a private cacheless
  session, a packaged custom protocol, denied permissions, blocked navigation, and an exact external
  GitHub link allowlist.
- Renderer requests are rejected before network access. DNS is mapped to failure and an unreachable
  loopback proxy provides an additional boundary.
- The only preload bridge validates a bounded ZIP and invokes a validated, user-mediated Save As
  operation.
- Electron fuses require ASAR integrity and disable `RunAsNode`, `NODE_OPTIONS`, and CLI inspection.
- No updater, telemetry, crash reporter, backend, or general network client is present.

### Supply chain and repository

- All direct dependency versions are exact and all 426 locked package URLs resolve to
  `registry.npmjs.org`.
- All current GitHub Actions are pinned to exact commit SHAs.
- Main has an active ruleset that prevents deletion and non-fast-forward updates, requires pull
  requests, requires resolved review threads, and requires strict `verify` and `desktop` checks.
- Secret scanning and push protection are enabled. The secret-scanning alerts endpoint returned zero
  alerts.
- No tracked symbolic link, submodule, current-tree credential candidate, or history credential
  candidate was found.

## Verification evidence

| Check | Result |
|---|---|
| Clean dependency install | 367 packages installed from the exact lockfile |
| Production npm audit | 0 vulnerabilities |
| Full dependency-tree npm audit | 0 vulnerabilities |
| Unit and integration suite | 76 passed, 1 skipped; 2 environment-specific test files skipped |
| TypeScript and production PWA build | Passed |
| Desktop syntax, request-policy, and save-boundary tests | 6 passed |
| Real damaged `Hooked - How to Build Habit-Forming Products.epub` | Repaired and converted successfully |
| Browser UI and real repair preflight | Passed with no error overlay or console error |
| Packaged Windows desktop smoke test | Custom protocol, sandboxed renderer, native bridge, and bundled local OCR passed |
| Microsoft Defender custom scans | No threats found in the project tree or built 0.9.0 installer; signatures updated 2026-07-27 |
| Tracked-tree secret patterns | 0 candidate files |
| Git history secret patterns | 0 candidate matches across 37 commits |
| Action SHA audit | 0 unpinned action references |
| Git object integrity | No corrupt object reported |

## Limitations

- This was a focused source, dependency, configuration, and dynamic regression review, not a formal
  proof or paid third-party penetration test.
- Parser dependencies and the bundled Chromium runtime remain part of the trusted computing base and
  require ongoing patch updates.
- OCR accuracy, PDF semantic reading order, and repaired book completeness are correctness concerns,
  not properties that a security audit can guarantee.
- Unsigned community installers should be downloaded only from the official repository until a
  signing and provenance process exists.
