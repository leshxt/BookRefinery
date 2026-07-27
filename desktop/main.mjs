import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
} from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_ORIGIN,
  isAllowedExternalLink,
  isAllowedRendererRequest,
  isValidSaveRequest,
  safeSaveFilename,
} from './security-policy.mjs'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const rendererRoot = resolve(moduleDirectory, '..', 'dist')
const PRIVATE_PARTITION = 'bookrefinery-private'
const isSmokeTest = process.env['BOOKREFINERY_SMOKE_TEST'] === '1'
const smokePdfSource = process.env['BOOKREFINERY_SMOKE_PDF_SOURCE']
const smokePdfOutput = process.env['BOOKREFINERY_SMOKE_PDF_OUTPUT']
const smokeMarkdownOutput = process.env['BOOKREFINERY_SMOKE_MARKDOWN_OUTPUT']
const isPdfSmokeTest = Boolean(isSmokeTest && smokePdfSource && smokePdfOutput && smokeMarkdownOutput)

protocol.registerSchemesAsPrivileged([{
  scheme: 'bookrefinery',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    codeCache: true,
  },
}])

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gz', 'application/gzip'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json'],
])

app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-breakpad')
app.commandLine.appendSwitch('disable-client-side-phishing-detection')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-domain-reliability')
app.commandLine.appendSwitch('disable-sync')
app.commandLine.appendSwitch('metrics-recording-only')
app.commandLine.appendSwitch('no-default-browser-check')
app.commandLine.appendSwitch('no-first-run')
app.commandLine.appendSwitch('no-pings')
app.commandLine.appendSwitch(
  'disable-features',
  [
    'AutofillServerCommunication',
    'CertificateTransparencyComponentUpdater',
    'MediaRouter',
    'OptimizationHints',
    'PrivacySandboxSettings4',
    'Translate',
  ].join(','),
)
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND')
app.enableSandbox()

let mainWindow = null

function rendererPath(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (!isAllowedRendererRequest(rawUrl)) return null
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  const candidate = resolve(rendererRoot, pathname.replace(/^\/+/u, '') || 'index.html')
  const withinRoot = relative(rendererRoot, candidate)
  if (withinRoot.startsWith('..') || isAbsolute(withinRoot)) return null
  return candidate
}

