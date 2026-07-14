# Contributing

Thanks for helping improve Book2Markdown.

1. Create a focused branch from `main`.
2. Keep all document processing local and inside the converter worker.
3. Add a regression test for parser, path, limit or sanitization changes.
4. Run `npm run verify` before opening a pull request.

Do not add remote font, analytics, telemetry, CDN or document-upload dependencies. Any feature
that renders source HTML, PDF pages or generated Markdown needs an explicit security review.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of filing a public issue.
