// 活动栏导航 — 页面视图 / 快捷操作 / 底部工具（切换类）
import { ICONS } from './icons.js'

/** @typedef {{ id: string; label: string; desc: string; icon: string; view?: string }} NavViewItem */
/** @typedef {{ id: string; label: string; desc: string; icon: string }} NavActionItem */
/** @typedef {{ id: string; label: string; desc: string; icon: string }} NavUtilItem */

/** 切换主视图 */
/** @type {NavViewItem[]} */
// 侧栏 = 工作模式总机：只放「会反复主动前往、去完成某类任务的场所」。
// 其余（控制台/结构图/工作室/简报/扩展/抓包克隆）不是工作模式，已下放到对应流程或命令面板(Ctrl+K)。
export const NAV_VIEWS = [
  { id: 'chat', view: 'chat', label: '对话', desc: '与 AI 对话、执行任务', icon: 'chat' },
  { id: 'review', view: 'review', label: '审查', desc: '审阅并批准 AI 的改动', icon: 'review' },
]

/** 快捷操作（非页面切换） */
/** @type {NavActionItem[]} */
export const NAV_ACTIONS = [
  { id: 'launcherWin', label: '主页', desc: '选项目、看当前 instance（独立窗口）', icon: 'projects' },
  { id: 'harnessWin', label: 'Harness', desc: 'CCui 驾驭的运行时 / 实例（独立窗口）', icon: 'harness' },
  { id: 'settings', label: '设置', desc: 'API Key、模型、资源与偏好', icon: 'settings' },
]

/** 底部工具（面板开关） */
/** @type {NavUtilItem[]} */
export const NAV_UTILS = [
  { id: 'cmdPaletteBtn', label: '命令面板', desc: 'Ctrl+K 快速搜索功能', icon: 'search' },
  { id: 'treeToggle', label: '文件树', desc: '打开或关闭文件面板', icon: 'files' },
]

const LS_KEY = 'ccui:nav-expanded'
/** ≥ 此宽：inline 推开式展开（236px 占列）；更窄：改 overlay 抽屉浮层（与 style.css .nav-overlay 对齐） */
export const NAV_INLINE_MIN_WIDTH = 1120

/** 窄窗 overlay 抽屉的临时展开态 —— 不写 localStorage，缩窗自动收起 */
let overlayOpen = false

function el(tag, cls, html) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (html != null) node.innerHTML = html
  return node
}

/** 当前是否走 overlay 抽屉模式（窄窗） */
function isOverlay() {
  return window.innerWidth < NAV_INLINE_MIN_WIDTH
}

/** 用户在宽窗记住的展开意图（localStorage） */
function intentExpanded() {
  return localStorage.getItem(LS_KEY) !== '0'
}

/** 当前实际是否展开：窄窗看临时浮层态，宽窗看持久意图 */
function isExpanded() {
  return isOverlay() ? overlayOpen : intentExpanded()
}

function setExpanded(next, opts = {}) {
  if (isOverlay()) {
    overlayOpen = next
  } else {
    localStorage.setItem(LS_KEY, next ? '1' : '0')
  }
  if (opts.instant) document.getElementById('appRoot')?.classList.add('nav-instant')
  applyNavLayout()
  if (opts.instant) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('appRoot')?.classList.remove('nav-instant')
      })
    })
  }
}

/** overlay 抽屉展开时，点导航项后带动画收起（供外部在切视图前调用） */
export function collapseNavIfOverlay() {
  if (!isOverlay() || !overlayOpen) return false
  setExpanded(false)
  return true
}

export function syncNavViewport() {
  // 进入/处于 overlay 模式时收起浮层，避免缩窗后抽屉盖住正文
  if (isOverlay()) overlayOpen = false
  applyNavLayout()
}

