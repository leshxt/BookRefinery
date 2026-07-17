import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ')

function productionCsp(): Plugin {
  return {
    name: 'bookrefinery-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const meta = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`
        return html.replace('<head>', `<head>\n    ${meta}`)
      },
    },
  }
}

function thirdPartyLicenses(): Plugin {
  return {
    name: 'bookrefinery-third-party-licenses',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'LICENSE',
        source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8'),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.md',
        source: readFileSync(new URL('./THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES/PDF.js-LICENSE.txt',
        source: readFileSync(new URL('./THIRD_PARTY_LICENSES/PDF.js-LICENSE.txt', import.meta.url), 'utf8'),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES/pdf-lib-LICENSE.md',
        source: readFileSync(new URL('./THIRD_PARTY_LICENSES/pdf-lib-LICENSE.md', import.meta.url), 'utf8'),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES/Tesseract.js-LICENSE.md',
        source: readFileSync(new URL('./node_modules/tesseract.js/LICENSE.md', import.meta.url), 'utf8'),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES/tesseract.js-core-LICENSE.txt',
        source: readFileSync(new URL('./node_modules/tesseract.js-core/LICENSE', import.meta.url), 'utf8'),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES/tesseract.js-data-LICENSE.txt',
        source: readFileSync(new URL('./THIRD_PARTY_LICENSES/tesseract.js-data-LICENSE.txt', import.meta.url), 'utf8'),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), productionCsp(), thirdPartyLicenses()],
  // node-html-markdown 2.0.0 reads this Node-only performance flag even in
  // its browser path. Replace the exact flag instead of exposing a process
  // polyfill inside the converter worker.
  define: {
    'process.env.LOG_PERF': 'false',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
