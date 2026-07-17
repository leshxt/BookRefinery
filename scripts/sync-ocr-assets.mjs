import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const publicRoot = join(root, 'public', 'ocr')
const coreSource = join(root, 'node_modules', 'tesseract.js-core')
const coreTarget = join(publicRoot, 'core')
const languageTarget = join(publicRoot, 'lang')

await mkdir(coreTarget, { recursive: true })
await mkdir(languageTarget, { recursive: true })
await copyFile(
  join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  join(publicRoot, 'worker.min.js'),
)

const coreFiles = await readdir(coreSource)
for (const name of coreFiles) {
  if (/^tesseract-core(?:-[a-z]+)*(?:\.wasm)?\.js$/u.test(name) || /^tesseract-core(?:-[a-z]+)*\.wasm$/u.test(name)) {
    await copyFile(join(coreSource, name), join(coreTarget, name))
  }
}

for (const language of ['eng', 'deu']) {
  await copyFile(
    join(root, 'node_modules', '@tesseract.js-data', language, '4.0.0', `${language}.traineddata.gz`),
    join(languageTarget, `${language}.traineddata.gz`),
  )
}

console.log('Synchronized bundled English and German OCR assets.')
