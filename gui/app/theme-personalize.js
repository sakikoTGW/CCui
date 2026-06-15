// 外观个性化：强调色 + 画布背景 + 字体 + 背景自适应文字
import { db } from './db.js'

/** @typedef {{ mode: 'default'|'color'|'image', color?: string, image?: string, overlay?: number, blur?: number }} BgPrefs */
/** @typedef {{ accent: string|null, bg: BgPrefs, fontFamily: string|null, adaptiveText: boolean }} ThemePersonalize */

export const DEFAULT_FONT_STACK =
  '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Microsoft YaHei UI", "微软雅黑", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'

const ADAPTIVE_KEYS = ['--text', '--text-2', '--text-3', '--glass', '--surface', '--surface-2', '--border', '--divider', '--hover-bg']

const TEXT_ON_DARK = {
  '--text': '#f2f2f7',
  '--text-2': '#b8b8be',
  '--text-3': '#8e8e93',
  '--glass': 'rgba(28,28,30,0.76)',
  '--surface': 'rgba(38,38,40,0.86)',
  '--surface-2': 'rgba(46,46,48,0.82)',
  '--border': 'rgba(255,255,255,0.14)',
  '--divider': 'rgba(255,255,255,0.1)',
  '--hover-bg': 'rgba(255,255,255,0.08)',
}

const TEXT_ON_LIGHT = {
  '--text': '#1a1a1a',
  '--text-2': '#5c5c5c',
  '--text-3': '#888888',
  '--glass': 'rgba(255,255,255,0.78)',
  '--surface': 'rgba(255,255,255,0.88)',
  '--surface-2': 'rgba(245,245,247,0.85)',
  '--border': 'rgba(0,0,0,0.1)',
  '--divider': 'rgba(0,0,0,0.08)',
  '--hover-bg': 'rgba(0,0,0,0.06)',
}

export const DEFAULT_PERSONALIZE = () => ({
  accent: null,
  bg: { mode: 'default', color: '#f5f5f7', image: '', overlay: 0.42, blur: 0 },
  fontFamily: null,
  adaptiveText: true,
})

let cached = DEFAULT_PERSONALIZE()
/** @type {'light'|'dark'|null} */
let lastBgTone = null
let adaptiveJob = 0

export function getPersonalize() {
  return {
    ...cached,
    bg: { ...cached.bg },
    fontFamily: cached.fontFamily || null,
    adaptiveText: cached.adaptiveText !== false,
  }
}

