// UI 基础设施：Toast 通知 + 主题系统。
import { db } from './db.js'
import { bus } from './bus.js'

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
import { applyPersonalize, loadPersonalize, refreshPersonalizeAfterTheme, buildAppBgLayer, getPersonalize } from './theme-personalize.js'

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

function applyThemeVars(name, customVars) {
  const vars = customVars || BUILTIN_THEMES[name] || BUILTIN_THEMES.light
  document.documentElement.classList.add('theme-sync')
  for (const [k, v] of Object.entries(vars)) {
    document.documentElement.style.setProperty(k, v)
  }
  document.documentElement.dataset.theme = name
  refreshPersonalizeAfterTheme(vars)
  applyHljsTheme(name)
  bus.emit('theme-changed', { theme: name })
  window.setTimeout(() => document.documentElement.classList.remove('theme-sync'), 480)
  return vars
}

function applyHljsTheme(name) {
  const link = document.getElementById('hljs-theme')
  if (!link) return
  const file = name === 'dark' ? 'github-dark.css' : 'github.css'
  const href = `node_modules/highlight.js/styles/${file}`
  const notify = () => bus.emit('hljs-theme')
  if (link.getAttribute('href') === href) {
    notify()
    return
  }
  link.onload = () => { link.onload = null; notify() }
  link.onerror = () => { link.onerror = null; notify() }
  link.setAttribute('href', href)
}

export async function applyTheme(name, customVars) {
  applyThemeVars(name, customVars)
  await db.put('settings', { id: 'theme', name, vars: customVars || null })
}

const THEME_BASE_MS = 280
const THEME_WASH_MS = 520

function cleanupThemeLayers(base, wash) {
  base?.remove()
  wash?.remove()
}

function buildThemePlate(vars) {
  const layer = vars['--app-bg-layer']
  if (layer) return layer
  return buildAppBgLayer(getPersonalize().bg, vars)
}

function hasCustomBackground() {
  const bg = getPersonalize().bg
  return (bg.mode === 'image' && !!bg.image) || (bg.mode === 'color' && !!bg.color)
}

/** 底板洗光过渡；立即切换变量，动画后台播放，不阻塞 UI */
export async function applyThemeWithFade(name, customVars) {
  const vars = customVars || BUILTIN_THEMES[name] || BUILTIN_THEMES.light

  applyThemeVars(name, customVars)
  db.put('settings', { id: 'theme', name, vars: customVars || null }).catch(() => {})

  // 自定义背景（尤其图片）已在 canvas 上更新；跳过全屏底板层，避免 scale(1)↔scale(1.04) 跳动
  if (hasCustomBackground()) return

  const app = document.getElementById('appRoot')
  if (!app) return

  document.querySelectorAll('.theme-base-fade, .theme-wash-fade').forEach(el => el.remove())

  const base = document.createElement('div')
  base.className = 'theme-base-fade'
  base.style.background = buildThemePlate(vars)

  const wash = document.createElement('div')
  wash.className = 'theme-wash-fade'
  if (name === 'dark') wash.classList.add('theme-wash-dark')

  document.body.append(base, wash)

  requestAnimationFrame(() => {
    base.classList.add('in')
    wash.classList.add('run')
  })

  setTimeout(() => base.classList.add('out'), THEME_BASE_MS * 0.55)
  setTimeout(() => cleanupThemeLayers(base, wash), THEME_WASH_MS + 80)
}

export async function loadTheme() {
  try {
    const saved = await db.get('settings', 'theme')
    if (saved) {
      applyThemeVars(saved.name, saved.vars)
      await loadPersonalize()
      return saved.name
    }
  } catch {}
  await applyTheme('light')
  await loadPersonalize()
  return 'light'
}

export { BUILTIN_THEMES }
export { loadPersonalize, savePersonalize, applyPersonalize, getPersonalize, DEFAULT_FONT_STACK } from './theme-personalize.js'
