import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell } from './shell/AppShell'
import { registerDemoFeatures } from './features/demo'
import { reportError } from './shell/diag'

// Last-resort net: anything that escapes React boundaries still gets logged.
window.addEventListener('error', (e) => {
  reportError({ scope: 'root', message: e.message, stack: e.error?.stack })
})
window.addEventListener('unhandledrejection', (e) => {
  reportError({ scope: 'root', message: String(e.reason?.message ?? e.reason) })
})

registerDemoFeatures()

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')
createRoot(el).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
)
