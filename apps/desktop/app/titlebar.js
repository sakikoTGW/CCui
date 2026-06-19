// 自定义标题栏 — Windows 风格（─ □ ✕）
import { db } from './db.js'

const DEFAULT = {
  style: 'windows',
  showProject: true,
  showSession: true,
  showTheme: true,
  showConnection: true,
}

let chrome = { ...DEFAULT }

function wc() {
  return window.ccui
}

export function getChromePrefs() {
  return { ...chrome }
}

function applyChromeClasses(root) {
  document.body.classList.add('chrome-windows')
  document.body.classList.remove('chrome-mac')
  if (!root) return
  root.classList.add('chrome-windows')
  root.classList.remove('chrome-mac')
  root.classList.toggle('chrome-hide-project', !chrome.showProject)
  root.classList.toggle('chrome-hide-session', !chrome.showSession)
  root.classList.toggle('chrome-hide-theme', !chrome.showTheme)
  root.classList.toggle('chrome-hide-connection', !chrome.showConnection)
}

function syncMaximizeBtn(btn) {
  if (!btn) return
  const maxed = !!chrome.isMaximized
  btn.classList.toggle('is-maximized', maxed)
  btn.title = maxed ? '还原' : '最大化'
  btn.setAttribute('aria-label', maxed ? '还原窗口' : '最大化窗口')
}

function mountWinControls(host) {
  host.innerHTML = `
    <div class="tb-win-group" role="group" aria-label="窗口控制">
      <button type="button" class="tb-win-btn min" data-act="minimize" title="最小化" aria-label="最小化">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </button>
      <button type="button" class="tb-win-btn max" data-act="maximize" title="最大化" aria-label="最大化">
        <svg class="ico-max" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="0.6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>
        <svg class="ico-restore" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.2 3.2h4.6v4.6M3.2 4.2v4.6h4.6" fill="none" stroke="currentColor" stroke-width="1.05"/></svg>
      </button>
      <button type="button" class="tb-win-btn close" data-act="close" title="关闭" aria-label="关闭">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </button>
    </div>`
  bindControlActions(host)
  syncMaximizeBtn(host.querySelector('[data-act="maximize"]'))
}

function bindControlActions(host) {
  host.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      const api = wc()
      if (!api) return
      const act = btn.dataset.act
      if (act === 'minimize') await api.windowMinimize()
      else if (act === 'maximize') {
        const maxed = await api.windowMaximize()
        chrome.isMaximized = maxed
        syncMaximizeBtn(document.querySelector('.tb-win-btn.max'))
      } else if (act === 'close') await api.windowClose()
    })
  })
}

function renderControls() {
  const winHost = document.getElementById('titlebarWin')
  if (!winHost) return
  winHost.hidden = false
  mountWinControls(winHost)
}

export function applyChrome(prefs) {
  chrome = { ...DEFAULT, ...prefs, style: 'windows' }
  applyChromeClasses(document.getElementById('appRoot'))
  renderControls()
}

async function mirrorToDb() {
  try {
    await db.put('settings', {
      id: 'windowChrome',
      value: {
        style: 'windows',
        showProject: chrome.showProject,
        showSession: chrome.showSession,
        showTheme: chrome.showTheme,
        showConnection: chrome.showConnection,
      },
    })
  } catch { /* ignore */ }
}

export async function saveChrome(patch) {
  const next = { ...patch, style: 'windows' }
  chrome = { ...chrome, ...next }
  applyChrome(chrome)
  await mirrorToDb()
  const api = wc()
  if (api?.setWindowChrome) {
    try {
      const res = await api.setWindowChrome(next)
      if (res?.chrome) {
        chrome = { ...chrome, ...res.chrome, style: 'windows' }
        applyChrome(chrome)
        await mirrorToDb()
      }
      return res || { ok: true, chrome, recreated: false }
    } catch {
      return { ok: true, chrome, recreated: false, degraded: true }
    }
  }
  return { ok: true, chrome, recreated: false }
}

export async function initTitleBar() {
  const api = wc()
  let prefs = { ...DEFAULT }
  if (api?.getWindowChrome) {
    try { prefs = await api.getWindowChrome() } catch {}
  } else {
    try {
      const saved = await db.get('settings', 'windowChrome')
      if (saved?.value) prefs = { ...prefs, ...saved.value }
    } catch {}
  }
  chrome = { ...DEFAULT, ...prefs, style: 'windows', isMaximized: !!prefs.isMaximized }
  applyChrome(chrome)
  await mirrorToDb()

  api?.onWindowChrome?.(payload => {
    chrome = { ...chrome, ...payload, style: 'windows' }
    applyChrome(chrome)
    syncMaximizeBtn(document.querySelector('.tb-win-btn.max'))
  })
  api?.onWindowMaximized?.(maxed => {
    chrome.isMaximized = maxed
    syncMaximizeBtn(document.querySelector('.tb-win-btn.max'))
  })

  document.getElementById('appRoot')?.addEventListener('dblclick', async e => {
    const inTop = e.target.closest('.topbar')
    if (!inTop) return
    if (e.target.closest('button, a, input, select, textarea, .topbar-chrome')) return
    const maxed = await api?.windowMaximize?.()
    if (typeof maxed === 'boolean') {
      chrome.isMaximized = maxed
      syncMaximizeBtn(document.querySelector('.tb-win-btn.max'))
    }
  })
}
