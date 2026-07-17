import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from 'vite'

const root = fileURLToPath(new URL('../..', import.meta.url))
const manifestPath = fileURLToPath(new URL('../../public/manifest.webmanifest', import.meta.url))
const serviceWorkerBuilderPath = fileURLToPath(new URL('../../scripts/build-service-worker.mjs', import.meta.url))
const ocrSyncPath = fileURLToPath(new URL('../../scripts/sync-ocr-assets.mjs', import.meta.url))

describe('installable offline application contract', () => {
  it('ships a standalone BookRefinery manifest and maskable icon', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      readonly name: string
      readonly display: string
      readonly start_url: string
      readonly icons: readonly { readonly src: string; readonly purpose: string }[]
    }

    expect(manifest.name).toBe('BookRefinery')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('./')
    expect(manifest.icons.some((icon) =>
      icon.src === 'bookrefinery-192.png' && icon.purpose.includes('maskable'))).toBe(true)
    expect(manifest.icons.some((icon) =>
      icon.src === 'bookrefinery-512.png' && icon.purpose.includes('maskable'))).toBe(true)
  })

  it('builds a versioned complete precache and bundles OCR assets locally', async () => {
    const [serviceWorkerBuilder, ocrSync] = await Promise.all([
      readFile(serviceWorkerBuilderPath, 'utf8'),
      readFile(ocrSyncPath, 'utf8'),
    ])

    expect(serviceWorkerBuilder).toContain("filesUnder(dist)")
    expect(serviceWorkerBuilder).toContain("cache.addAll(precacheUrls)")
    expect(serviceWorkerBuilder).toContain("bookrefinery-")
    expect(serviceWorkerBuilder).toContain("versionHash.update(await readFile(fileURLToPath(import.meta.url)))")
    expect(serviceWorkerBuilder).toContain("versionHash.update(await readFile(path))")
    expect(ocrSync).toContain("['eng', 'deu']")
    expect(ocrSync).toContain('`${language}.traineddata.gz`')
    expect(ocrSync).toContain("tesseract.js-core")
  })

  it('keeps the production document network-closed while allowing local workers and manifests', async () => {
    const config = await resolveConfig({ root }, 'build')
    const transform = config.plugins.find((plugin) => plugin.name === 'bookrefinery-csp')

    expect(transform).toBeDefined()
    const configSource = await readFile(fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), 'utf8')
    expect(configSource).toContain("\"connect-src 'none'\"")
    expect(configSource).toContain("\"worker-src 'self' blob:\"")
    expect(configSource).toContain("\"manifest-src 'self'\"")
  })
})