export function applyNavLayout() {
  const overlay = isOverlay()
  const expanded = overlay ? overlayOpen : intentExpanded()
  const app = document.getElementById('appRoot')
  const nav = document.getElementById('activityNav')
  if (app) {
    app.classList.toggle('nav-overlay', overlay)
    app.classList.toggle('nav-expanded', expanded)
  }
  if (nav) nav.classList.toggle('expanded', expanded)
  const scrim = document.getElementById('navScrim')
  if (scrim) scrim.classList.toggle('show', overlay && expanded)
  const btn = document.getElementById('navExpandToggle')
  if (btn) {
    btn.title = expanded ? '收起边栏 (Ctrl+B)' : '展开边栏 (Ctrl+B)'
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    btn.innerHTML = expanded
      ? `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M15 6l-6 6 6 6"/></svg>`
      : `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M9 6l6 6-6 6"/></svg>`
  }
}

function appendLabel(btn, item) {
  const icon = el('span', 'act-icon', ICONS[item.icon] || '')
  const text = el('span', 'act-text', `<span class="act-label">${item.label}</span><span class="act-desc">${item.desc}</span>`)
  btn.append(icon, text)
}

function renderNavView(item) {
  const btn = el('button', 'act')
  btn.id = item.id
  btn.type = 'button'
  btn.dataset.view = item.view
  btn.title = `${item.label} — ${item.desc}`
  appendLabel(btn, item)
  return btn
}

function renderNavAction(item) {
  const btn = el('button', 'act act-action')
  btn.id = item.id
  btn.type = 'button'
  if (item.id === 'settings') btn.dataset.view = 'settings'
  if (item.id === 'openReview') btn.dataset.view = 'review'
  btn.title = `${item.label} — ${item.desc}`
  appendLabel(btn, item)
  return btn
}

function renderNavUtil(item) {
  const btn = el('button', 'nav-util')
  btn.id = item.id
  btn.type = 'button'
  btn.title = `${item.label} — ${item.desc}`
  appendLabel(btn, item)
  return btn
}

/** 构建活动栏 */
export function initActivityNav() {
  const nav = document.getElementById('activityNav')
  if (!nav) return

  nav.innerHTML = ''

  const head = el('div', 'nav-head')
  const brand = el('div', 'nav-brand-mark', 'C')
  brand.setAttribute('aria-hidden', 'true')
  const toggle = el('button', 'nav-expand-toggle', '')
  toggle.id = 'navExpandToggle'
  toggle.type = 'button'
  toggle.setAttribute('aria-label', '展开或收起边栏')
  toggle.onclick = () => setExpanded(!isExpanded())
  head.append(brand, toggle)
  nav.append(head)

  for (const item of NAV_VIEWS) nav.append(renderNavView(item))

  nav.append(el('div', 'act-spacer'))

  const foot = el('div', 'nav-foot')
  const bottom = el('div', 'nav-bottom')
  for (const item of NAV_ACTIONS) bottom.append(renderNavAction(item))
  foot.append(bottom)
  const utils = el('div', 'nav-utils')
  for (const item of NAV_UTILS) utils.append(renderNavUtil(item))
  foot.append(utils)
  nav.append(foot)

  // 窄窗 overlay：capture 阶段先带动画收起，再让按钮 onclick 切视图/开面板
  nav.addEventListener('click', e => {
    if (!isOverlay() || !overlayOpen) return
    const t = e.target
    if (!(t instanceof HTMLElement)) return
    if (t.closest('.nav-expand-toggle')) return
    if (t.closest('.act[data-view], .act-action, .nav-util')) setExpanded(false)
  }, true)

  // overlay 抽屉遮罩：点击收起浮层（仅窄窗展开时可点）
  const app = document.getElementById('appRoot')
  if (app && !document.getElementById('navScrim')) {
    const scrim = el('div', 'nav-scrim')
    scrim.id = 'navScrim'
    scrim.setAttribute('aria-hidden', 'true')
    scrim.addEventListener('click', () => setExpanded(false))
    app.appendChild(scrim)
  }

  document.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.key.toLowerCase() !== 'b' || e.shiftKey || e.altKey) return
    const t = e.target
    if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    e.preventDefault()
    setExpanded(!isExpanded())
  })
  applyNavLayout()
  syncNavViewport()
  window.addEventListener('resize', syncNavViewport)
}

export function getNavExpanded() {
  return isExpanded()
}
