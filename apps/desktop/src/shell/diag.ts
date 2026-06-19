// Renderer-side error reporting bridge.
// Never swallow: surface to console + (when available) the Electron main diag log
// via the preload bridge, so a crashed feature is always traceable.

export interface ReportedError {
  scope: 'feature' | 'root'
  featureId?: string
  message: string
  stack?: string
  componentStack?: string
}

type DiagBridge = {
  reportError?: (e: ReportedError) => void
}

function bridge(): DiagBridge | undefined {
  // preload may expose window.ccuiDiag in P5; tolerate its absence in dev.
  return (globalThis as unknown as { ccuiDiag?: DiagBridge }).ccuiDiag
}

export function reportError(e: ReportedError): void {
  const tag = e.featureId ? `[feature:${e.featureId}]` : '[root]'
  // eslint-disable-next-line no-console
  console.error(`CCui ${e.scope} error ${tag}: ${e.message}`, e.stack ?? '', e.componentStack ?? '')
  try {
    bridge()?.reportError?.(e)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('CCui diag bridge failed', err)
  }
}
