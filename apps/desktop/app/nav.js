// 活动栏导航 — 页面视图 / 快捷操作 / 底部工具（切换类）
import { ICONS } from './icons.js'

/** @typedef {{ id: string; label: string; desc: string; icon: string; view?: string }} NavViewItem */
/** @typedef {{ id: string; label: string; desc: string; icon: string }} NavActionItem */
/** @typedef {{ id: string; label: string; desc: string; icon: string }} NavUtilItem */

/** 切换主视图 */
/** @type {NavViewItem[]} */
export const NAV_VIEWS = [
  { id: 'projects', view: 'projects', label: '项目', desc: '打开文件夹、切换工作区', icon: 'projects' },
  { id: 'chat', view: 'chat', label: '工作区', desc: '与 AI 对话、执行任务', icon: 'chat' },
  { id: 'console', view: 'console', label: '控制台', desc: 'Skills / MCP / 权限开关', icon: 'console' },
  { id: 'studio', view: 'studio', label: '数据工作室', desc: '查看运行数据与统计', icon: 'studio' },
  { id: 'map', view: 'map', label: '项目结构图', desc: '可视化代码结构与依赖', icon: 'map' },
  { id: 'brief', view: 'brief', label: '简报库', desc: 'Task Brief 任务简报管理', icon: 'brief' },
  { id: 'plugins', view: 'plugins', label: '扩展', desc: '第三方插件 · 沙箱 iframe', icon: 'plugins' },
]

/** 快捷操作（非页面切换） */
/** @type {NavActionItem[]} */
export const NAV_ACTIONS = [
  { id: 'openReview', label: '变更审查', desc: '查看 AI 改动的 diff', icon: 'review' },
  { id: 'settings', label: '设置', desc: 'API Key、模型与偏好', icon: 'settings' },
]

/** 底部工具（面板开关） */
/** @type {NavUtilItem[]} */
export const NAV_UTILS = [
  { id: 'cmdPaletteBtn', label: '命令面板', desc: 'Ctrl+K 快速搜索功能', icon: 'search' },
  { id: 'treeToggle', label: '文件树', desc: '打开或关闭文件面板', icon: 'files' },
]

const LS_KEY = 'ccui:nav-expanded'

function el(tag, cls, html) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (html != null) node.innerHTML = html
  return node
}

function isExpanded() {
  return localStorage.getItem(LS_KEY) !== '0'
}

function canExpandNav() {
  return window.innerWidth >= 760
}

function setExpanded(expanded) {
  if (expanded && !canExpandNav()) expanded = false
  localStorage.setItem(LS_KEY, expanded ? '1' : '0')
  applyNavLayout(expanded)
}

function syncNavViewport() {
  if (!canExpandNav()) {
    applyNavLayout(false)
    return
  }
  applyNavLayout()
}

export function applyNavLayout(expanded = isExpanded()) {
  if (expanded && !canExpandNav()) expanded = false
  const app = document.getElementById('appRoot')
  const nav = document.getElementById('activityNav')
  if (app) app.classList.toggle('nav-expanded', expanded)
  if (nav) nav.classList.toggle('expanded', expanded)
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
  toggle.onclick = () => {
    if (!isExpanded() && !canExpandNav()) return
    setExpanded(!isExpanded())
  }
  head.append(brand, toggle)
  nav.append(head)

  for (const item of NAV_VIEWS) nav.append(renderNavView(item))

  nav.append(el('div', 'act-spacer'))

  const bottom = el('div', 'nav-bottom')
  for (const item of NAV_ACTIONS) bottom.append(renderNavAction(item))
  nav.append(bottom)

  const utils = el('div', 'nav-utils')
  for (const item of NAV_UTILS) utils.append(renderNavUtil(item))
  nav.append(utils)

  document.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.key.toLowerCase() !== 'b' || e.shiftKey || e.altKey) return
    const t = e.target
    if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    e.preventDefault()
    if (!isExpanded() && !canExpandNav()) return
    setExpanded(!isExpanded())
  })
  applyNavLayout()
  syncNavViewport()
  window.addEventListener('resize', syncNavViewport)
}

export function getNavExpanded() {
  return isExpanded()
}
