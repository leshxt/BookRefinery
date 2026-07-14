import { useReducer, useRef, type SVGProps } from 'react'
import type { ConversionProgress, ConversionResult } from './core/convert'
import type { SecurityErrorCode } from './core/errors'
import { formatBytes, SECURITY_POLICY } from './core/policy'
import { runConversion, WorkerConversionError } from './worker/runConversion'

type AppState =
  | { readonly kind: 'idle'; readonly dragging: boolean }
  | { readonly kind: 'ready'; readonly dragging: boolean; readonly file: File }
  | { readonly kind: 'running'; readonly dragging: false; readonly file: File; readonly progress: ConversionProgress }
  | { readonly kind: 'success'; readonly dragging: boolean; readonly file: File; readonly result: ConversionResult }
  | { readonly kind: 'error'; readonly dragging: boolean; readonly file: File | null; readonly code: SecurityErrorCode; readonly message: string }

type AppAction =
  | { readonly type: 'drag'; readonly active: boolean }
  | { readonly type: 'select'; readonly file: File }
  | { readonly type: 'start' }
  | { readonly type: 'progress'; readonly progress: ConversionProgress }
  | { readonly type: 'success'; readonly result: ConversionResult }
  | { readonly type: 'failure'; readonly file: File | null; readonly code: SecurityErrorCode; readonly message: string }
  | { readonly type: 'cancelled' }
  | { readonly type: 'reset' }

const initialState: AppState = { kind: 'idle', dragging: false }

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'drag':
      return state.kind === 'running' ? state : { ...state, dragging: action.active }
    case 'select':
      return { kind: 'ready', dragging: false, file: action.file }
    case 'start':
      return state.kind === 'ready'
        ? { kind: 'running', dragging: false, file: state.file, progress: { percent: 2, label: 'Reading the file' } }
        : state
    case 'progress':
      return state.kind === 'running' ? { ...state, progress: action.progress } : state
    case 'success':
      return state.kind === 'running'
        ? { kind: 'success', dragging: false, file: state.file, result: action.result }
        : state
    case 'failure':
      return { kind: 'error', dragging: false, file: action.file, code: action.code, message: action.message }
    case 'cancelled':
      return state.kind === 'running' ? { kind: 'ready', dragging: false, file: state.file } : state
    case 'reset':
      return initialState
  }
}

function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 2.6 20 6v5.5c0 5.1-3.3 8.7-8 10-4.7-1.3-8-4.9-8-10V6l8-3.4Z" fill="currentColor" opacity=".18" />
      <path d="m8.4 12 2.2 2.2 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 2.6 20 6v5.5c0 5.1-3.3 8.7-8 10-4.7-1.3-8-4.9-8-10V6l8-3.4Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function UploadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19.5h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function selectError(file: File): { readonly code: SecurityErrorCode; readonly message: string } | null {
  if (file.size === 0) return { code: 'INVALID_DOCUMENT', message: 'The selected file is empty.' }
  if (file.size > SECURITY_POLICY.maxInputBytes) {
    return { code: 'LIMIT_EXCEEDED', message: 'The file exceeds the 80 MB input limit.' }
  }
  return null
}