async function packagedResponse(request) {
  if (isPdfSmokeTest && request.url === `${APP_ORIGIN}/__smoke__/source.pdf`) {
    const body = new Uint8Array(await readFile(smokePdfSource))
    if (body.byteLength > 80 * 1024 * 1024) return new Response('Source too large', { status: 413 })
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'X-Content-Type-Options': 'nosniff' },
    })
  }
  const smokeOutputPath = request.url === `${APP_ORIGIN}/__smoke__/output.pdf`
    ? smokePdfOutput
    : request.url === `${APP_ORIGIN}/__smoke__/output.md`
      ? smokeMarkdownOutput
      : undefined
  if (isPdfSmokeTest && request.method === 'PUT' && smokeOutputPath) {
    const body = new Uint8Array(await request.arrayBuffer())
    if (body.byteLength < 1 || body.byteLength > 300 * 1024 * 1024) {
      return new Response('Output rejected', { status: 413 })
    }
    await writeFile(smokeOutputPath, body, { flag: 'w' })
    return new Response('Saved', { status: 200 })
  }

  const path = rendererPath(request.url)
  if (!path) return new Response('Not found', { status: 404 })
  try {
    const extension = extname(path).toLocaleLowerCase('en-US')
    const contentType = mimeTypes.get(extension) ?? 'application/octet-stream'
    const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.txt', '.webmanifest'])
    const body = textExtensions.has(extension)
      ? await readFile(path, 'utf8')
      : new Uint8Array(await readFile(path))
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

async function savePreparedFile(event, request) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    !isAllowedRendererRequest(event.senderFrame?.url ?? '') ||
    !isValidSaveRequest(request)
  ) {
    throw new Error('Rejected invalid native save request.')
  }
  const suggestedName = safeSaveFilename(request.suggestedName)
  if (!suggestedName) throw new Error('Rejected unsafe save filename.')

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save prepared BookRefinery package',
    defaultPath: suggestedName,
    buttonLabel: 'Save',
    filters: [{ name: 'BookRefinery ZIP package', extensions: ['zip'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation', 'dontAddToRecent'],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  const outputPath = result.filePath.toLocaleLowerCase('en-US').endsWith('.zip')
    ? result.filePath
    : `${result.filePath}.zip`
  await writeFile(outputPath, new Uint8Array(request.data), { flag: 'w' })
  return { canceled: false }
}

function createMainWindow(isolatedSession) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 760,
    minHeight: 640,
    show: false,
    backgroundColor: '#08110f',
    title: 'BookRefinery',
    webPreferences: {
      preload: join(moduleDirectory, 'preload.cjs'),
      partition: PRIVATE_PARTITION,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      safeDialogs: true,
    },
  })
  mainWindow.setMenu(null)
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    if (isSmokeTest) console.error(`BOOKREFINERY_PRELOAD_ERROR=${preloadPath}: ${error.message}`)
  })
  mainWindow.once('ready-to-show', () => {
    if (!isSmokeTest) mainWindow?.show()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalLink(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererRequest(url)) event.preventDefault()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.once('did-finish-load', () => {
    if (!isSmokeTest || !mainWindow) return
    void (async () => {
      const pageState = await mainWindow?.webContents.executeJavaScript(
        `JSON.stringify({
          title: document.title,
          url: location.href,
          body: document.body.textContent?.slice(0, 160) ?? '',
          nativeBridge: typeof window.bookRefineryDesktop?.saveFile === 'function'
        })`,
        true,
      )
      console.error(`BOOKREFINERY_SMOKE_PAGE=${pageState}`)
      for (let attempt = 0; attempt < 1_200; attempt += 1) {
        const rawResult = await mainWindow?.webContents.executeJavaScript(
          'document.documentElement.dataset.desktopSmokeResult ?? ""',
          true,
        )
        if (typeof rawResult === 'string' && rawResult) {
          console.log(`BOOKREFINERY_SMOKE_RESULT=${rawResult}`)
          const result = JSON.parse(rawResult)
          const passed = (
            result.title === 'BookRefinery - Safe Ebook Preparation for LLMs' &&
            result.workspaceVisible === true &&
            result.nativeBridge === true &&
            (isPdfSmokeTest
              ? (
                  result.pdfRendered === true &&
                  result.repairedTextPages > 0 &&
                  result.repairedGlyphs > 100 &&
                  result.markdownSample.includes('Copyright © 2020 by Alexander Osterwalder')
                )
              : result.ocrInitialized === true)
          )
          app.exit(passed ? 0 : 1)
          return
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
      }
      console.error('BOOKREFINERY_SMOKE_RESULT={"error":"timeout"}')
      app.exit(1)
    })()
  })
  mainWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    if (!isSmokeTest) return
    console.error(`BOOKREFINERY_SMOKE_RESULT=${JSON.stringify({ errorCode, errorDescription })}`)
    app.exit(1)
  })
  const smokeHash = isPdfSmokeTest
    ? '#desktop-pdf-smoke-test'
    : isSmokeTest
      ? '#desktop-smoke-test'
      : ''
  void mainWindow.loadURL(`${APP_ORIGIN}/index.html${smokeHash}`)

  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRendererRequest(details.url) })
  })
}

app.whenReady().then(async () => {
  const isolatedSession = session.fromPartition(PRIVATE_PARTITION, { cache: false })
  await isolatedSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9',
    proxyBypassRules: '<-loopback>',
  })
  isolatedSession.setPermissionCheckHandler(() => false)
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  isolatedSession.setDevicePermissionHandler(() => false)
  await isolatedSession.protocol.handle('bookrefinery', packagedResponse)
  ipcMain.handle('bookrefinery:save-file', savePreparedFile)
  createMainWindow(isolatedSession)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(isolatedSession)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
