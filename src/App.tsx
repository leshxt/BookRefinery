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

function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="currentColor" d="M12 2.25a9.75 9.75 0 0 0-3.08 19c.49.09.67-.21.67-.47v-1.9c-2.73.59-3.31-1.16-3.31-1.16-.45-1.13-1.09-1.43-1.09-1.43-.89-.61.07-.6.07-.6.98.07 1.5 1.01 1.5 1.01.87 1.5 2.29 1.06 2.85.81.09-.63.34-1.06.62-1.3-2.18-.25-4.47-1.09-4.47-4.82 0-1.06.38-1.93 1.01-2.61-.1-.25-.44-1.24.1-2.58 0 0 .82-.26 2.68 1a9.29 9.29 0 0 1 4.88 0c1.86-1.26 2.68-1 2.68-1 .54 1.34.2 2.33.1 2.58.63.68 1.01 1.55 1.01 2.61 0 3.74-2.3 4.57-4.48 4.81.35.31.66.91.66 1.84v2.7c0 .26.18.57.67.47A9.75 9.75 0 0 0 12 2.25Z" />
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
  const name = file.name.toLocaleLowerCase('en-US')
  if (name.endsWith('.pdf')) return 'PDF'
  if (name.endsWith('.fb2') || name.endsWith('.fb2.zip')) return 'FB2'
  return 'EPUB'
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
  const resultMetrics = state.kind === 'success'
    ? [
        { label: state.result.summary.unitLabel, value: state.result.summary.units.toLocaleString('en-US') },
        state.result.summary.format === 'pdf'
          ? { label: 'searchable text', value: formatBytes(state.result.summary.processedBytes) }
          : { label: 'graphics', value: state.result.summary.assets.toLocaleString('en-US') },
        { label: 'export', value: formatBytes(state.result.summary.outputBytes) },
      ]
    : []

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to Main Content</a>
      <header className="topbar">
        <div className="brand-lockup">
          <a className="brand" href="#main" aria-label="Book2Markdown — go to the converter">
            <span className="brand-mark"><ShieldIcon /></span>
            <span className="brand-name" translate="no">Book2<strong>Markdown</strong></span>
          </a>
          <a
            className="creator-link"
            href="https://github.com/leshxt"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit leshxt on GitHub"
          >
            <GitHubIcon /><span>by <strong translate="no">leshxt</strong></span>
          </a>
        </div>
        <div className="local-badge"><span aria-hidden="true" />100% local</div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="eyebrow"><ShieldIcon /> Local ebook sanitizer · EPUB, FB2 &amp; PDF</div>
          <h1 id="hero-title">Books in.<br /><span>Safe sources out.</span></h1>
          <p className="hero-copy">
            Sanitize ebooks locally into structured, multimodal source packages for NotebookLM and other
            LLMs. Text stays searchable, essential graphics stay in context, and active content stays out.
          </p>

          <div className="trust-row" aria-label="Product guarantees">
            <span><i>01</i> Never uploaded</span>
            <span><i>02</i> Text &amp; visuals synchronized</span>
            <span><i>03</i> LLM-ready exports</span>
          </div>
        </section>

        <section className="outcomes" aria-labelledby="outcomes-title">
          <div className="outcomes-heading">
            <p className="section-label">What You Get</p>
            <h2 id="outcomes-title">One local workflow.<br />Three useful outputs.</h2>
          </div>
          <div className="outcome-grid">
            <article>
              <span>EPUB / FB2</span>
              <h3>Sanitized Visual Ebook</h3>
              <p>Rebuilt reading order with verified raster graphics, cleaned SVG, and stable figure positions.</p>
            </article>
            <article>
              <span>PDF</span>
              <h3>Searchable Sanitized PDF</h3>
              <p>Page-faithful visuals plus rebuilt Unicode text, without source scripts, forms, or attachments.</p>
            </article>
            <article>
              <span>LLM Prep</span>
              <h3>Structured Context</h3>
              <p>NotebookLM guidance, optional Markdown, stable FIG/PAGE references, and a security report.</p>
            </article>
          </div>
        </section>

        <section className="studio-card" aria-label="Ebook preparation">
          <div className="studio-heading">
            <div>
              <p className="section-label">Private Workspace</p>
              <h2>Prepare an Ebook</h2>
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
              name="ebook"
              aria-label="Choose an EPUB, FB2, compressed FB2, or PDF ebook"
              accept=".epub,.fb2,.fb2.zip,.pdf,application/epub+zip,application/x-fictionbook+xml,application/pdf"
              disabled={state.kind === 'running'}
              onChange={(event) => {
                selectFile(event.currentTarget.files?.[0])
                event.currentTarget.value = ''
              }}
            />
            <span className="upload-orbit"><UploadIcon /></span>
            <strong>{state.dragging ? 'Drop it here' : 'Drop an EPUB, FB2 or PDF here'}</strong>
            <span>or choose a local file</span>
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
                <ShieldIcon /> Prepare Safe Sources
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
                  <div><p className="section-label">Safely Prepared</p><h3>{state.result.summary.title}</h3></div>
                </div>
                <div className="metrics">
                  {resultMetrics.map((metric) => (
                    <div key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></div>
                  ))}
                </div>
                {state.result.summary.warnings.length > 0 && (
                  <details className="warnings">
                    <summary>{state.result.summary.warnings.length} conversion warning(s)</summary>
                    <ul>{state.result.summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </details>
                )}
                {(state.result.summary.format === 'epub' || state.result.summary.format === 'fb2') && (
                  <div className="llm-ready-note">
                    <strong>NotebookLM-ready visual ebook included</strong>
                    <span>Start with <code>notebooklm/book.sanitized.epub</code>. It already contains the text and sanitized graphics in reading order; <code>book.md</code> is an optional text-only fallback.</span>
                  </div>
                )}
                {state.result.summary.format === 'pdf' && state.result.summary.assets > 0 && (
                  <div className="llm-ready-note">
                    <strong>NotebookLM-ready searchable PDF included</strong>
                    <span>Start with <code>notebooklm/document.sanitized.pdf</code>. It combines safe page visuals with real searchable text; <code>document.md</code> is an optional text-only fallback.</span>
                  </div>
                )}
                <button className="primary-button" type="button" onClick={downloadResult}>
                  <DownloadIcon /> Download Prepared Bundle
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
        <span><span translate="no">Book2Markdown</span> · <a href="https://github.com/leshxt/Book2Markdown" target="_blank" rel="noopener noreferrer">Open Source</a> · MIT</span>
        <span>Processing happens entirely in your browser</span>
      </footer>
    </div>
  )
}
