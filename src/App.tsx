import { useEffect, useReducer, useRef, useState, type SVGProps } from 'react'
import { zipSync } from 'fflate'
import {
  OUTPUT_PROFILES,
  OUTPUT_SELECTIONS,
  outputFilesForSelection,
  outputsForProfile,
  type ConversionOptions,
  type DocumentFormat,
  type DocumentInspection,
  type OutputSelectionId,
} from './core/contracts'
import type { ConversionProgress, ConversionResult } from './core/convert'
import type { SecurityErrorCode } from './core/errors'
import {
  formatBytes,
  SECURITY_POLICY,
} from './core/policy'
import { safeOutputName } from './core/path'
import { isNativeDesktopRuntime } from './platform'
import {
  conversionResourceWarnings,
  isCombinedZipSizeSupported,
  requiresLargeSaveConfirmation,
} from './resource-consent'
import { savePreparedFile, selectedFileName } from './save-file'
import { APP_VERSION } from './version'
import {
  runConversion,
  runInspection,
  WorkerConversionError,
} from './worker/runConversion'

interface JobBase {
  readonly id: string
  readonly file: File
  readonly sourceName: string
}

type Job =
  | (JobBase & { readonly status: 'inspecting' })
  | (JobBase & { readonly status: 'password'; readonly incorrect: boolean })
  | (JobBase & { readonly status: 'ready'; readonly inspection: DocumentInspection })
  | (JobBase & { readonly status: 'queued'; readonly inspection: DocumentInspection })
  | (JobBase & {
      readonly status: 'running'
      readonly inspection: DocumentInspection
      readonly progress: ConversionProgress
    })
  | (JobBase & {
      readonly status: 'success'
      readonly inspection: DocumentInspection
      readonly result: ConversionResult
    })
  | (JobBase & {
      readonly status: 'error'
      readonly inspection: DocumentInspection | null
      readonly code: SecurityErrorCode
      readonly message: string
    })

type JobAction =
  | { readonly type: 'add'; readonly jobs: readonly Job[] }
  | { readonly type: 'inspected'; readonly id: string; readonly inspection: DocumentInspection }
  | { readonly type: 'password-needed'; readonly id: string; readonly incorrect: boolean }
  | { readonly type: 'unlock'; readonly id: string }
  | {
      readonly type: 'failed'
      readonly id: string
      readonly inspection: DocumentInspection | null
      readonly code: SecurityErrorCode
      readonly message: string
    }
  | { readonly type: 'queue'; readonly ids: ReadonlySet<string> }
  | { readonly type: 'run'; readonly id: string }
  | { readonly type: 'progress'; readonly id: string; readonly progress: ConversionProgress }
  | { readonly type: 'complete'; readonly id: string; readonly result: ConversionResult }
  | { readonly type: 'unqueue' }
  | { readonly type: 'retry'; readonly id: string }
  | { readonly type: 'remove'; readonly id: string }
  | { readonly type: 'clear-finished' }

interface InstallPromptResult {
  readonly outcome: 'accepted' | 'dismissed'
  readonly platform: string
}

interface AppInstallPromptEvent extends Event {
  prompt(): Promise<InstallPromptResult>
}

type DesktopInstallState =
  | { readonly kind: 'available'; readonly prompt: AppInstallPromptEvent }
  | { readonly kind: 'installed' }
  | { readonly kind: 'native' }
  | { readonly kind: 'browser-menu' }

type ResourceConsent =
  | { readonly kind: 'conversion'; readonly warnings: readonly string[] }
  | { readonly kind: 'save-all'; readonly bytes: number }
  | {
      readonly kind: 'save-one'
      readonly jobId: string
      readonly bytes: number
    }