function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length !== 6) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function mixHex(a, b, t) {
  const ar = hexToRgb(a)
  const br = hexToRgb(b)
  if (!ar || !br) return a
  return '#' + ar.map((v, i) => Math.round(v + (br[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

export function deriveAccentWeak(accent, dark) {
  if (!accent) return null
  return mixHex(accent, dark ? '#1c1c1e' : '#ffffff', dark ? 0.78 : 0.86)
}

export function luminanceFromHex(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0.5
  const [r, g, b] = rgb.map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function escUrl(url) {
  return String(url || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escFontName(name) {
  return String(name || '').replace(/"/g, '\\"')
}

/** @param {HTMLElement} app */
function ensureAppBgCanvas(app) {
  let el = app.querySelector('.app-bg-canvas')
  if (!el) {
    el = document.createElement('div')
    el.className = 'app-bg-canvas'
    el.setAttribute('aria-hidden', 'true')
    el.innerHTML = '<div class="app-bg-base"></div><div class="app-bg-glow" hidden></div>'
    app.insertBefore(el, app.firstChild)
    return el
  }
  if (!el.querySelector('.app-bg-base')) {
    const legacyBg = el.style.background || ''
    el.style.background = ''
    el.innerHTML = '<div class="app-bg-base"></div><div class="app-bg-glow" hidden></div>'
    if (legacyBg) el.querySelector('.app-bg-base').style.background = legacyBg
  }
  return el
}

/** @param {BgPrefs} bg @param {Record<string,string>} themeVars */
export function buildAppBgBaseLayer(bg, themeVars) {
  const accent = themeVars['--accent'] || '#d97757'
  const base = themeVars['--bg'] || '#f5f5f7'
  const mode = bg?.mode || 'default'

  if (mode === 'color' && bg.color) {
    const c = bg.color
    return `linear-gradient(165deg, color-mix(in srgb, ${c} 88%, #fff), ${c})`
  }

  if (mode === 'image' && bg.image) {
    const ov = Math.min(0.85, Math.max(0, Number(bg.overlay) ?? 0.42))
    const img = bg.image.startsWith('data:') ? bg.image : escUrl(bg.image)
    const imgRef = bg.image.startsWith('data:') ? `url(${img})` : `url("${img}")`
    return [
      `linear-gradient(color-mix(in srgb, ${base} ${Math.round(ov * 100)}%, transparent), color-mix(in srgb, ${base} ${Math.round(ov * 100)}%, transparent))`,
      `${imgRef} center/cover no-repeat`,
    ].join(', ')
  }

  return `linear-gradient(160deg, color-mix(in srgb, ${base} 92%, #fff), ${base})`
}

/** 默认背景的光晕层 — 视差时偏移更大 */
export function buildAppBgGlowLayer(bg, themeVars) {
  const mode = bg?.mode || 'default'
  if (mode !== 'default') return null
  const accent = themeVars['--accent'] || '#d97757'
  return [
    `radial-gradient(70% 60% at -10% -10%, color-mix(in srgb, ${accent} 16%, transparent), transparent 65%)`,
    `radial-gradient(80% 70% at 110% 110%, color-mix(in srgb, #8b5cf6 14%, transparent), transparent 62%)`,
  ].join(', ')
}

/** @param {BgPrefs} bg @param {Record<string,string>} themeVars */
export function buildAppBgLayer(bg, themeVars) {
  const base = buildAppBgBaseLayer(bg, themeVars)
  const glow = buildAppBgGlowLayer(bg, themeVars)
  if (!glow) return base
  return `${glow}, ${base}`
}

function readThemeVars() {
  const cs = getComputedStyle(document.documentElement)
  const keys = ['--bg', '--surface', '--accent', '--text']
  const vars = {}
  for (const k of keys) vars[k] = cs.getPropertyValue(k).trim()
  return vars
}

function applyFontFamily(fontFamily) {
  const stack = fontFamily
    ? `"${escFontName(fontFamily)}", ${DEFAULT_FONT_STACK}`
    : DEFAULT_FONT_STACK
  document.documentElement.style.setProperty('--sans', stack)
}

function clearAdaptiveText() {
  const root = document.documentElement
  root.classList.remove('bg-tone-light', 'bg-tone-dark')
  for (const k of ADAPTIVE_KEYS) root.style.removeProperty(k)
  lastBgTone = null
}

/** @param {number} lum 0..1 */
function applyTextPaletteFromLuminance(lum) {
  const root = document.documentElement
  let tone = lum < 0.48 ? 'dark' : lum > 0.54 ? 'light' : (lastBgTone || (lum < 0.51 ? 'dark' : 'light'))
  lastBgTone = tone
  const palette = tone === 'dark' ? TEXT_ON_DARK : TEXT_ON_LIGHT
  root.classList.toggle('bg-tone-light', tone === 'light')
  root.classList.toggle('bg-tone-dark', tone === 'dark')
  for (const [k, v] of Object.entries(palette)) root.style.setProperty(k, v)
}

function hasCustomBackground(bg) {
  return (bg.mode === 'image' && !!bg.image) || (bg.mode === 'color' && !!bg.color)
}

/** @param {string} src @param {number} overlay @param {string} baseHex */
function sampleImageLuminance(src, overlay, baseHex) {
  return new Promise(resolve => {
    const img = new Image()
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 48
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) { resolve(null); return }
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        let sum = 0
        let n = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 16) continue
          sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
          n++
        }
        const imgLum = n ? sum / n : 0.5
        const ov = Math.min(0.85, Math.max(0, Number(overlay) ?? 0.42))
        const baseLum = luminanceFromHex(baseHex || '#f5f5f7')
        resolve(imgLum * (1 - ov) + baseLum * ov)
      } catch {
        resolve(luminanceFromHex(baseHex || '#f5f5f7'))
      }
    }
    img.onerror = () => resolve(luminanceFromHex(baseHex || '#f5f5f7'))
    img.src = src
  })
}

/** @param {ThemePersonalize} prefs @param {Record<string,string>} themeVars */
async function refreshAdaptiveText(prefs, themeVars) {
  const job = ++adaptiveJob
  const bg = prefs.bg
  const enabled = prefs.adaptiveText !== false
  const custom = hasCustomBackground(bg)

  if (!enabled || !custom) {
    clearAdaptiveText()
    return
  }

  let lum = 0.5
  if (bg.mode === 'color' && bg.color) {
    lum = luminanceFromHex(bg.color)
  } else if (bg.mode === 'image' && bg.image) {
    lum = await sampleImageLuminance(bg.image, bg.overlay, themeVars['--bg'])
    if (job !== adaptiveJob) return
  }

  applyTextPaletteFromLuminance(lum)
}

/** @param {ThemePersonalize} prefs @param {Record<string,string>} [themeVars] */
export function applyPersonalize(prefs, themeVars) {
  cached = {
    accent: prefs?.accent || null,
    bg: { ...DEFAULT_PERSONALIZE().bg, ...(prefs?.bg || {}) },
    fontFamily: prefs?.fontFamily || null,
    adaptiveText: prefs?.adaptiveText !== false,
  }
  const vars = themeVars || readThemeVars()
  const dark = document.documentElement.dataset.theme === 'dark'

  if (cached.accent) {
    document.documentElement.style.setProperty('--accent', cached.accent)
    const weak = deriveAccentWeak(cached.accent, dark)
    if (weak) document.documentElement.style.setProperty('--accent-weak', weak)
  }

  applyFontFamily(cached.fontFamily)

  const layer = buildAppBgLayer(cached.bg, vars)
  const baseLayer = buildAppBgBaseLayer(cached.bg, vars)
  const glowLayer = buildAppBgGlowLayer(cached.bg, vars)
  document.documentElement.style.setProperty('--app-bg-layer', layer)

  const app = document.getElementById('appRoot')
  if (app) {
    const hasImage = cached.bg.mode === 'image' && !!cached.bg.image
    const hasColor = cached.bg.mode === 'color' && !!cached.bg.color
    app.classList.toggle('has-bg-image', hasImage)
    app.classList.toggle('has-bg-custom', hasImage || hasColor)
    const blur = Math.min(24, Math.max(0, Number(cached.bg.blur) || 0))
    app.style.setProperty('--app-bg-blur', blur ? `${blur}px` : '0')

    const canvas = ensureAppBgCanvas(app)
    const base = canvas.querySelector('.app-bg-base')
    const glow = canvas.querySelector('.app-bg-glow')
    if (base) base.style.background = baseLayer
    if (glow) {
      if (glowLayer) {
        glow.hidden = false
        glow.style.background = glowLayer
      } else {
        glow.hidden = true
        glow.style.background = ''
        glow.style.transform = ''
      }
    }
  }

  refreshAdaptiveText(cached, vars).catch(() => {})

  window.dispatchEvent(new CustomEvent('ccui:personalize-changed', { detail: getPersonalize() }))
}

export async function loadPersonalize() {
  try {
    const saved = await db.get('settings', 'themePersonalize')
    if (saved?.value) {
      cached = {
        ...DEFAULT_PERSONALIZE(),
        ...saved.value,
        bg: { ...DEFAULT_PERSONALIZE().bg, ...saved.value?.bg },
        fontFamily: saved.value?.fontFamily || null,
        adaptiveText: saved.value?.adaptiveText !== false,
      }
    }
  } catch {}
  applyPersonalize(cached)
  return getPersonalize()
}

/** @param {ThemePersonalize} prefs */
export async function savePersonalize(prefs) {
  const next = {
    accent: prefs.accent || null,
    bg: { ...DEFAULT_PERSONALIZE().bg, ...(prefs.bg || {}) },
    fontFamily: prefs.fontFamily || null,
    adaptiveText: prefs.adaptiveText !== false,
  }
  await db.put('settings', { id: 'themePersonalize', value: next })
  applyPersonalize(next)
  return getPersonalize()
}

/** 明暗切换后重算 accent-weak 与背景层 */
export function refreshPersonalizeAfterTheme(themeVars) {
  applyPersonalize(cached, themeVars)
}
