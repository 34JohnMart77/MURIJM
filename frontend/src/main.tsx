import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline-capable PWA on the web only: inside the native Android wrapper the
// WebView origin differs and the backend URL is remote, so skip registration
// there to avoid caching the wrong origin.
if (
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  !Capacitor.isNativePlatform() &&
  import.meta.env.PROD
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is best-effort; the app works without it.
    })
  })
}
