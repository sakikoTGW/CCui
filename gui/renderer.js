// CCui 入口 — 布局参照 Cursor Agents Window + Codex thread sidebar
import { store } from './app/store.js'
import { loadTheme, applyTheme, applyThemeWithFade, toast } from './app/ui.js'
import { db } from './app/db.js'
import { permSummary, getAllowedTools } from './app/permissions.js'
import { mountChat } from './app/views/chat.js'
import { mountPresets, initPresetHotkeys } from './app/views/presets.js'
import { mountTemplates } from './app/views/templates.js'
import { mountThemeEditor, restoreCustomStyle } from './app/views/theme-editor.js'
import { mountStudio } from './app/views/studio.js'
import { mountSettings, applySavedConfig, maybeWelcome, preloadSystemFonts } from './app/views/settings.js'
import { mountConsole, syncDisabledToDaemon } from './app/views/console.js'
import { initFileTree } from './app/views/filetree.js'
import { mountOrchestrate } from './app/views/orchestrate.js'
import { mountCollab } from './app/views/collab.js'
import { mountContextMap } from './app/views/context-map.js'
import { mountProjects } from './app/views/projects.js'
import { mountBriefLibrary } from './app/views/brief-library.js'
import { mountReview } from './app/views/review.js'
import { initLive2D } from './app/views/live2d.js'
import { initActivityNav } from './app/nav.js'
import { ICONS } from './app/icons.js'
import { initCommandPalette, toggleCommandPalette } from './app/command-palette.js'
import { initGlobalEsc } from './app/modal.js'
import { initReviewQueueBridge, pendingCount } from './app/review-queue.js'
import { initRendererDiag, reportDiag } from './app/diag.js'
import { api } from './app/api.js'
import { getProjectsState, onProjectChanged, projectDisplayName } from './app/project-registry.js'
import { initTitleBar } from './app/titlebar.js'
import { initBgParallax } from './app/bg-parallax.js'
import { runViewTransition, warmView } from './app/view-transition.js'

const VIEWS = {
  projects: { el: null, mounted: false, mount: mountProjects, keepAlive: false },
  chat: { el: null, mounted: false, mount: mountChat, keepAlive: true },
  presets: { el: null, mounted: false, mount: mountPresets, keepAlive: false },
  templates: { el: null, mounted: false, mount: mountTemplates, keepAlive: false },
  theme: { el: null, mounted: false, mount: mountThemeEditor, keepAlive: false },
  studio: { el: null, mounted: false, mount: mountStudio, keepAlive: false },
  settings: { el: null, mounted: false, mount: mountSettings, keepAlive: true },
  console: { el: null, mounted: false, mount: mountConsole, keepAlive: false },
  orchestrate: { el: null, mounted: false, mount: mountOrchestrate, keepAlive: false },
  collab: { el: null, mounted: false, mount: mountCollab, keepAlive: false },
  map: { el: null, mounted: false, mount: mountContextMap, keepAlive: false },
  brief: { el: null, mounted: false, mount: mountBriefLibrary, keepAlive: false },
  review: { el: null, mounted: false, mount: mountReview, keepAlive: true },
}

function $(id) { return document.getElementById(id) }

async function boot() {
  initRendererDiag()
  reportDiag('info', 'boot start')
  await loadTheme()
  await restoreCustomStyle()
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => preloadSystemFonts(), { timeout: 3000 })
  else setTimeout(() => preloadSystemFonts(), 1500)
  store.set({ theme: document.documentElement.dataset.theme || 'light' })
  applyWorkspaceLayout(store.get())

  try {
    const presets = await db.getAll('presets')
    const act = await db.get('settings', 'activePreset')
    store.set({ presets, activePresetId: act?.value || null })
  } catch {}

  initGlobalEsc()
  initActivityNav()
  await initTitleBar()
  initCommandPalette(switchView)
  setupActivityBar()
  setupTheme()
  setupChrome()
  setupDaemonStatus()
  setupProjectChrome()
  bindInspector()
  initPresetHotkeys()
  initFileTree()
  initLive2D()
  initReviewQueueBridge()
  setupReviewEntry()
  initBgParallax()
  setupViewportLayout()
  void switchView('chat')
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => warmView(VIEWS, $('viewHost'), 'settings'), { timeout: 2500 })
  } else {
    setTimeout(() => warmView(VIEWS, $('viewHost'), 'settings'), 1200)
  }

  $('cmdPaletteBtn')?.addEventListener('click', () => toggleCommandPalette())

  window.addEventListener('ccui:switch-view', e => switchView(e.detail))
  store.subscribe(s => applyWorkspaceLayout(s))
  void refreshProjectLabel()
}