function fileBadge(file: File): string {
  return file.name.toLocaleLowerCase('en-US').endsWith('.pdf') ? 'PDF' : 'EPUB'
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const controllerRef = useRef<AbortController | null>(null)

  const selectFile = (file: File | undefined): void => {
    if (!file || state.kind === 'running') return
    const error = selectError(file)
    if (error) {
      dispatch({ type: 'failure', file, code: error.code, message: error.message })
      return
    }
    dispatch({ type: 'select', file })
  }

  const startConversion = async (): Promise<void> => {
    if (state.kind !== 'ready') return
    const file = state.file
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'start' })

    try {
      const result = await runConversion(
        file,
        (progress) => dispatch({ type: 'progress', progress }),
        controller.signal,
      )
      dispatch({ type: 'success', result })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        dispatch({ type: 'cancelled' })
      } else {
        const code = error instanceof WorkerConversionError ? error.code : 'CONVERSION_FAILED'
        const message = error instanceof WorkerConversionError ? error.message : 'The file could not be converted safely.'
        dispatch({ type: 'failure', file, code, message })
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }

  const cancelConversion = (): void => {
    controllerRef.current?.abort()
  }

  const retryRejectedFile = (): void => {
    if (state.kind === 'error' && state.file) dispatch({ type: 'select', file: state.file })
  }

  const downloadResult = (): void => {
    if (state.kind !== 'success') return
    const archiveBuffer = new ArrayBuffer(state.result.archive.byteLength)
    new Uint8Array(archiveBuffer).set(state.result.archive)
    const blob = new Blob([archiveBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = state.result.filename
    anchor.click()
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  const currentFile = state.kind === 'idle' ? null : state.file

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Book2Markdown — skip to main content">
          <span className="brand-mark"><ShieldIcon /></span>
          <span>Book2<strong>Markdown</strong></span>
        </a>
        <div className="local-badge"><span />100% local</div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="eyebrow"><ShieldIcon /> EPUB &amp; PDF · hardened local conversion</div>
          <h1 id="hero-title">Ebooks in.<br /><span>Markdown out.</span></h1>
          <p className="hero-copy">
            Convert EPUB and PDF ebooks locally into clean Markdown. No uploads, no remote loading,
            no active HTML — just your document in an isolated worker with strict safety limits.
          </p>

          <div className="trust-row" aria-label="Security features">
            <span><i>01</i> Network blocked</span>
            <span><i>02</i> Resource limits</span>
            <span><i>03</i> Graphics preserved safely</span>
          </div>
        </section>

        <section className="studio-card" aria-label="Ebook conversion">
          <div className="studio-heading">
            <div>
              <p className="section-label">Local studio</p>
              <h2>Choose an ebook</h2>
            </div>
            <span className="limit-label">max. 80 MB</span>
          </div>

          <label
            className={`dropzone ${state.dragging ? 'is-dragging' : ''} ${state.kind === 'running' ? 'is-disabled' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); dispatch({ type: 'drag', active: true }) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); dispatch({ type: 'drag', active: false }) }}
            onDrop={(event) => {
              event.preventDefault()
              dispatch({ type: 'drag', active: false })
              selectFile(event.dataTransfer.files[0])
            }}
          >
            <input
              type="file"
              accept=".epub,.pdf,application/epub+zip,application/pdf"
              disabled={state.kind === 'running'}
              onChange={(event) => {
                selectFile(event.currentTarget.files?.[0])
                event.currentTarget.value = ''
              }}
            />
            <span className="upload-orbit"><UploadIcon /></span>
            <strong>{state.dragging ? 'Drop it here' : 'Drop an EPUB or PDF here'}</strong>
            <span>or click to choose an ebook</span>
          </label>

          {currentFile && (
            <div className="file-row">
              <div className="file-icon">{fileBadge(currentFile)}</div>
              <div className="file-details">
                <strong>{currentFile.name}</strong>
                <span>{formatBytes(currentFile.size)} · stays on this device</span>
              </div>
              {state.kind !== 'running' && (
                <button className="text-button" type="button" onClick={() => dispatch({ type: 'reset' })}>Remove</button>
              )}
            </div>
          )}

          <div className="status-region" aria-live="polite">
            {state.kind === 'ready' && (
              <button className="primary-button" type="button" onClick={() => void startConversion()}>
                <ShieldIcon /> Convert safely
              </button>
            )}

            {state.kind === 'running' && (
              <div className="progress-panel">
                <div className="progress-copy">
                  <div><span className="spinner" /><strong>{state.progress.label}</strong></div>
                  <span>{state.progress.percent} %</span>
                </div>
                <progress className="progress-track" value={state.progress.percent} max={100}>
                  {state.progress.percent} %
                </progress>
                <button className="text-button" type="button" onClick={cancelConversion}>Cancel</button>
              </div>
            )}

            {state.kind === 'error' && (
              <div className="message error-message" role="alert">
                <span>!</span>
                <div><strong>File rejected · {state.code}</strong><p>{state.message}</p></div>
                {state.file && <button type="button" onClick={retryRejectedFile}>Try again</button>}
              </div>
            )}

            {state.kind === 'success' && (
              <div className="result-panel">
                <div className="result-title">
                  <span className="success-mark"><ShieldIcon /></span>
                  <div><p className="section-label">Safely exported</p><h3>{state.result.summary.title}</h3></div>
                </div>
                <div className="metrics">
                  <div><strong>{state.result.summary.units}</strong><span>{state.result.summary.unitLabel}</span></div>
                  <div><strong>{state.result.summary.assets}</strong><span>images</span></div>
                  <div><strong>{formatBytes(state.result.summary.outputBytes)}</strong><span>export</span></div>
                </div>
                {state.result.summary.warnings.length > 0 && (
                  <details className="warnings">
                    <summary>{state.result.summary.warnings.length} conversion warning(s)</summary>
                    <ul>{state.result.summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </details>
                )}
                <button className="primary-button" type="button" onClick={downloadResult}>
                  <DownloadIcon /> Download Markdown bundle
                </button>
                <details className="preview">
                  <summary>Show text preview</summary>
                  <pre>{state.result.preview}</pre>
                </details>
              </div>
            )}
          </div>
        </section>

        <section className="security-grid" aria-labelledby="security-title">
          <div className="security-intro">
            <p className="section-label">Threat model</p>
            <h2 id="security-title">Distrust is<br />a feature.</h2>
            <p>Suspicious parts are removed or quarantined before active content can reach the interface.</p>
          </div>
          <article><span>01</span><h3>Isolated worker</h3><p>Conversion runs away from the UI and is terminated after 120 seconds.</p></article>
          <article><span>02</span><h3>Strict resource limits</h3><p>Paths, sizes, compression ratios, page counts, text volume, and runtime are bounded.</p></article>
          <article><span>03</span><h3>Sanitized graphics</h3><p>Raster images are signature-checked; SVG scripts, events, remote sources, and active elements are stripped.</p></article>
        </section>
      </main>

      <footer>
        <span>Book2Markdown · Open Source · MIT</span>
        <span>Processing happens entirely in your browser</span>
      </footer>
    </div>
  )
}
