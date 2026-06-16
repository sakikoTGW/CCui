// 窗口最大化/还原 — 系统负责边框动画，内部元素独立 CSS 动画
const ANIM_MS = 400

let cleanupTimer = 0

function clearChromeAnim() {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer)
    cleanupTimer = 0
  }
  const html = document.documentElement
  html.classList.remove('window-chrome-anim', 'maximize', 'restore')
  window.dispatchEvent(new CustomEvent('ccui:parallax-pause', { detail: false }))
}

/** @param {{ mode?: 'maximize'|'restore' }} payload */
function runChromeAnim(payload) {
  const mode = payload?.mode === 'restore' ? 'restore' : 'maximize'
  const html = document.documentElement

  clearChromeAnim()
  html.classList.remove('window-chrome-anim', 'maximize', 'restore')
  void html.offsetWidth

  html.classList.add('window-chrome-anim', mode)
  window.dispatchEvent(new CustomEvent('ccui:parallax-pause', { detail: true }))

  cleanupTimer = window.setTimeout(clearChromeAnim, ANIM_MS + 60)
}

export function initWindowChromeAnim() {
  window.ccui?.onWindowChromeAnim?.(runChromeAnim)
}
