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

  // 性能探针：≥120ms 的主线程长任务写日志（定位卡顿是否在 JS 主线程；
  // 若卡顿时此处无记录，则为 GPU 合成/重绘层面，需查 backdrop-filter / will-change）。
  try {
    const po = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.duration >= 120) {
          reportDiag('warn', 'longtask', { dur: Math.round(e.duration), ts: Math.round(e.startTime) })
        }
      }
    })
    po.observe({ entryTypes: ['longtask'] })
  } catch {}
}