async function refreshProjectLabel() {
  try {
    const st = await getProjectsState()
    const cur = st.recent?.find(r => r.path === st.current) || { path: st.current }
    const name = projectDisplayName(cur)
    const btn = $('projectBtn')
    if (btn) btn.textContent = name
    store.set({ projectName: name, projectPath: st.current })
  } catch {}
}

function setupProjectChrome() {
  $('projectBtn')?.addEventListener('click', () => switchView('projects'))
  onProjectChanged(() => {
    void refreshProjectLabel()
    window.dispatchEvent(new CustomEvent('ccui:project-changed'))
  })
}

function setupReviewEntry() {
  const btn = document.getElementById('openReview')
  const syncBadge = (n) => {
    store.set({ reviewPending: n })
    if (!btn) return
    btn.dataset.count = n > 0 ? String(n) : ''
    btn.title = n > 0 ? `变更审查 (${n})` : '变更审查 (Ctrl+Shift+R)'
  }
  window.addEventListener('ccui:review-queue', e => syncBadge(e.detail?.length || 0))
  syncBadge(pendingCount())
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault()
      switchView('review')
    }
  })
}

function setupViewportLayout() {
  let resizeRaf = 0
  const apply = () => {
    const root = $('appRoot')
    if (!root) return
    const w = window.innerWidth
    root.classList.toggle('vp-compact', w < 1120)
    root.classList.toggle('vp-narrow', w < 920)
    root.classList.toggle('vp-tiny', w < 760)
    applyChatWidth()
  }
  apply()
  window.addEventListener('resize', () => {
    if (resizeRaf) return
    resizeRaf = window.requestAnimationFrame(() => {
      resizeRaf = 0
      apply()
    })
  })
  window.addEventListener('load', () => setTimeout(reportLayoutCheck, 800))
  window.addEventListener('ccui:layout-check', () => reportLayoutCheck())
}

function applyChatWidth() {
  const ws = document.querySelector('.view-chat .ws')
  const stage = document.querySelector('.view-chat .stage-main')
  if (!ws && !stage) return
  ws?.classList.add('chat-wide')
  stage?.classList.add('chat-wide')
  reportLayoutCheck()
}

