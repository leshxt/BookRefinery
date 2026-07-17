# Third-party notices

BookRefinery is an independent, substantially rewritten derivative inspired by
[`uxiew/epub2MD`](https://github.com/uxiew/epub2MD). It is not affiliated with or
endorsed by the original project.

BookRefinery also uses Mozilla PDF.js (`pdfjs-dist`) under the Apache License 2.0
for local PDF parsing and text extraction. The package is used without its viewer,
network loading, form rendering or scripting features. See
[`mozilla/pdf.js`](https://github.com/mozilla/pdf.js) and the license distributed
with the npm package.
An exact copy is included at `THIRD_PARTY_LICENSES/PDF.js-LICENSE.txt`.

BookRefinery uses pdf-lib under the MIT License to build new passive visual PDF
companions from locally rendered JPEG page images. It does not copy the source
PDF object graph. See [`Hopding/pdf-lib`](https://github.com/Hopding/pdf-lib).
An exact copy is included at `THIRD_PARTY_LICENSES/pdf-lib-LICENSE.md`.

BookRefinery uses Tesseract.js and tesseract.js-core under the Apache License 2.0 for optional
local OCR. Exact license copies are included under `THIRD_PARTY_LICENSES/`. The bundled English
and German `@tesseract.js-data` packages are MIT-licensed and originate from
[`naptha/tessdata`](https://github.com/naptha/tessdata). Their package license is included at
`THIRD_PARTY_LICENSES/tesseract.js-data-LICENSE.txt`.

## epub2MD

MIT License

Copyright (c) 2021 ChandlerVer5

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
