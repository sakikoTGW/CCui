// UI 基础设施：Toast 通知 + 主题系统。零依赖。
import { db } from './db.js'

// ---------- Toast ----------
let toastRoot = null
function ensureToastRoot() {
  if (toastRoot) return toastRoot
  toastRoot = document.createElement('div')
  toastRoot.className = 'toast-root'
  document.body.appendChild(toastRoot)
  return toastRoot
}

export function toast(message, opts = {}) {
  const { type = 'info', timeout = 3200, action } = opts
  const root = ensureToastRoot()
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  const icon = { info: 'i', success: '✓', error: '!', warn: '!' }[type] || 'i'
  el.innerHTML = `<span class="ti">${icon}</span><span class="tm"></span>`
  el.querySelector('.tm').textContent = message
  if (action) {
    const b = document.createElement('button')
    b.className = 'ta'
    b.textContent = action.label
    b.onclick = () => { action.onClick(); dismiss() }
    el.appendChild(b)
  }
  root.appendChild(el)
  requestAnimationFrame(() => el.classList.add('show'))
  let timer = null
  function dismiss() {
    if (timer) clearTimeout(timer)
    el.classList.remove('show')
    el.addEventListener('transitionend', () => el.remove(), { once: true })
  }
  if (timeout > 0) timer = setTimeout(dismiss, timeout)
  return dismiss
}

// ---------- 内联确认气泡（替代 confirm） ----------
export function confirmPopover(anchorEl, message, onConfirm) {
  const existing = document.querySelector('.confirm-pop')
  if (existing) existing.remove()
  const pop = document.createElement('div')
  pop.className = 'confirm-pop'
  pop.innerHTML = `<div class="cp-msg"></div><div class="cp-btns"><button class="cp-no">取消</button><button class="cp-yes">确认</button></div>`
  pop.querySelector('.cp-msg').textContent = message
  document.body.appendChild(pop)
  const r = anchorEl.getBoundingClientRect()
  pop.style.top = `${r.bottom + 6}px`
  pop.style.left = `${Math.min(r.left, window.innerWidth - pop.offsetWidth - 12)}px`
  const close = () => { pop.remove(); document.removeEventListener('mousedown', outside) }
  const outside = e => { if (!pop.contains(e.target)) close() }
  setTimeout(() => document.addEventListener('mousedown', outside), 0)
  pop.querySelector('.cp-no').onclick = close
  pop.querySelector('.cp-yes').onclick = () => { onConfirm(); close() }
}

// ---------- 主题 ----------
const BUILTIN_THEMES = {
  light: {
    '--bg': '#f5f5f7', '--surface': '#ffffff', '--surface-2': '#f0eeec',
    '--border': '#e6e4e1', '--text': '#1a1a1a', '--text-2': '#6b6b6b',
    '--text-3': '#999999', '--accent': '#d97757', '--accent-weak': '#f6e6df',
    '--glass': 'rgba(255,255,255,0.72)',
  },
  dark: {
    '--bg': '#1c1c1e', '--surface': '#262628', '--surface-2': '#2e2e30',
    '--border': '#3a3a3c', '--text': '#f2f2f2', '--text-2': '#a8a8ac',
    '--text-3': '#7a7a7e', '--accent': '#e08a6b', '--accent-weak': '#3a2c26',
    '--glass': 'rgba(38,38,40,0.72)',
  },
}

export async function applyTheme(name, customVars) {
  const vars = customVars || BUILTIN_THEMES[name] || BUILTIN_THEMES.light
  for (const [k, v] of Object.entries(vars)) {
    document.documentElement.style.setProperty(k, v)
  }
  document.documentElement.dataset.theme = name
  await db.put('settings', { id: 'theme', name, vars: customVars || null })
}

export async function loadTheme() {
  try {
    const saved = await db.get('settings', 'theme')
    if (saved) { await applyTheme(saved.name, saved.vars); return saved.name }
  } catch {}
  await applyTheme('light')
  return 'light'
}

export { BUILTIN_THEMES }