function reportLayoutCheck() {
  if (store.get().view !== 'chat') return
  const root = document.getElementById('appRoot')
  const comp = document.querySelector('.view-chat .composer')
  const mainCol = document.querySelector('.main-col')
  const sessionRail = document.getElementById('sessionRail')
  const contentEl = document.querySelector('.view-chat .thinking, .view-chat .toolcard, .view-chat .msg')
  const snap = contentEl ? getComputedStyle(contentEl) : null
  const tRect = contentEl?.getBoundingClientRect()
  const cs = comp ? getComputedStyle(comp) : null
  const mcs = mainCol ? getComputedStyle(mainCol) : null
  const srRect = sessionRail?.getBoundingClientRect()
  const vp = window.innerWidth
  const vpCompact = !!root?.classList.contains('vp-compact')
  const mainColPx = mainCol ? parseFloat(mcs.width) : 0
  const contentPx = tRect?.width || 0
  const srPx = srRect?.width || 0
  const usable = vp - 48
  const widthOk = !contentEl || (mainColPx > 0 && contentPx >= mainColPx * 0.9)
  const compactOk = !vpCompact || (srPx < 2 && mainColPx >= usable * 0.92)
  const layoutOk = compactOk && widthOk
  reportDiag(layoutOk ? 'info' : 'warn', 'layout-check', {
    chatLayout: !!root?.classList.contains('chat-layout'),
    chatWide: !!document.querySelector('.view-chat .ws')?.classList.contains('chat-wide'),
    vpCompact,
    vpNarrow: !!root?.classList.contains('vp-narrow'),
    railCollapsed: !!root?.classList.contains('rail-collapsed'),
    viewport: vp,
    usableWidth: usable,
    sessionRailWidth: srPx ? `${Math.round(srPx)}px` : '0px',
    mainColWidth: mcs?.width || 'n/a',
    contentWidth: contentPx ? `${Math.round(contentPx)}px` : 'n/a',
    contentMaxWidth: snap?.maxWidth || 'n/a',
    composerMaxWidth: cs?.maxWidth || 'n/a',
    composerWidth: cs?.width || 'n/a',
    compactLayoutOk: compactOk,
    contentWidthOk: widthOk,
    layoutOk,
  })
}

function setupActivityBar() {
  document.querySelectorAll('.act[data-view]').forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view)
  })
}

let activeViewName = ''
/** @type {HTMLElement|null} */
let activeViewEl = null
let viewSwitching = false

async function switchView(name) {
  const def = VIEWS[name]
  if (!def) {
    toast('请用 Ctrl+K 打开命令面板搜索该功能', { type: 'info' })
    return
  }
  if ((name === activeViewName && activeViewEl) || viewSwitching) return

  const host = $('viewHost')
  viewSwitching = true

  document.querySelectorAll('.act[data-view]').forEach(b => {
    b.classList.toggle('act-on', b.dataset.view === name)
  })

  try {
    const result = await runViewTransition(VIEWS, host, name, {
      fromName: activeViewName,
      fromEl: activeViewEl,
      reduceMotion: false,
      onLayoutPrepare: viewName => {
        // 进入对话工作区时提前切 layout，避免分支树在淡入期间先露出再被收起
        if (viewName === 'chat') store.set({ view: 'chat' })
      },
      onLayout: viewName => store.set({ view: viewName }),
      onReady: viewName => {
        if (viewName === 'chat') applyChatWidth()
      },
    })
    if (result.el) {
      activeViewName = result.name
      activeViewEl = result.el
    }
  } catch (e) {
    if (def.el) {
      def.el.innerHTML = `<div class="error-state">视图加载失败：${e.message}</div>`
      def.el.style.display = ''
      def.el.classList.add('is-current')
      def.mounted = true
      activeViewName = name
      activeViewEl = def.el
      store.set({ view: name })
    }
  } finally {
    viewSwitching = false
  }
}

function applyWorkspaceLayout(s) {
  const root = $('appRoot')
  if (!root) return
  const isChat = s.view === 'chat'
  root.classList.toggle('chat-layout', isChat)
  root.classList.toggle('rail-collapsed', isChat && s.sessionRailCollapsed)
  root.classList.toggle('insp-collapsed', isChat && s.inspectorCollapsed)
  applyChatWidth()
}

function setupChrome() {
  $('srCollapse')?.addEventListener('click', () => {
    const next = !store.get().sessionRailCollapsed
    store.set({ sessionRailCollapsed: next })
    localStorage.setItem('ccui:session-rail', next ? '1' : '0')
  })
  $('inspToggle')?.addEventListener('click', () => {
    const next = !store.get().inspectorCollapsed
    store.set({ inspectorCollapsed: next })
    localStorage.setItem('ccui:inspector', next ? '1' : '0')
  })
  $('inspOpenSettings')?.addEventListener('click', () => switchView('settings'))
  $('inspOpenConsole')?.addEventListener('click', () => switchView('console'))
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === ',') { e.preventDefault(); switchView('settings') }
  })
}

