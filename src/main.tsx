import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { isNativeDesktopRuntime } from './platform'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('The root element is missing.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && !isNativeDesktopRuntime() && 'serviceWorker' in navigator) {
  globalThis.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    })
  })
}

if (
  import.meta.env.MODE === 'desktop' &&
  isNativeDesktopRuntime() &&
  globalThis.location.hash === '#desktop-smoke-test'
) {
  void import('./desktop-smoke')
    .then(({ runDesktopSmokeTest }) => runDesktopSmokeTest())
    .then((result) => {
      document.documentElement.dataset['desktopSmokeResult'] = JSON.stringify({
        title: document.title,
        workspaceVisible: document.body.textContent?.includes('Prepare Your Sources') ?? false,
        nativeBridge: typeof window.bookRefineryDesktop?.saveFile === 'function',
        ...result,
      })
    })
    .catch((error: unknown) => {
      document.documentElement.dataset['desktopSmokeResult'] = JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown desktop smoke-test error.',
      })
    })
}

if (
  import.meta.env.MODE === 'desktop' &&
  isNativeDesktopRuntime() &&
  globalThis.location.hash === '#desktop-pdf-smoke-test'
) {
  void import('./desktop-smoke')
    .then(({ runDesktopPdfSmokeTest }) => runDesktopPdfSmokeTest())
    .then((result) => {
      document.documentElement.dataset['desktopSmokeResult'] = JSON.stringify({
        title: document.title,
        workspaceVisible: document.body.textContent?.includes('Prepare Your Sources') ?? false,
        nativeBridge: typeof window.bookRefineryDesktop?.saveFile === 'function',
        ...result,
      })
    })
    .catch((error: unknown) => {
      document.documentElement.dataset['desktopSmokeResult'] = JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown desktop PDF smoke-test error.',
      })
    })
}