function jobsReducer(jobs: readonly Job[], action: JobAction): readonly Job[] {
  switch (action.type) {
    case 'add':
      return [...jobs, ...action.jobs]
    case 'inspected':
      return jobs.map((job) =>
        job.id === action.id && job.status === 'inspecting'
          ? { id: job.id, file: job.file, sourceName: job.sourceName, status: 'ready', inspection: action.inspection }
          : job)
    case 'password-needed':
      return jobs.map((job) =>
        job.id === action.id
          ? { id: job.id, file: job.file, sourceName: job.sourceName, status: 'password', incorrect: action.incorrect }
          : job)
    case 'unlock':
      return jobs.map((job) =>
        job.id === action.id && job.status === 'password'
          ? { id: job.id, file: job.file, sourceName: job.sourceName, status: 'inspecting' }
          : job)
    case 'failed':
      return jobs.map((job) =>
        job.id === action.id
          ? {
              id: job.id,
              file: job.file,
              sourceName: job.sourceName,
              status: 'error',
              inspection: action.inspection,
              code: action.code,
              message: action.message,
            }
          : job)
    case 'queue':
      return jobs.map((job) =>
        job.status === 'ready' && action.ids.has(job.id)
          ? { ...job, status: 'queued' }
          : job)
    case 'run':
      return jobs.map((job) =>
        job.id === action.id && job.status === 'queued'
          ? {
              ...job,
              status: 'running',
              progress: { percent: 2, label: 'Reading the file' },
            }
          : job)
    case 'progress':
      return jobs.map((job) =>
        job.id === action.id && job.status === 'running'
          ? { ...job, progress: action.progress }
          : job)
    case 'complete':
      return jobs.map((job) =>
        job.id === action.id && job.status === 'running'
          ? {
              id: job.id,
              file: job.file,
              sourceName: job.sourceName,
              status: 'success',
              inspection: job.inspection,
              result: action.result,
            }
          : job)
    case 'unqueue':
      return jobs.map((job) =>
        job.status === 'queued' ? { ...job, status: 'ready' } : job)
    case 'retry':
      return jobs.map((job) => {
        if (job.id !== action.id || job.status !== 'error') return job
        if (job.inspection?.passwordProtected) {
          return { id: job.id, file: job.file, sourceName: job.sourceName, status: 'password', incorrect: false }
        }
        return job.inspection
          ? { id: job.id, file: job.file, sourceName: job.sourceName, status: 'ready', inspection: job.inspection }
          : { id: job.id, file: job.file, sourceName: job.sourceName, status: 'inspecting' }
      })
    case 'remove':
      return jobs.filter((job) => job.id !== action.id)
    case 'clear-finished':
      return jobs.filter((job) => job.status !== 'success' && job.status !== 'error')
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

function SaveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M5 3.5h11l3 3v14H5v-17Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 3.5v6h8v-6M8 20.5v-7h8v7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
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

function fileBadge(sourceName: string): string {
  const name = sourceName.toLocaleLowerCase('en-US')
  if (name.endsWith('.pdf')) return 'PDF'
  if (name.endsWith('.fb2') || name.endsWith('.fb2.zip')) return 'FB2'
  return 'EPUB'
}

function guessedFormat(sourceName: string | undefined): DocumentFormat {
  if (!sourceName) return 'epub'
  const badge = fileBadge(sourceName)
  return badge === 'PDF' ? 'pdf' : badge === 'FB2' ? 'fb2' : 'epub'
}

function inspectionFor(job: Job): DocumentInspection | null {
  return job.status === 'ready' ||
    job.status === 'queued' ||
    job.status === 'running' ||
    job.status === 'success' ||
    job.status === 'error'
    ? job.inspection
    : null
}

function jobStatusLabel(job: Job): string {
  switch (job.status) {
    case 'inspecting':
      return 'Inspecting safely'
    case 'password':
      return job.incorrect ? 'Incorrect password' : 'Password needed'
    case 'ready':
      return 'Ready'
    case 'queued':
      return 'Queued'
    case 'running':
      return job.progress.label
    case 'success':
      return 'Prepared'
    case 'error':
      return `Rejected · ${job.code}`
  }
}

interface PdfPasswordFormProps {
  readonly filename: string
  readonly incorrect: boolean
  readonly onUnlock: (password: string) => void
}

function PdfPasswordForm({ filename, incorrect, onUnlock }: PdfPasswordFormProps) {
  return (
    <form
      className="password-form"
      action={(formData) => {
        const password = formData.get('pdf-password')
        if (typeof password === 'string' && password.length > 0) onUnlock(password)
      }}
    >
      <div>
        <strong>{incorrect ? 'That password did not open the PDF' : 'This PDF needs a password'}</strong>
        <p>
          Enter it to inspect and prepare this file locally. It stays in memory only and is cleared
          after this job. Prepared outputs are not re-locked.
        </p>
      </div>
      <label>
        <span>Password for {filename}</span>
        <input
          type="password"
          name="pdf-password"
          required
          maxLength={SECURITY_POLICY.maxPdfPasswordLength}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button type="submit">Unlock locally</button>
    </form>
  )
}

function isStandaloneApp(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
}

function initialDesktopInstallState(): DesktopInstallState {
  if (isNativeDesktopRuntime()) return { kind: 'native' }
  return isStandaloneApp() ? { kind: 'installed' } : { kind: 'browser-menu' }
}

function sameOutputs(
  left: readonly OutputSelectionId[],
  right: readonly OutputSelectionId[],
): boolean {
  return left.length === right.length && left.every((output) => right.includes(output))
}

export function App() {
  const [jobs, dispatch] = useReducer(jobsReducer, [])
  const [dragging, setDragging] = useState(false)
  const [selectedOutputs, setSelectedOutputs] = useState<readonly OutputSelectionId[]>(
    outputsForProfile('notebooklm'),
  )
  const [ocrEnabled, setOcrEnabled] = useState(true)
  const [saveNotice, setSaveNotice] = useState<{
    readonly kind: 'success' | 'fallback' | 'error'
    readonly message: string
  } | null>(null)
  const [resourceConsent, setResourceConsent] = useState<ResourceConsent | null>(null)
  const [desktopInstall, setDesktopInstall] = useState<DesktopInstallState>(
    initialDesktopInstallState,
  )
  const inspectionControllers = useRef(new Map<string, AbortController>())
  const pdfPasswords = useRef(new Map<string, string>())
  const activeConversion = useRef<AbortController | null>(null)
  const stopBatch = useRef(false)

  useEffect(() => {
    if (isNativeDesktopRuntime()) return

    const captureInstallPrompt = (event: Event): void => {
      event.preventDefault()
      setDesktopInstall({
        kind: 'available',
        prompt: event as AppInstallPromptEvent,
      })
    }
    const markInstalled = (): void => setDesktopInstall({ kind: 'installed' })

    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', markInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', markInstalled)
    }
  }, [])

  const batchRunning = jobs.some((job) => job.status === 'queued' || job.status === 'running')
  const readyJobs = jobs.filter((job): job is Extract<Job, { status: 'ready' }> => job.status === 'ready')
  const successfulJobs = jobs.filter((job): job is Extract<Job, { status: 'success' }> => job.status === 'success')
  const successfulBytes = successfulJobs.reduce(
    (total, job) => total + job.result.archive.byteLength,
    0,
  )
  const focusJob = jobs.find((job) => inspectionFor(job)) ?? jobs[0]
  const focusInspection = focusJob ? inspectionFor(focusJob) : null
  const focusFormat = focusInspection?.format ?? guessedFormat(focusJob?.sourceName)
  const focusTitleStem = safeOutputName(focusInspection?.title ?? 'Book title', 'Book title')
  const selectedProfile = OUTPUT_PROFILES.find((candidate) =>
    sameOutputs(candidate.outputs, selectedOutputs))

  const inspectJob = async (job: Extract<Job, { status: 'inspecting' }>): Promise<void> => {
    const controller = new AbortController()
    inspectionControllers.current.set(job.id, controller)
    try {
      const inspection = await runInspection(
        job.file,
        job.sourceName,
        controller.signal,
        pdfPasswords.current.get(job.id),
      )
      dispatch({ type: 'inspected', id: job.id, inspection })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const code = error instanceof WorkerConversionError ? error.code : 'CONVERSION_FAILED'
      if (code === 'PASSWORD_REQUIRED' || code === 'INCORRECT_PASSWORD') {
        pdfPasswords.current.delete(job.id)
        dispatch({
          type: 'password-needed',
          id: job.id,
          incorrect: code === 'INCORRECT_PASSWORD',
        })
        return
      }
      const message = error instanceof WorkerConversionError
        ? error.message
        : 'The file could not be inspected safely.'
      pdfPasswords.current.delete(job.id)
      dispatch({ type: 'failed', id: job.id, inspection: null, code, message })
    } finally {
      inspectionControllers.current.delete(job.id)
    }
  }

  const unlockPdf = (job: Extract<Job, { status: 'password' }>, password: string): void => {
    pdfPasswords.current.set(job.id, password)
    dispatch({ type: 'unlock', id: job.id })
    void inspectJob({ id: job.id, file: job.file, sourceName: job.sourceName, status: 'inspecting' })
  }

  const addFiles = async (fileList: FileList | readonly File[]): Promise<void> => {
    const remaining = Math.max(0, SECURITY_POLICY.maxBatchFiles - jobs.length)
    const files = Array.from(fileList).slice(0, remaining)
    if (files.length === 0) return
    const namedFiles = await Promise.all(files.map(async (file) => ({
      file,
      sourceName: await selectedFileName(file),
    })))
    const additions: Job[] = namedFiles.map(({ file, sourceName }) => {
      const id = globalThis.crypto.randomUUID()
      const error = selectError(file)
      return error
        ? {
            id,
            file,
            sourceName,
            status: 'error',
            inspection: null,
            code: error.code,
            message: error.message,
          }
        : { id, file, sourceName, status: 'inspecting' }
    })
    dispatch({ type: 'add', jobs: additions })
    for (const job of additions) {
      if (job.status === 'inspecting') await inspectJob(job)
    }
  }

  const startBatch = async (extendedResources = false): Promise<void> => {
    if (batchRunning || readyJobs.length === 0) return
    const snapshot = [...readyJobs]
    const resourceWarnings = conversionResourceWarnings(snapshot, selectedOutputs, ocrEnabled)
    if (!extendedResources && resourceWarnings.length > 0) {
      setResourceConsent({ kind: 'conversion', warnings: resourceWarnings })
      return
    }
    dispatch({ type: 'queue', ids: new Set(snapshot.map((job) => job.id)) })
    stopBatch.current = false
    const options: ConversionOptions = {
      profile: selectedProfile?.id ?? 'custom',
      outputs: selectedOutputs,
      resourceMode: extendedResources ? 'extended' : 'standard',
      ocr: {
        enabled: ocrEnabled,
        languages: ['eng', 'deu'],
      },
    }

    for (const job of snapshot) {
      if (stopBatch.current) break
      dispatch({ type: 'run', id: job.id })
      const controller = new AbortController()
      activeConversion.current = controller
      try {
        const result = await runConversion(
          job.file,
          job.sourceName,
          options,
          (progress) => dispatch({ type: 'progress', id: job.id, progress }),
          controller.signal,
          pdfPasswords.current.get(job.id),
        )
        dispatch({ type: 'complete', id: job.id, result })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          dispatch({
            type: 'failed',
            id: job.id,
            inspection: job.inspection,
            code: 'CONVERSION_FAILED',
            message: 'Preparation was cancelled. The original file was not changed.',
          })
        } else {
          const code = error instanceof WorkerConversionError ? error.code : 'CONVERSION_FAILED'
          if (code === 'PASSWORD_REQUIRED' || code === 'INCORRECT_PASSWORD') {
            dispatch({
              type: 'password-needed',
              id: job.id,
              incorrect: code === 'INCORRECT_PASSWORD',
            })
            continue
          }
          const message = error instanceof WorkerConversionError
            ? error.message
            : 'The file could not be prepared safely.'
          dispatch({
            type: 'failed',
            id: job.id,
            inspection: job.inspection,
            code,
            message,
          })
        }
      } finally {
        pdfPasswords.current.delete(job.id)
        if (activeConversion.current === controller) activeConversion.current = null
      }
    }
    dispatch({ type: 'unqueue' })
  }

  const cancelBatch = (): void => {
    stopBatch.current = true
    activeConversion.current?.abort()
    dispatch({ type: 'unqueue' })
  }

  const requestDesktopInstall = async (): Promise<void> => {
    if (desktopInstall.kind !== 'available') return
    const result = await desktopInstall.prompt.prompt()
    setDesktopInstall(result.outcome === 'accepted'
      ? { kind: 'installed' }
      : { kind: 'browser-menu' })
  }

  const retryJob = (job: Extract<Job, { status: 'error' }>): void => {
    dispatch({ type: 'retry', id: job.id })
    if (!job.inspection) {
      void inspectJob({ id: job.id, file: job.file, sourceName: job.sourceName, status: 'inspecting' })
    }
  }

  const removeJob = (job: Job): void => {
    inspectionControllers.current.get(job.id)?.abort()
    pdfPasswords.current.delete(job.id)
    dispatch({ type: 'remove', id: job.id })
  }

  const saveArchive = async (data: Uint8Array, filename: string): Promise<void> => {
    setSaveNotice(null)
    try {
      const result = await savePreparedFile(data, filename)
      if (result === 'cancelled') return
      setSaveNotice(result === 'browser-download'
        ? {
            kind: 'fallback',
            message: 'Your browser does not support Save As here, so it saved the file to its download folder.',
          }
        : { kind: 'success', message: `Saved ${filename}.` })
    } catch {
      setSaveNotice({
        kind: 'error',
        message: 'The prepared file could not be saved. It remains available in this queue.',
      })
    }
  }

  const requestJobSave = async (
    job: Extract<Job, { status: 'success' }>,
    confirmed = false,
  ): Promise<void> => {
    if (!confirmed && requiresLargeSaveConfirmation(job.result.archive.byteLength)) {
      setResourceConsent({
        kind: 'save-one',
        jobId: job.id,
        bytes: job.result.archive.byteLength,
      })
      return
    }
    await saveArchive(job.result.archive, job.result.filename)
  }

  const saveAll = async (confirmed = false): Promise<void> => {
    if (successfulJobs.length === 0) return
    const estimatedZipOverhead = successfulJobs.reduce(
      (total, job, index) => {
        const prefix = String(index + 1).padStart(2, '0')
        const filenameBytes = new TextEncoder().encode(`${prefix}-${job.result.filename}`).byteLength
        return total + 76 + (filenameBytes * 2)
      },
      22,
    )
    const estimatedArchiveBytes = successfulBytes + estimatedZipOverhead
    if (!isCombinedZipSizeSupported(estimatedArchiveBytes)) {
      setSaveNotice({
        kind: 'error',
        message: `The combined package would be about ${formatBytes(estimatedArchiveBytes)}, above the technical ZIP limit. Save the prepared books individually; they remain available in this queue.`,
      })
      return
    }
    if (!confirmed && requiresLargeSaveConfirmation(estimatedArchiveBytes)) {
      setResourceConsent({ kind: 'save-all', bytes: estimatedArchiveBytes })
      return
    }
    const files: Record<string, Uint8Array> = {}
    for (const [index, job] of successfulJobs.entries()) {
      const prefix = String(index + 1).padStart(2, '0')
      files[`${prefix}-${job.result.filename}`] = job.result.archive
    }
    await saveArchive(
      zipSync(files, { level: 0, mtime: new Date('2026-01-01T00:00:00Z') }),
      'bookrefinery-prepared-books.zip',
    )
  }

  const confirmResourceUse = (): void => {
    const consent = resourceConsent
    setResourceConsent(null)
    if (!consent) return
    if (consent.kind === 'conversion') {
      void startBatch(true)
      return
    }
    if (consent.kind === 'save-all') {
      void saveAll(true)
      return
    }
    const job = successfulJobs.find((candidate) => candidate.id === consent.jobId)
    if (job) void requestJobSave(job, true)
  }

  return (
    <div className="app-shell">
      {resourceConsent && (
        <div className="resource-dialog-backdrop">
          <section
            className="resource-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="resource-dialog-title"
            aria-describedby="resource-dialog-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setResourceConsent(null)
            }}
          >
            <span className="resource-dialog-kicker">Resource warning</span>
            <h2 id="resource-dialog-title">
              {resourceConsent.kind === 'conversion'
                ? 'This job is larger than the normal processing budget'
                : 'This file is larger than the normal save budget'}
            </h2>
            <p id="resource-dialog-description">
              {resourceConsent.kind === 'conversion'
                ? 'Continuing keeps the requested visual and OCR outputs enabled, but may take much longer and use substantially more memory, CPU, and disk space.'
                : `${formatBytes(resourceConsent.bytes)} will be assembled in memory and written locally. The operation can fail if the system runs out of memory or free disk space.`}
            </p>
            {resourceConsent.kind === 'conversion' && (
              <ul>{resourceConsent.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            )}
            <p className="resource-dialog-note">
              Structural protections against malformed files, unsafe paths, ZIP bombs, and unsupported canvas sizes remain active.
            </p>
            <div className="resource-dialog-actions">
              <button
                className="secondary-button"
                type="button"
                autoFocus
                onClick={() => setResourceConsent(null)}
              >
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmResourceUse}>
                Continue anyway
              </button>
            </div>
          </section>
        </div>
      )}
      <a className="skip-link" href="#workspace">Skip to Private Workspace</a>
      <header className="topbar">
        <div className="brand-lockup">
          <a className="brand" href="#main" aria-label="BookRefinery - go to the top">
            <span className="brand-mark">
              <img src={`${import.meta.env.BASE_URL}bookrefinery-icon.png`} alt="" />
            </span>
            <span className="brand-name" translate="no">Book<strong>Refinery</strong></span>
            <span className="brand-version" aria-label={`Version ${APP_VERSION}`}>v{APP_VERSION}</span>
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
        <div className="topbar-actions">
          {desktopInstall.kind === 'available' && (
            <button className="install-shortcut" type="button" onClick={() => void requestDesktopInstall()}>
              <DownloadIcon /> Install app
            </button>
          )}
          {desktopInstall.kind === 'installed' && (
            <span className="install-shortcut is-installed"><DownloadIcon /> Installed</span>
          )}
          {desktopInstall.kind === 'native' && (
            <span className="install-shortcut is-installed"><DownloadIcon /> Desktop build</span>
          )}
          {desktopInstall.kind === 'browser-menu' && (
            <a className="install-shortcut" href="#desktop-install"><DownloadIcon /> Desktop app</a>
          )}
          <div className="local-badge"><span aria-hidden="true" />Files stay local</div>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="eyebrow"><ShieldIcon /> Local ebook refinery · EPUB, FB2 &amp; PDF</div>
          <h1 id="hero-title">Books in.<br /><span>Safe knowledge out.</span></h1>
          <p className="hero-copy">
            Inspect, repair, sanitize, OCR, and reshape ebooks into trustworthy multimodal sources
            for NotebookLM, RAG systems, Markdown workflows, or long-term safe storage.
          </p>
          <div className="trust-row" aria-label="Product guarantees">
            <span><i>01</i> Never uploaded</span>
            <span><i>02</i> Text &amp; visuals synchronized</span>
            <span><i>03</i> Exact outputs before processing</span>
          </div>
        </section>

        <section className="outcomes" aria-labelledby="outcomes-title">
          <div className="outcomes-heading">
            <p className="section-label">Refine, Don&apos;t Flatten</p>
            <h2 id="outcomes-title">One source.<br />Purpose-built outputs.</h2>
          </div>
          <div className="outcome-grid">
            <article>
              <span>Inspect</span>
              <h3>Preflight First</h3>
              <p>Format, structure, text coverage, graphics, limits, and OCR needs are shown before processing.</p>
            </article>
            <article>
              <span>Preserve</span>
              <h3>Text + Visual Context</h3>
              <p>Searchable text stays aligned with sanitized figures and page-faithful visual companions.</p>
            </article>
            <article>
              <span>Prove</span>
              <h3>Manifested Exports</h3>
              <p>Every bundle includes security records and a SHA-256 inventory of the files it contains.</p>
            </article>
          </div>
        </section>

        <aside className="desktop-install" id="desktop-install" aria-labelledby="desktop-install-title">
          <span className="desktop-install-mark"><DownloadIcon /></span>
          <div>
            <strong id="desktop-install-title">
              {desktopInstall.kind === 'native'
                ? 'Native desktop edition'
                : 'Install or download BookRefinery'}
            </strong>
            <p>
              {desktopInstall.kind === 'native'
                ? 'Bundled runtime, remote requests blocked, and a native Save As dialog.'
                : 'Use the Chrome/Edge web install, or download the native Windows and Linux editions.'}
            </p>
          </div>
          {desktopInstall.kind === 'available' && (
            <div className="desktop-install-actions">
              <button type="button" onClick={() => void requestDesktopInstall()}>Install browser app</button>
              <a href="https://github.com/leshxt/BookRefinery/releases" target="_blank" rel="noopener noreferrer">
                Native downloads
              </a>
            </div>
          )}
          {desktopInstall.kind === 'installed' && <span className="desktop-install-state">Installed</span>}
          {desktopInstall.kind === 'native' && (
            <span className="desktop-install-state">Native · network blocked</span>
          )}
          {desktopInstall.kind === 'browser-menu' && (
            <div className="desktop-install-actions">
              <span className="desktop-install-help">Firefox: use a native build</span>
              <a href="https://github.com/leshxt/BookRefinery/releases" target="_blank" rel="noopener noreferrer">
                Windows &amp; Linux
              </a>
            </div>
          )}
        </aside>

        <section className="studio-card" id="workspace" aria-labelledby="workspace-title">
          <div className="studio-heading">
            <div>
              <p className="section-label">Private Workspace</p>
              <h2 id="workspace-title">Prepare Your Sources</h2>
            </div>
            <span className="limit-label">{SECURITY_POLICY.maxBatchFiles} files · 80 MB each</span>
          </div>

          <fieldset className="profile-picker" disabled={batchRunning}>
            <legend>
              <span className="step-number">01</span>
              Choose your outputs
              <small>
                Start with a use-case preset, then add or remove individual formats. Security report and checksum manifest are always included.
              </small>
            </legend>
            <div className="output-group-heading">
              <strong>Preset selection</strong>
              <span>Choose the closest use case as your starting point.</span>
            </div>
            <div className="preset-row" aria-label="Output presets">
              {OUTPUT_PROFILES.map((candidate) => {
                const selected = selectedProfile?.id === candidate.id
                return (
                  <button
                    className={`preset-button ${selected ? 'is-selected' : ''}`}
                    type="button"
                    aria-pressed={selected}
                    key={candidate.id}
                    onClick={() => setSelectedOutputs(candidate.outputs)}
                  >
                    <strong>{candidate.name}</strong>
                    <span>{candidate.difference}</span>
                    {'recommended' in candidate && candidate.recommended && (
                      <small>Recommended</small>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="output-group-heading format-selection-heading">
              <strong>Format selection</strong>
              <span>Fine-tune the individual outputs included in your bundle.</span>
            </div>
            <div className="output-selection-list">
              {OUTPUT_SELECTIONS.map((selection) => {
                const selected = selectedOutputs.includes(selection.id)
                const exactFiles = outputFilesForSelection([selection.id], focusFormat)
                  .filter((file) => !file.description.endsWith('Always included.'))
                return (
                  <article className={`output-selection ${selected ? 'is-selected' : ''}`} key={selection.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => {
                          setSelectedOutputs((current) => {
                            if (current.includes(selection.id)) {
                              return current.length === 1
                                ? current
                                : current.filter((output) => output !== selection.id)
                            }
                            return [...current, selection.id]
                          })
                        }}
                      />
                      <span className="output-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                      <span>
                        <strong>{selection.name}</strong>
                        <small>{selection.formats} · {selection.useCase}</small>
                      </span>
                    </label>
                    <p>{selection.description}</p>
                    <details>
                      <summary>Exact {focusFormat.toUpperCase()} files</summary>
                      <ul className="output-file-list">
                        {exactFiles.map((file) => (
                          <li key={file.path}>
                            <code>{file.path.replace('{Book title}', focusTitleStem)}</code>
                            <span>{file.format}{file.optional ? ' · if available' : ''}</span>
                            <small>{file.description}</small>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </article>
                )
              })}
            </div>
            <p className="custom-output-note">
              Current bundle: <strong>{selectedProfile?.name ?? 'Custom selection'}</strong>
              {' '}· {selectedOutputs.length} output {selectedOutputs.length === 1 ? 'group' : 'groups'}
            </p>
          </fieldset>

          <div className="ocr-option">
            <div>
              <span className="step-number">02</span>
              <strong>Automatic text recovery</strong>
              <p>
                Recommended and on by default. Bundled English + German OCR covers every PDF page
                without usable text in ordinary books. Jobs beyond the normal {SECURITY_POLICY.maxOcrPages}-page
                budget ask before switching to extended local processing. EPUB and FB2 text is left unchanged.
              </p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={ocrEnabled}
                disabled={batchRunning}
                onChange={(event) => setOcrEnabled(event.currentTarget.checked)}
              />
              <span aria-hidden="true" />
              <b>{ocrEnabled ? 'Auto' : 'Off'}</b>
            </label>
          </div>

          <div className="upload-heading">
            <div><span className="step-number">03</span><strong>Add up to {SECURITY_POLICY.maxBatchFiles} ebooks</strong></div>
            {jobs.length > 0 && <span>{jobs.length} / {SECURITY_POLICY.maxBatchFiles}</span>}
          </div>
          <label
            className={`dropzone compact-dropzone ${dragging ? 'is-dragging' : ''} ${jobs.length >= SECURITY_POLICY.maxBatchFiles ? 'is-disabled' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              if (!batchRunning) void addFiles(event.dataTransfer.files)
            }}
          >
            <input
              type="file"
              name="ebooks"
              multiple
              aria-label="Choose EPUB, FB2, compressed FB2, or PDF ebooks"
              accept=".epub,.fb2,.fb2.zip,.pdf,application/epub+zip,application/x-fictionbook+xml,application/pdf"
              disabled={batchRunning || jobs.length >= SECURITY_POLICY.maxBatchFiles}
              onChange={(event) => {
                if (event.currentTarget.files) void addFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
            <span className="upload-orbit"><UploadIcon /></span>
            <span>
              <strong>{dragging ? 'Drop them here' : jobs.length ? 'Add more books' : 'Drop EPUB, FB2, or PDF files here'}</strong>
              <small>or choose local files · each receives an isolated preflight</small>
            </span>
          </label>

          {jobs.length > 0 && (
            <div className="queue" aria-label="Preparation queue">
              <div className="queue-heading">
                <div>
                  <span className="step-number">04</span>
                  <strong>Review preflight and prepare</strong>
                </div>
                {successfulJobs.length > 0 && (
                  <button className="text-button" type="button" onClick={() => dispatch({ type: 'clear-finished' })}>
                    Clear finished
                  </button>
                )}
              </div>

              {jobs.map((job) => {
                const inspection = inspectionFor(job)
                const imageOnlyPages = inspection?.imageOnlyPages ?? 0
                return (
                  <article className={`job-card job-${job.status}`} key={job.id}>
                    <div className="job-main">
                      <div className="file-icon">{fileBadge(job.sourceName)}</div>
                      <div className="file-details">
                        <strong>{job.sourceName}</strong>
                        <span>{formatBytes(job.file.size)} · {jobStatusLabel(job)}</span>
                      </div>
                      {job.status !== 'running' && job.status !== 'queued' && (
                        <button className="icon-button" type="button" aria-label={`Remove ${job.sourceName}`} onClick={() => removeJob(job)}>×</button>
                      )}
                    </div>

                    {inspection && (
                      <div className="preflight-grid">
                        <div><span>Title</span><strong>{inspection.title}</strong></div>
                        <div><span>{inspection.unitLabel}</span><strong>{inspection.units.toLocaleString('en-US')}</strong></div>
                        <div><span>graphics / pages</span><strong>{inspection.graphics.toLocaleString('en-US')}</strong></div>
                        <div><span>text layer</span><strong>{inspection.textCoverage}</strong></div>
                      </div>
                    )}

                    {inspection?.ocrRecommended && (
                      <div className={`inline-notice ${ocrEnabled ? 'is-positive' : ''}`}>
                        {ocrEnabled
                          ? inspection.ocrWithinBudget === false
                            ? `${imageOnlyPages.toLocaleString('en-US')} textless pages detected. Starting this exceptionally large OCR job requires confirmation and enables the extended local resource budget.`
                            : `${imageOnlyPages.toLocaleString('en-US')} textless ${imageOnlyPages === 1 ? 'page' : 'pages'} detected. Automatic local text recovery will cover ${imageOnlyPages === 1 ? 'it' : 'all of them'} during preparation.`
                          : `${imageOnlyPages.toLocaleString('en-US')} textless ${imageOnlyPages === 1 ? 'page will' : 'pages will'} remain visual-only because automatic recovery is off.`}
                      </div>
                    )}

                    {inspection?.repair && (
                      <div className={`inline-notice repair-notice ${inspection.repair.level === 'automatic' ? 'is-positive' : ''}`}>
                        <strong>
                          {inspection.repair.level === 'automatic'
                            ? 'Safe automatic repair available.'
                            : 'Salvage mode available.'}
                        </strong>
                        {' '}
                        {inspection.repair.level === 'automatic'
                          ? 'The original stays unchanged; the repaired copy must pass the normal strict conversion.'
                          : `${inspection.repair.omittedEntries.toLocaleString('en-US')} incomplete archive item(s) will be omitted and documented.`}
                        <details>
                          <summary>Show repair plan</summary>
                          <ul>
                            {inspection.repair.actions.map((action) => <li key={action}>{action}</li>)}
                          </ul>
                        </details>
                      </div>
                    )}

                    {job.status === 'password' && (
                      <PdfPasswordForm
                        filename={job.sourceName}
                        incorrect={job.incorrect}
                        onUnlock={(password) => unlockPdf(job, password)}
                      />
                    )}

                    {job.status === 'running' && (
                      <div className="job-progress">
                        <div><span>{job.progress.label}</span><strong>{job.progress.percent}%</strong></div>
                        <progress value={job.progress.percent} max={100}>{job.progress.percent}%</progress>
                      </div>
                    )}

                    {job.status === 'error' && (
                      <div className="job-error" role="alert">
                        <p>{job.message}</p>
                        <button type="button" onClick={() => retryJob(job)}>Try again</button>
                      </div>
                    )}

                    {job.status === 'success' && (
                      <div className="job-result">
                        <div className="result-metrics">
                          <span><strong>{job.result.summary.units.toLocaleString('en-US')}</strong>{job.result.summary.unitLabel}</span>
                          <span><strong>{job.result.summary.ocrPages ?? 0}</strong>OCR pages</span>
                          {job.result.summary.repair && (
                            <span>
                              <strong>{job.result.summary.repair.actions.length}</strong>
                              {job.result.summary.repair.level === 'salvage' ? 'salvage actions' : 'repairs'}
                            </span>
                          )}
                          <span><strong>{formatBytes(job.result.summary.outputBytes)}</strong>ZIP</span>
                        </div>
                        <button type="button" onClick={() => void requestJobSave(job)}>
                          <SaveIcon /> Save as…
                        </button>
                        {job.result.summary.warnings.length > 0 && (
                          <details className="warnings">
                            <summary>{job.result.summary.warnings.length} preparation warning(s)</summary>
                            <ul>{job.result.summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                          </details>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}

              <div className="queue-actions">
                {batchRunning ? (
                  <button className="secondary-button" type="button" onClick={cancelBatch}>Cancel batch</button>
                ) : (
                  <button className="primary-button" type="button" disabled={readyJobs.length === 0} onClick={() => void startBatch()}>
                    <ShieldIcon /> Prepare {readyJobs.length || 'ready'} {readyJobs.length === 1 ? 'book' : 'books'} as {selectedProfile?.name ?? 'Custom bundle'}
                  </button>
                )}
                {successfulJobs.length > 1 && (
                  <button className="secondary-button" type="button" onClick={() => void saveAll()}>
                    <SaveIcon /> Save all as… ({formatBytes(successfulBytes)})
                  </button>
                )}
              </div>
              {saveNotice && (
                <p
                  className={`save-notice save-notice-${saveNotice.kind}`}
                  role={saveNotice.kind === 'error' ? 'alert' : 'status'}
                >
                  {saveNotice.message}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="security-grid" aria-labelledby="security-title">
          <div className="security-intro">
            <p className="section-label">Threat Model</p>
            <h2 id="security-title">Distrust is<br />a feature.</h2>
            <p>Every book gets a disposable worker, explicit resource consent, a strict output contract, and a verifiable manifest.</p>
          </div>
          <article><span>01</span><h3>Isolated jobs</h3><p>Preflight, conversion, and automatic OCR stay outside the UI and can be terminated independently.</p></article>
          <article><span>02</span><h3>Informed resources</h3><p>Large legitimate jobs can continue after a clear warning; structural anti-abuse boundaries remain enforced.</p></article>
          <article><span>03</span><h3>Passive outputs</h3><p>Scripts, forms, remote sources, attachments, and active markup never enter the prepared bundle.</p></article>
        </section>
      </main>

      <footer>
        <span><span translate="no">BookRefinery</span> · <a href="https://github.com/leshxt/BookRefinery" target="_blank" rel="noopener noreferrer">Open Source</a> · MIT</span>
        <span>Inspect, refine, and export entirely on this device</span>
      </footer>
    </div>
  )
}