function syncThemeToggleIcon(btn, themeName) {
  if (!btn) return
  const name = themeName || document.documentElement.dataset.theme || 'light'
  const dark = name === 'dark'
  btn.innerHTML = dark ? ICONS.themeSun : ICONS.themeToggle
  btn.title = dark ? '切换到浅色' : '切换到深色'
  btn.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题')
}

function setupTheme() {
  const btn = $('themeToggle')
  if (!btn) return
  syncThemeToggleIcon(btn)
  btn.onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    syncThemeToggleIcon(btn, next)
    store.set({ theme: next })
    void applyThemeWithFade(next)
  }
}

function setupDaemonStatus() {
  api.onMessage(msg => {
    if (msg.kind === 'status') {
      store.set({ daemonStatus: msg.state })
    } else if (msg.kind === 'exit') {
      store.set({ daemonStatus: 'offline' })
    } else if (msg.kind === 'event' && msg.event?.type === 'done') {
      if (store.get().daemonStatus !== 'error') store.set({ daemonStatus: 'ready' })
    }
  })
  api.request({ cmd: 'ping' }, 45000).then(() => {
    store.set({ daemonStatus: 'ready' })
    reportDiag('info', 'daemon ready')
  }).catch(err => {
    store.set({ daemonStatus: 'error' })
    reportDiag('error', 'daemon error', err?.message || err)
  })
}

async function syncAllowedTools() {
  try {
    const list = (await db.get('settings', 'allowedTools'))?.value || []
    await api.request({ cmd: 'setAllowedTools', tools: list }, 8000)
  } catch {}
}

function bindInspector() {
  let allowedCache = []
  getAllowedTools().then(v => { allowedCache = v; refreshPermInsp(v) })
  store.subscribe(s => {
    const modelEl = $('insp-model')
    if (modelEl) {
      modelEl.textContent = s.model || '—'
      modelEl.className = 'v ' + (s.tier === 'strong' ? 'badge-strong' : 'badge-weak')
    }
    setText('insp-route', s.routeReason ? `${s.tier} · ${s.routeReason}` : '')
    setText('insp-usage', s.usage.input || s.usage.output ? `in ${s.usage.input} / out ${s.usage.output}` : '—')
    setText('insp-cost', `$${s.totalCost.toFixed(4)}`)
    const ap = s.presets.find(p => p.id === s.activePresetId)
    setText('insp-preset', ap ? ap.name : '默认')

    const dot = $('dot')
    const pill = $('statusPill')
    const label = $('statusLabel')
    let state = s.daemonStatus
    if ((s.busy || s.orchBusy) && state === 'ready') state = 'busy'
    if (dot) dot.dataset.state = state
    if (pill) pill.dataset.state = state
    if (label) {
      label.textContent = {
        starting: '连接中…', ready: '已就绪', busy: '生成中…', error: '连接异常', offline: '已断开',
      }[state] || state
    }
  })
  window.addEventListener('ccui:perms-updated', e => refreshPermInsp(e.detail || []))
}

function refreshPermInsp(list) {
  setText('insp-perms', permSummary(list))
}

function setText(id, text) { const el = $(id); if (el) el.textContent = text }

boot().then(async () => {
  reportDiag('info', 'boot ok')
  await applySavedConfig()
  await syncAllowedTools()
  const allowed = await getAllowedTools()
  refreshPermInsp(allowed)
  maybeWelcome()
}).catch(err => {
  reportDiag('error', 'boot failed', err?.message || err)
  console.error('[CCui] boot failed:', err)
  const host = $('viewHost')
  if (host) {
    host.innerHTML = `<div class="error-state" style="padding:32px;margin:24px">界面加载失败：${err?.message || err}<br/><small>请打开 DevTools (Ctrl+Shift+I) 查看详情，或重启 CCui。</small></div>`
  }
  toast('界面加载失败，请重启', { type: 'error' })
})
