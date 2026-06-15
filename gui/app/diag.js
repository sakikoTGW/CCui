// Renderer diagnostics — forward errors/boot state to main → logs/gui-latest.log
/** @param {'info'|'warn'|'error'} level */
export function reportDiag(level, message, detail) {
  try {
    window.ccui?.reportDiag?.(level, 'renderer', message, detail)
  } catch {}
}

export function initRendererDiag() {
  window.addEventListener('error', e => {
    reportDiag('error', e.message || 'window.error', {
      file: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error?.stack,
    })
  })
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason
    reportDiag('error', r?.message || 'unhandledrejection', r?.stack || r)
  })

  if (window.ccui?.onLog) {
    window.ccui.onLog(text => {
      const t = String(text || '').trim()
      if (t) reportDiag('warn', 'daemon stderr', t)
    })
  }
}
