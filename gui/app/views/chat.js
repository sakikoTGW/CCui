// 对话视图：Markdown/代码高亮/thinking/工具透明化 + 会话持久化 + 历史
import { marked } from '../../node_modules/marked/lib/marked.esm.js'
import hljs from '../../vendor/hljs.js'
import { store } from '../store.js'
import { api, humanizeError } from '../api.js'
import { db, uid } from '../db.js'
import { toast, confirmPopover } from '../ui.js'
import { attachTemplateEngine } from './templates.js'
import { buildStylePrompt } from './settings.js'
import { ICONS } from '../icons.js'
import { toggleAllowedTool } from '../permissions.js'
import { enqueue, remove, clear as clearReviewQueue } from '../review-queue.js'
import { runCompare, stopParallel } from '../parallel.js'
import { blankThread, laneThread, assistantSdk, synthesisSdk } from '../thread.js'
import {
  COMPLETION_RULE,
  hasCompletionSignal,
  stripCompletionSignal,
  buildContinuationPrompt,
  createContinuationTracker,
  canAutoContinue,
  consumeContinuation,
  lastAssistantPlainText,
  isTruncationError,
} from '../completion.js'
import { renderBranchTree } from '../branch-tree.js'
import { bindGoalHotkey } from '../brief/composer.js'
import { briefSummary, stripBriefMarker } from '../brief/schema.js'
import { mountIntentRail, computeIntent } from '../intent-rail.js'
import { buildHydratePayload } from '../session-sync.js'
import { createCcSelect } from '../cc-select.js'

const DRAFT_KEY = id => `ccui:draft:${id || 'new'}`
const EMPTY_HTML = `<div class="empty-brand" aria-hidden="true">C</div>
  <h1>开始对话</h1>
  <p>左侧每条都是独立会话。拖拽文件到输入框可附加路径。<br/>
  悬停你的消息可<strong>编辑并分叉</strong>；<kbd>Ctrl+Shift+E</kbd> 编辑上一条。<br/>
  左侧<strong>分支树</strong> · 发送框上方可<strong>钉住这次要做</strong>（<kbd>Ctrl+Shift+B</kbd>） · 活动栏<strong>结构图</strong>。</p>
  <div class="examples">
    <button class="ex" type="button">解释这段代码在做什么</button>
    <button class="ex" type="button">帮我写单元测试</button>
    <button class="ex" type="button">读取 package.json 的 name</button>
    <button class="ex" type="button">这个项目是做什么的？</button>
  </div>`

// 语言已在 vendor/hljs.js bundle 内注册
marked.setOptions({ breaks: true, gfm: true })

let els = null
let toolCards = new Map()
let convo = null // { id, title, createdAt, updatedAt, items: [] }
let streamBubble = null // 流式临时气泡 { el, body, text }
let continuationTracker = null
let bulkRendering = false
/** @type {ReturnType<typeof mountIntentRail>|null} */
let intentRail = null
/** @type {ReturnType<typeof createCcSelect> | null} */
let presetSelect = null
/** @type {ReturnType<typeof createCcSelect> | null} */
let checkpointSelect = null

function refreshIntentRail() {
  intentRail?.refresh()
}

function handleIntentDebt(action) {
  switch (action) {
    case 'review':
      window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'review' }))
      break
    case 'compare':
      handleIntentAlign(computeIntent(convo, null, store.get()).north || 'Compare 结论')
      break
    default:
      break
  }
}

async function markCompareGroupResolved() {
  if (!convo?.compareGroupId || convo.compareResolved) return
  convo.compareResolved = true
  const siblings = (store.get().conversations || []).filter(x => x.compareGroupId === convo.compareGroupId)
  for (const s of siblings.length ? siblings : [convo]) {
    s.compareResolved = true
    await db.put('conversations', s)
  }
  refreshIntentRail()
}

function handleIntentAlign(north) {
  markCompareGroupResolved().catch(() => {})
  sendUserText(
    `[核对进度] 请用中文对照当前目标，3 句话：1) 我们还在做什么 2) 是否偏离 3) 下一步最小动作。\n\n**这次要做：** ${north}`,
  )
}

export function runAlignCheck() {
  if (!convo) return
  const snap = computeIntent(convo, null, store.get())
  if (!snap.north) {
    toast('先写「这次要做到哪」', { type: 'info' })
    intentRail?.focusGoalEdit?.()
    return
  }
  handleIntentAlign(snap.north)
}

function getReviewState(key) {
  return convo?.reviewState?.[key] || null
}

function setReviewState(key, status) {
  if (!convo) return
  if (!convo.reviewState) convo.reviewState = {}
  convo.reviewState[key] = status
}

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

export function mountChat(container) {
  container.innerHTML = `
    <div class="ws">
      <div class="stage-chat" id="stageChat">
        <aside class="branch-sidebar" id="branchSidebar" aria-label="分支树">
          <div class="bs-head">
            <span>分支树</span>
            <button type="button" class="bs-toggle" id="branchSidebarToggle" title="收起">‹</button>
          </div>
          <div class="bs-body" id="branchTreeHost"></div>
        </aside>
        <div class="stage-main">
          <div class="branch-bar" id="branchBar" style="display:none"></div>
          <div class="messages" id="messages">
            <div class="empty" id="empty">${EMPTY_HTML}</div>
          </div>
        </div>
      </div>
      <div class="composer">
        <div class="composer-meta">
          <div id="presetPickerHost"></div>
        </div>
        <div id="composerContextHost"></div>
        <div class="composer-inner">
          <textarea id="input" rows="1" placeholder="输入消息，Enter 发送 / Shift+Enter 换行"></textarea>
          <button id="send" class="send" title="发送"></button>
        </div>
      </div>
    </div>`

  els = {
    messages: container.querySelector('#messages'),
    input: container.querySelector('#input'),
    send: container.querySelector('#send'),
    historyList: document.getElementById('historyList'),
    presetPickerHost: container.querySelector('#presetPickerHost'),
  }

  initPresetSelect()

  els.send.innerHTML = ICONS.send
  els.send.onclick = onSend
  els.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  })
  els.input.addEventListener('input', () => {
    els.input.style.height = 'auto'
    els.input.style.height = `${Math.min(els.input.scrollHeight, 180)}px`
    saveDraft()
  })
  bindExamples(container)
  document.getElementById('newConvo')?.addEventListener('click', () => newConversation(true))
  document.getElementById('newCompare')?.addEventListener('click', () => startCompareMode())
  attachTemplateEngine(els.input)
  bindFileDrop(container)
  intentRail = mountIntentRail(container.querySelector('#composerContextHost'), {
    getConvo: () => convo,
    getStore: () => store.get(),
    onNorthEdit: text => {
      if (!convo) return
      convo.intentNorth = text
      persist()
      refreshIntentRail()
    },
    onDebtAction: handleIntentDebt,
  })
  store.subscribe(s => {
    if (s.view === 'chat') refreshIntentRail()
  })
  window.addEventListener('ccui:review-queue', () => refreshIntentRail())
  bindGoalHotkey(() => intentRail?.focusGoalEdit?.())
  window.addEventListener('ccui:focus-goal', () => intentRail?.focusGoalEdit?.())
  document.addEventListener('keydown', onChatHotkey)
  window.addEventListener('ccui:apply-brief', e => {
    const b = e.detail
    if (!convo || !b) return
    convo.intentNorth = (b.outcome || b.problem || '').trim()
    persist()
    refreshIntentRail()
    toast('已钉住任务目标', { type: 'success' })
  })
  window.addEventListener('ccui:review-diff', e => {
    const { item, allow } = e.detail || {}
    if (!item) return
    const key = item.id || (item.permId ? `perm_${item.permId}` : null)
    if (key) setReviewState(key, allow ? 'accepted' : 'rejected')
    const sel = item.id ? `[data-review-id="${item.id}"]` : null
    if (sel) {
      const wrap = els.messages.querySelector(sel)
      if (wrap) {
        wrap.classList.add(allow ? 'accepted' : 'rejected')
        wrap.querySelector('.diff-actions')?.remove()
        if (!wrap.querySelector('.diff-resolved-badge')) {
          wrap.appendChild(h('div', 'diff-resolved-badge', allow ? '已接受' : '已拒绝'))
        }
      }
    }
    if (!allow) {
      const path = item.path || ''
      sendUserText(`请撤销刚才${path ? `对 ${path}` : ''} 的修改（${item.toolName || 'Edit'}），恢复为变更前的内容。`)
    }
    persist()
  })
  window.addEventListener('ccui:review-perm', e => {
    const { permId, allow } = e.detail || {}
    if (permId == null || permId === '') return
    const pid = String(permId)
    setReviewState(`perm_${pid}`, allow ? 'accepted' : 'rejected')
    const card = els.messages?.querySelector(`.permcard[data-perm-id="${CSS.escape(pid)}"]`)
    if (card) card.remove()
    persist()
  })
  container.querySelector('#branchSidebarToggle')?.addEventListener('click', () => {
    const collapsed = localStorage.getItem('ccui:branch-sidebar') === '1'
    localStorage.setItem('ccui:branch-sidebar', collapsed ? '0' : '1')
    applyBranchSidebarLayout()
  })
  applyBranchSidebarLayout()
  restoreDraft()

  window.addEventListener('ccui:hljs-theme', rehighlightVisibleCode)
  window.addEventListener('ccui:theme-changed', rehighlightVisibleCode)
  bootChat()
  api.onMessage(onDaemon)
  window.addEventListener('ccui:new-convo', () => newConversation(true))
  window.addEventListener('ccui:start-compare', () => startCompareMode())
  window.addEventListener('ccui:align-check', () => runAlignCheck())
  window.addEventListener('ccui:insert-prompt', e => {
    const prefix = e.detail || ''
    if (!els?.input) return
    els.input.value = `${prefix}${els.input.value}`.trim()
    els.input.dispatchEvent(new Event('input'))
    els.input.focus()
  })
  window.addEventListener('ccui:set-prompt', e => {
    if (!els?.input) return
    els.input.value = e.detail || ''
    els.input.dispatchEvent(new Event('input'))
    els.input.focus()
  })
  store.subscribe(s => {
    updateSessionTitle()
    updateSendButton()
    syncPresetPicker()
    syncComposerPlaceholder()
  })
}

export function startCompareMode() {
  store.set({ comparePending: true })
  syncComposerPlaceholder()
  els?.input?.focus()
}

function applyBranchSidebarLayout() {
  const collapsed = localStorage.getItem('ccui:branch-sidebar') === '1'
  document.getElementById('branchSidebar')?.classList.toggle('collapsed', collapsed)
}

function refreshBranchTreePanel() {
  const host = document.getElementById('branchTreeHost')
  if (!host) return
  renderBranchTree(host, {
    getConvo: () => convo,
    onSwitchBranch: id => switchBranch(id),
    onRollback: id => rollbackCheckpoint(id),
  })
}

export function getActiveConversation() {
  return convo ? JSON.parse(JSON.stringify(convo)) : null
}

function onChatHotkey(e) {
  if (store.get().view !== 'chat') return
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault()
    editLastUserMessage()
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    runAlignCheck()
  }
}

/** 命令面板 / Ctrl+Shift+E：编辑最后一条用户消息并建立分支 */
export function editLastUserMessage() {
  if (!els || !convo) return
  if (store.get().busy) { toast('请先停止当前回答', { type: 'error' }); return }
  let idx = -1
  for (let i = convo.items.length - 1; i >= 0; i--) {
    if (convo.items[i].t === 'user') { idx = i; break }
  }
  if (idx < 0) { toast('没有可编辑的用户消息', { type: 'warn' }); return }
  let userN = 0
  for (let i = 0; i <= idx; i++) if (convo.items[i].t === 'user') userN++
  const el = els.messages.querySelectorAll('.msg.user')[userN - 1]
  if (!el) { toast('消息未渲染，请切换 Thread 后重试', { type: 'warn' }); return }
  startEdit(idx, convo.items[idx].text, el)
}

function syncComposerPlaceholder() {
  if (!els?.input) return
  if (store.get().comparePending) {
    els.input.placeholder = '同一任务 → 创建 Lane A/B/C 三条 Thread，Enter 启动…'
    return
  }
  els.input.placeholder = '输入消息，Enter 发送 / Shift+Enter 换行'
}

async function runCompareAsThreeThreads(prompt) {
  const groupId = uid('grp')
  const north = prompt.trim().slice(0, 120)
  const threads = ['A', 'B', 'C'].map(lane => {
    const t = laneThread(lane, prompt, groupId)
    if (north) t.intentNorth = north
    return t
  })
  for (const t of threads) await db.put('conversations', t)

  store.set({ comparePending: false })
  syncComposerPlaceholder()
  els.input.value = ''
  els.input.style.height = 'auto'

  loadConversation(threads[0])
  toast('已创建 Lane A/B/C，正在并行运行…', { type: 'info' })

  const sessionByLane = Object.fromEntries(threads.map(t => [t.lane, t.sessionId]))
  setBusy(true)
  try {
    const resp = await runCompare(prompt, {}, sessionByLane)
    for (const lane of ['A', 'B', 'C']) {
      const th = threads.find(t => t.lane === lane)
      const row = resp.results?.find(r => r.laneId === lane)
      const text = row?.error ? `**错误：** ${row.error}` : (row?.text || '（空）')
      writeAssistantItem(th, text)
      th.updatedAt = Date.now()
      await db.put('conversations', th)
    }
    if (resp.synthesis) {
      const thA = threads[0]
      thA.items.push({ t: 'msg', sdk: synthesisSdk(resp.synthesis) })
      thA.updatedAt = Date.now()
      await db.put('conversations', thA)
    }
    const resolved = !!resp.synthesis
    for (const th of threads) {
      th.compareResolved = resolved
      await db.put('conversations', th)
    }
    refreshHistory()
    if (threads.some(t => t.id === convo?.id)) {
      convo = JSON.parse(JSON.stringify(threads.find(t => t.id === convo.id) || threads[0]))
      renderItems()
    }
    refreshIntentRail()
    toast('Lane A/B/C 已完成', { type: 'success' })
  } catch (e) {
    toast(`Compare 失败：${e.message}`, { type: 'error' })
  } finally {
    setBusy(false)
    updateSendButton()
  }
}

/** 写入或更新 thread 最后一条 assistant 消息（避免流式 + 批量重复） */
function writeAssistantItem(th, text) {
  const sdk = assistantSdk(text)
  const last = th.items[th.items.length - 1]
  if (last?.t === 'msg') last.sdk = sdk
  else th.items.push({ t: 'msg', sdk })
}

function initPresetSelect() {
  if (!els?.presetPickerHost) return
  presetSelect = createCcSelect({
    variant: 'pill',
    menuPlacement: 'above',
    fullWidth: false,
    icon: ICONS.presets,
    placeholder: '默认',
    options: [{ value: '', label: '默认', desc: '不附加系统提示' }],
    onChange: id => applyPresetId(id || null),
  })
  els.presetPickerHost.appendChild(presetSelect.el)
  syncPresetPicker()
}

async function applyPresetId(id) {
  store.set({ activePresetId: id || null })
  try { await db.put('settings', { id: 'activePreset', value: id || null }) } catch {}
  syncPresetPicker()
}

function syncPresetPicker() {
  if (!presetSelect) return
  const s = store.get()
  const activeId = s.activePresetId || ''
  const items = [{ value: '', label: '默认', desc: '不附加系统提示' }]
  for (const p of s.presets) {
    items.push({ value: p.id, label: p.name, desc: (p.systemPrompt || '自定义预设').slice(0, 48) })
  }
  presetSelect.setOptions(items)
  presetSelect.setValue(activeId)
}

function bindExamples(root) {
  root.querySelectorAll('.ex').forEach(b => {
    b.onclick = () => { els.input.value = b.textContent; onSend() }
  })
}

function bindFileDrop(root) {
  const zones = [root.querySelector('.composer-inner'), root.querySelector('.ws')]
  const activate = on => zones.forEach(z => z?.classList.toggle('drop-active', on))
  for (const zone of zones) {
    if (!zone) continue
    zone.addEventListener('dragover', e => { e.preventDefault(); activate(true) })
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) activate(false)
    })
    zone.addEventListener('drop', e => {
      e.preventDefault()
      activate(false)
      const paths = [...(e.dataTransfer?.files || [])]
        .map(f => window.ccui?.getPathForFile?.(f) || f.path)
        .filter(Boolean)
      if (!paths.length) return
      insertFilePaths(paths)
    })
  }
}

function insertFilePaths(paths) {
  if (!els?.input) return
  const refs = paths.map(p => `@${p.replace(/\\/g, '/')}`).join('\n')
  const sep = els.input.value.trim() ? '\n' : ''
  els.input.value = `${els.input.value}${sep}${refs}`
  els.input.dispatchEvent(new Event('input'))
  els.input.focus()
  toast(`已附加 ${paths.length} 个文件`, { type: 'info' })
}

/** 供 Studio / 命令面板打开会话 */
export function openConversation(c) {
  if (!els) return
  loadConversation(c)
}

async function bootChat() {
  await refreshHistory()
  const list = store.get().conversations || []
  if (list.length) loadConversation(list[0])
  else showEmptySession()
}

function showEmptySession() {
  convo = blankThread()
  store.set({ currentConversationId: convo.id, activeSessionId: convo.sessionId })
  api.reset(convo.sessionId)
  renderBranchBar()
}

function newConversation(resetEngine = true) {
  convo = blankThread()
  store.set({ currentConversationId: convo.id, activeSessionId: convo.sessionId, comparePending: false })
  if (resetEngine) api.reset(convo.sessionId)
  syncComposerPlaceholder()
  showEmptyState(true)
  renderBranchBar()
  restoreDraft()
}

function showEmptyState(withExamples = false) {
  if (!els) return
  els.messages.innerHTML = ''
  toolCards = new Map()
  streamBubble = null
  const empty = h('div', 'empty')
  empty.id = 'empty'
  if (withExamples) {
    empty.innerHTML = EMPTY_HTML
    bindExamples(empty)
  } else {
    empty.innerHTML = `<h1>开始对话</h1><p>新的会话已就绪。输入消息或按 Ctrl+K 搜索功能。</p>`
  }
  els.messages.appendChild(empty)
}

function saveDraft() {
  if (!els || !convo) return
  try { localStorage.setItem(DRAFT_KEY(convo.id), els.input.value) } catch {}
}

export function updateSessionTitle() {
  const el = document.getElementById('sessionTitle')
  if (!el) return
  el.textContent = convo?.title || '新对话'
}

function restoreDraft() {
  if (!els || !convo) return
  try {
    const d = localStorage.getItem(DRAFT_KEY(convo.id))
    if (d) { els.input.value = d; els.input.dispatchEvent(new Event('input')) }
  } catch {}
}

async function refreshHistory() {
  if (!els) return
  let list = []
  try { list = await db.getAll('conversations') } catch {}
  list = list.filter(c => c.kind !== 'compare')
  list.sort((a, b) => b.updatedAt - a.updatedAt)
  store.set({ conversations: list })
  els.historyList.innerHTML = ''
  if (!list.length) {
    els.historyList.appendChild(h('div', 'history-empty', '<span class="he-ico" aria-hidden="true">💬</span>开始新对话<br/><span class="he-sub">发送第一条消息后，会话会出现在这里</span>'))
    return
  }
  const grouped = new Set()
  for (const c of list) {
    if (c.compareGroupId) {
      if (grouped.has(c.compareGroupId)) continue
      grouped.add(c.compareGroupId)
      const siblings = list.filter(x => x.compareGroupId === c.compareGroupId)
        .sort((a, b) => (a.lane || '').localeCompare(b.lane || ''))
      const label = siblings[0]?.items?.[0]?.text?.slice(0, 28) || 'Compare'
      els.historyList.appendChild(h('div', 'history-group-label', `Compare · ${label}`))
      for (const s of siblings) appendHistoryItem(s)
    } else {
      appendHistoryItem(c)
    }
  }
}

function appendHistoryItem(c) {
  const item = h('div', 'history-item' + (c.lane ? ' lane' : ''))
  if (c.id === convo?.id) item.classList.add('active')
  item.innerHTML = `<div class="hi-title"></div><div class="hi-time"></div><button class="hi-del" title="删除">×</button>`
  item.querySelector('.hi-title').textContent = c.title || '未命名'
  item.querySelector('.hi-time').textContent = new Date(c.updatedAt).toLocaleString()
  item.querySelector('.hi-del').onclick = async e => {
    e.stopPropagation()
    const siblings = c.compareGroupId
      ? (store.get().conversations || []).filter(x => x.compareGroupId === c.compareGroupId)
      : [c]
    const msg = siblings.length > 1 ? `删除 Compare 组（${siblings.length} 条 Thread）？` : `删除「${c.title || '未命名'}」？`
    confirmPopover(e.target, msg, async () => {
      for (const s of siblings) await db.delete('conversations', s.id)
      toast('已删除', { type: 'success' })
      if (siblings.some(s => s.id === convo?.id)) newConversation(true)
      refreshHistory()
    })
  }
  item.onclick = () => loadConversation(c)
  els.historyList.appendChild(item)
}

function syncEngineContext() {
  if (!convo) return
  const payload = buildHydratePayload(convo)
  if (!payload.items.length && !payload.engineMessages?.length) {
    api.reset(convo.sessionId)
    return
  }
  api.hydrateSession(convo.sessionId, payload)
}

function loadConversation(c) {
  clearReviewQueue()
  convo = JSON.parse(JSON.stringify(c))
  if (convo.kind === 'compare') {
    toast('旧版 Compare 格式已废弃，请用 + Compare 重新创建', { type: 'warn' })
    return
  }
  if (!convo.sessionId) convo.sessionId = `thread_legacy_${convo.id}`
  if (!convo.branches) convo.branches = []
  if (!convo.checkpoints) convo.checkpoints = []
  if (!convo.reviewState) convo.reviewState = {}
  store.set({ currentConversationId: convo.id, activeSessionId: convo.sessionId, comparePending: false })
  syncComposerPlaceholder()
  renderItems()
  refreshHistory()
  restoreDraft()
  updateSessionTitle()
  refreshIntentRail()
  syncEngineContext()
}

function renderItems() {
  if (!els) return
  bulkRendering = true
  els.messages.innerHTML = ''
  toolCards = new Map()
  streamBubble = null
  resetInspectorTimeline()
  renderBranchBar()
  if (!convo.items.length) {
    bulkRendering = false
    showEmptyState(true)
    return
  }
  for (let i = 0; i < convo.items.length; i++) {
    const it = convo.items[i]
    if (it.t === 'user') addUser(it.text, false, i, it.brief || null)
    else if (it.t === 'msg') handleMessage(it.sdk, false)
  }
  bulkRendering = false
  scrollDown(true)
  refreshIntentRail()
  window.dispatchEvent(new Event('ccui:layout-check'))
}

function resetInspectorTimeline() {
  const tl = document.getElementById('insp-timeline')
  if (tl) tl.innerHTML = '<div class="tl-empty"><span class="tl-empty-ico" aria-hidden="true">⚙</span>尚无工具调用</div>'
}

// ---------- 分支 + 快照 ----------
function renderBranchBar() {
  const bar = document.getElementById('branchBar')
  if (!bar || !convo) return
  const branches = convo.branches || []
  const checkpoints = convo.checkpoints || []
  const hasItems = convo.items.length > 0
  if (!hasItems && !branches.length && !checkpoints.length) {
    bar.style.display = 'none'
    bar.innerHTML = ''
    refreshBranchTreePanel()
    return
  }
  bar.style.display = ''
  bar.innerHTML = ''
  if (branches.length) {
    bar.appendChild(h('span', 'bb-label', '分支'))
    branches.forEach((b, i) => {
      const btn = h('button', 'bb-item')
      btn.textContent = `#${i + 1} ${b.label}`
      btn.title = '切回此分支（引擎上下文会重置）'
      btn.onclick = () => switchBranch(b.id)
      bar.appendChild(btn)
    })
    bar.appendChild(h('span', 'bb-cur', '● 当前'))
  } else if (hasItems) {
    bar.appendChild(h('span', 'bb-hint', '编辑用户消息会保存分支快照 · Ctrl+Shift+E'))
  }
  if (checkpoints.length) {
    const wrap = h('span', 'bb-cp')
    if (checkpointSelect) checkpointSelect.destroy()
    checkpointSelect = createCcSelect({
      variant: 'compact',
      menuPlacement: 'below',
      fullWidth: false,
      placeholder: `⟲ 检查点 (${checkpoints.length})`,
      value: '',
      options: checkpoints.slice().reverse().map(cp => ({
        value: cp.id,
        label: `${new Date(cp.at).toLocaleTimeString()} · ${cp.label}`,
      })),
      onChange: id => {
        if (id) rollbackCheckpoint(id)
        checkpointSelect?.setValue('')
        checkpointSelect?.setPlaceholder(`⟲ 检查点 (${checkpoints.length})`)
      },
    })
    wrap.appendChild(checkpointSelect.el)
    bar.appendChild(wrap)
  } else if (checkpointSelect) {
    checkpointSelect.destroy()
    checkpointSelect = null
  }
  refreshBranchTreePanel()
}

function addCheckpoint() {
  if (!convo || !convo.items.length) return
  convo.checkpoints = convo.checkpoints || []
  const label = (lastUserText() || '检查点').slice(0, 16)
  convo.checkpoints.push({ id: uid('cp'), label, at: Date.now(), items: JSON.parse(JSON.stringify(convo.items)) })
  if (convo.checkpoints.length > 30) convo.checkpoints.shift()
}

function rollbackCheckpoint(id) {
  if (store.get().busy) { toast('请先停止当前回答', { type: 'error' }); return }
  const cp = (convo.checkpoints || []).find(x => x.id === id)
  if (!cp) return
  // 回滚前把当前状态存为分支，避免丢失
  snapshotBranch(Math.max(0, convo.items.length - 1))
  convo.items = JSON.parse(JSON.stringify(cp.items))
  syncEngineContext()
  renderItems()
  toast('已回滚到检查点（当前状态已存为分支，引擎上下文已重置）', { type: 'success' })
  persist()
}

function snapshotBranch(idx) {
  if (!convo.branches) convo.branches = []
  const orig = convo.items[idx]
  const label = ((orig && orig.text) || '编辑点').slice(0, 16)
  convo.branches.push({
    id: uid('b'),
    label,
    forkAt: idx,
    createdAt: Date.now(),
    items: JSON.parse(JSON.stringify(convo.items)),
  })
  if (convo.branches.length > 20) convo.branches.shift()
}

function switchBranch(id) {
  if (store.get().busy) { toast('请先停止当前回答', { type: 'error' }); return }
  const b = (convo.branches || []).find(x => x.id === id)
  if (!b) return
  convo.items = JSON.parse(JSON.stringify(b.items))
  syncEngineContext()
  renderItems()
  toast('已切回分支（引擎上下文已重置）', { type: 'success' })
  persist()
  refreshIntentRail()
}

function startEdit(idx, oldText, el) {
  if (store.get().busy) { toast('请先停止当前回答', { type: 'error' }); return }
  const bubble = el.querySelector('.bubble')
  const editBtn = el.querySelector('.msg-edit')
  const ta = h('textarea', 'edit-area'); ta.value = oldText
  const bar = h('div', 'edit-bar', '<button class="save">保存并建立分支</button><button class="cancel">取消</button>')
  bubble.style.display = 'none'
  if (editBtn) editBtn.style.display = 'none'
  el.appendChild(ta); el.appendChild(bar)
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length)
  const close = () => { ta.remove(); bar.remove(); bubble.style.display = ''; if (editBtn) editBtn.style.display = '' }
  bar.querySelector('.cancel').onclick = close
  bar.querySelector('.save').onclick = () => {
    const nt = ta.value.trim()
    if (!nt) return
    commitEdit(idx, nt)
  }
}

function commitEdit(idx, newText) {
  snapshotBranch(idx)
  convo.items = convo.items.slice(0, idx)
  syncEngineContext()
  renderItems()
  sendUserText(newText)
}

async function persist() {
  if (!convo || !convo.items.length) return
  convo.updatedAt = Date.now()
  if (convo.title === '新对话') {
    const firstUser = convo.items.find(i => i.t === 'user')
    if (firstUser) convo.title = firstUser.text.slice(0, 24)
  }
  if (!store.get().busy) {
    try {
      const resp = await api.getMessages(convo.sessionId)
      if (resp?.ok && Array.isArray(resp.messages) && resp.messages.length) {
        convo.engineMessages = resp.messages
      }
    } catch {}
  }
  try {
    await db.put('conversations', convo)
    refreshHistory()
    updateSessionTitle()
    import('./collab.js').then(m => m.broadcastConversation?.(convo)).catch(() => {})
  } catch {}
}

// ---------- 渲染 ----------
function rehighlightCodeBlock(codeEl) {
  if (!codeEl) return
  const langClass = [...codeEl.classList].find(c => c.startsWith('language-'))
  const text = codeEl.textContent || ''
  codeEl.removeAttribute('data-highlighted')
  codeEl.className = langClass || ''
  codeEl.textContent = text
  try { hljs.highlightElement(codeEl) } catch {}
}

function renderMarkdown(el, text) {
  el.innerHTML = marked.parse(text || '')
  el.querySelectorAll('script').forEach(s => s.remove())
  el.querySelectorAll('pre code').forEach(rehighlightCodeBlock)
}
function rehighlightVisibleCode() {
  els?.messages?.querySelectorAll('pre code').forEach(rehighlightCodeBlock)
}
function clearEmpty() { const e = els.messages.querySelector('#empty'); if (e) e.remove() }
function scrollDown(force = false) {
  if (bulkRendering && !force) return
  els.messages.scrollTop = els.messages.scrollHeight
}

function addUser(text, record = true, idx = null, brief = null) {
  clearEmpty()
  if (record) {
    const item = { t: 'user', text }
    if (brief) item.brief = brief
    convo.items.push(item)
    idx = convo.items.length - 1
  }
  const el = h('div', 'msg user', `<div class="role">你</div><div class="bubble"></div><button class="msg-edit" title="编辑并建立分支">${ICONS.edit}</button>`)
  if (brief) {
    const badge = h('div', 'brief-badge', briefSummary(brief))
    el.insertBefore(badge, el.querySelector('.bubble'))
  }
  const display = brief ? userDisplayText(text, brief) : text
  el.querySelector('.bubble').textContent = display
  el.querySelector('.msg-edit').onclick = () => startEdit(idx, text, el)
  els.messages.appendChild(el)
  scrollDown()
}

function userDisplayText(text, brief) {
  const parts = text.split('\n---\nSupplement:')
  if (parts.length > 1) {
    const sup = parts.pop()?.trim()
    if (sup) return sup
  }
  return briefSummary(brief) || stripBriefMarker(text).slice(0, 200)
}
function addThinking(text, live = true) {
  if (!text) return
  const el = h('details', live ? 'thinking thinking-live' : 'thinking')
  if (!live) el.open = false
  el.appendChild(h('summary', null, live ? '思考中…' : '思考过程'))
  const body = h('div', 'think-body'); body.textContent = text
  el.appendChild(body)
  els.messages.appendChild(el); scrollDown()
}
function addAssistantText(text) {
  if (!text || !text.trim()) return
  const el = h('div', 'msg assistant', '<div class="role">CCui</div><div class="bubble md"></div>')
  renderMarkdown(el.querySelector('.bubble'), text)
  els.messages.appendChild(el); scrollDown()
}
const PARAM_KEYS = ['file_path', 'path', 'pattern', 'command', 'query', 'url', 'prompt']
function summarizeInput(input) {
  if (!input || typeof input !== 'object') return ''
  for (const k of PARAM_KEYS) if (input[k] != null) return String(input[k])
  const keys = Object.keys(input)
  return keys.length ? `${keys[0]}: ${JSON.stringify(input[keys[0]]).slice(0, 60)}` : ''
}
const isEditTool = n => /edit|write|notebook/i.test(n)
function addToolCard(block, live = true) {
  const { id, name, input } = block
  const el = h('div', live ? 'toolcard tc-running' : 'toolcard', `
    <div class="head"><span class="ico">${ICONS.tool}</span><span class="name"></span><span class="arg"></span><span class="spin">${live ? '运行中…' : '—'}</span></div>
    <div class="tbody"></div>`)
  el.querySelector('.name').textContent = name
  el.querySelector('.arg').textContent = summarizeInput(input)
  const body = el.querySelector('.tbody')
  if (isEditTool(name) && input && (input.old_string != null || input.new_string != null)) {
    body.appendChild(renderDiff(input.old_string || '', input.new_string || '', input, name, id, live))
  }
  if (!live) {
    bindHistoricalToolToggle(el)
    if (body.children.length) el.classList.add('tc-collapsed')
  }
  els.messages.appendChild(el)
  toolCards.set(id, { card: el, body, name, start: Date.now(), live })
  scrollDown()
}

function bindHistoricalToolToggle(card) {
  card.classList.add('tc-historical')
  const head = card.querySelector('.head')
  if (!head) return
  head.addEventListener('click', () => card.classList.toggle('tc-collapsed'))
}
function renderDiff(oldStr, newStr, input, toolName, toolUseId, live = true) {
  const key = toolUseId ? `diff_${toolUseId}` : null
  const resolved = key ? getReviewState(key) : null
  const wrap = h('div', 'diff-wrap')
  if (key) wrap.dataset.reviewId = key
  const diff = h('div', 'diff')
  if (oldStr) for (const line of String(oldStr).split('\n')) { const d = h('div', 'del'); d.textContent = `- ${line}`; diff.appendChild(d) }
  if (newStr) for (const line of String(newStr).split('\n')) { const a = h('div', 'add'); a.textContent = `+ ${line}`; diff.appendChild(a) }
  wrap.appendChild(diff)
  const path = (input && (input.file_path || input.path)) || ''

  if (resolved) wrap.classList.add(resolved === 'accepted' ? 'accepted' : 'rejected')

  if (live && !resolved) {
    const queueId = enqueue({
      id: key || undefined,
      kind: 'diff',
      toolName: toolName || 'Edit',
      path,
      oldStr: oldStr || '',
      newStr: newStr || '',
      input,
    })
    const bar = h('div', 'diff-actions')
    bar.innerHTML = `<button class="diff-accept">接受变更</button><button class="diff-reject">拒绝并请求撤销</button>`
    bar.querySelector('.diff-accept').onclick = () => {
      wrap.classList.add('accepted'); bar.remove()
      if (key) setReviewState(key, 'accepted')
      remove(queueId)
      persist()
      toast('已标记为接受', { type: 'success' })
    }
    bar.querySelector('.diff-reject').onclick = () => {
      wrap.classList.add('rejected'); bar.remove()
      if (key) setReviewState(key, 'rejected')
      remove(queueId)
      persist()
      sendUserText(`请撤销刚才${path ? `对 ${path}` : ''} 的修改（${toolName || 'Edit'}），恢复为变更前的内容。`)
    }
    wrap.appendChild(bar)
  } else if (resolved) {
    const badge = h('div', 'diff-resolved-badge', resolved === 'accepted' ? '已接受' : '已拒绝')
    wrap.appendChild(badge)
  }
  return wrap
}
function resultText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(b => (typeof b === 'string' ? b : b && b.text ? b.text : '')).join('')
  return ''
}
function fillToolResult(toolUseId, content, isError, live = true) {
  const entry = toolCards.get(toolUseId)
  if (!entry) return
  const ms = live ? Date.now() - entry.start : 0
  const spin = entry.card.querySelector('.spin')
  if (spin) {
    spin.textContent = live
      ? (isError ? `失败 · ${ms}ms` : `${ms}ms`)
      : (isError ? '失败' : '完成')
    spin.className = isError ? 'spin err' : 'spin done'
  }
  entry.card.classList.remove('tc-running')
  if (!live) {
    entry.card.classList.add('tc-collapsed')
    if (isError) entry.card.classList.add('tc-failed')
  }
  if (live) addTimeline(entry.name, ms, isError)
  const text = resultText(content).trim()
  if (text && !entry.body.querySelector('.diff-wrap')) {
    const pre = h('pre', 'toolresult')
    pre.textContent = text.length > 1200 ? text.slice(0, 1200) + '\n… (已截断)' : text
    entry.body.appendChild(pre)
  }
  scrollDown()
}
function addTimeline(name, ms, isError) {
  const tl = document.getElementById('insp-timeline')
  if (!tl) return
  const ph = tl.querySelector('.tl-empty'); if (ph) ph.remove()
  const statusCls = isError ? 'tl-dot err' : 'tl-dot ok'
  const row = h('div', 'row', `<span class="tl-name"><span class="${statusCls}" aria-hidden="true"></span><span class="${isError ? 'err' : ''}">${name}</span></span><span>${ms}ms</span>`)
  tl.appendChild(row)
}
function addPermCard(id, toolName, message, input) {
  const path = (input && (input.file_path || input.path)) || ''
  const queueId = enqueue({
    id: `perm_${id}`,
    kind: 'permission',
    permId: id,
    toolName,
    message: message || '',
    path,
    oldStr: input?.old_string,
    newStr: input?.new_string,
    input,
  })
  const el = h('div', 'permcard')
  el.dataset.permId = String(id)
  el.innerHTML = `
    <div class="t">需要授权：${toolName}</div><div class="m"></div>
    <div class="btns"><button class="allow">允许一次</button><button class="always">始终允许</button><button class="deny">拒绝</button>
    <button class="open-review" type="button">审查窗</button></div>`
  el.querySelector('.m').textContent = message || path || ''
  const permKey = `perm_${id}`
  const finish = (status, allow) => {
    setReviewState(permKey, status)
    api.respondPermission(id, allow)
    remove(queueId)
    el.remove()
    persist()
  }
  el.querySelector('.allow').onclick = () => finish('accepted', true)
  el.querySelector('.always').onclick = async () => {
    try {
      await toggleAllowedTool(toolName, true)
      toast(`已记住：${toolName} 将自动允许`, { type: 'success' })
    } catch (e) { toast(`保存失败：${e.message}`, { type: 'error' }) }
    finish('accepted', true)
  }
  el.querySelector('.deny').onclick = () => finish('rejected', false)
  el.querySelector('.open-review').onclick = () => window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'review' }))
  els.messages.appendChild(el); scrollDown()
}

function ensureStreamBubble() {
  if (streamBubble) return streamBubble
  clearEmpty()
  const el = h('div', 'msg assistant', '<div class="role">CCui</div><div class="bubble streaming"></div>')
  const body = el.querySelector('.bubble')
  els.messages.appendChild(el)
  streamBubble = { el, body, text: '' }
  return streamBubble
}
function appendDelta(text) {
  const sb = ensureStreamBubble()
  sb.text += text
  sb.body.textContent = sb.text
  scrollDown()
}
function clearStreamBubble() {
  if (streamBubble) { streamBubble.el.remove(); streamBubble = null }
}

function handleMessage(sdk, record = true) {
  if (sdk && sdk.type === 'assistant') {
    stripCompletionFromSdk(sdk)
    clearStreamBubble()
  }
  if (!sdk) return
  const content = sdk.message && sdk.message.content
  if (!Array.isArray(content)) return
  if (record) convo.items.push({ t: 'msg', sdk: structuredClone(sdk) })
  if (sdk.type === 'assistant') {
    for (const b of content) {
      if (!b) continue
      if (b.type === 'thinking') addThinking(b.thinking || b.text, record)
      else if (b.type === 'text') addAssistantText(b.text)
      else if (b.type === 'tool_use') addToolCard(b, record)
    }
  } else if (sdk.type === 'user') {
    for (const b of content) if (b && b.type === 'tool_result') fillToolResult(b.tool_use_id, b.content, b.is_error, record)
  }
}

function stripCompletionFromSdk(sdk) {
  const content = sdk.message?.content
  if (!Array.isArray(content)) return
  for (const b of content) {
    if (b?.type === 'text' && b.text) b.text = stripCompletionSignal(b.text)
  }
}

function finishAssistantTurn(completed) {
  api.stopWatchdog()
  clearStreamBubble()
  setBusy(false)
  if (convo?.items?.length) addCheckpoint()
  if (completed) {
    maybeTip('first-reply', '提示：悬停消息可编辑分叉；Ctrl+Shift+E；+ Compare 三路变异')
  }
  renderBranchBar()
  persist()
}

function startTurnWatchdog() {
  api.startWatchdog(() => {
    if (canAutoContinue(continuationTracker)) attemptContinuation('watchdog')
    else toast('长时间无响应，自动续写次数已用尽', { type: 'error' })
  }, 600000)
}

function attemptContinuation(reason) {
  if (!consumeContinuation(continuationTracker)) {
    finishAssistantTurn(false)
    toast('未见完成信号，已停止自动续写', { type: 'warn' })
    return
  }
  continuationTracker.awaitingSignal = true
  toast(`检测到异常中断，正在续写…（剩余 ${continuationTracker.left} 次）`, { type: 'info' })
  sendEngineText(buildContinuationPrompt(reason), { meta: true })
}

function sendEngineText(text, { meta = false } = {}) {
  setBusy(true)
  const s = store.get()
  const preset = s.presets.find(p => p.id === s.activePresetId)
  const stylePrompt = buildStylePrompt(s.codingStyle)
  const needCompletionRule = meta || continuationTracker?.awaitingSignal
  const systemPrompt = [stylePrompt, preset?.systemPrompt, needCompletionRule ? COMPLETION_RULE : null].filter(Boolean).join('\n\n')
  api.send({
    text,
    model: preset?.model,
    systemPrompt,
    sessionId: convo?.sessionId || 'main',
  })
  startTurnWatchdog()
  if (!meta) return
  // 续写 meta 消息：不占 UI 用户气泡
}

function setBusy(v) {
  store.set({ busy: v, daemonStatus: v ? 'busy' : (store.get().daemonStatus === 'offline' ? 'offline' : 'ready') })
  updateSendButton()
  refreshIntentRail()
}

function updateSendButton() {
  if (!els) return
  const s = store.get()
  const running = s.busy || s.orchBusy
  els.send.disabled = false
  els.send.innerHTML = running ? ICONS.stop : ICONS.send
  els.send.title = running ? '停止' : '发送'
  els.send.classList.toggle('stop', running)
  els.input.closest('.composer')?.classList.toggle('busy', running)
}

async function onSend() {
  const s = store.get()
  if (s.orchBusy) { stopParallel(); updateSendButton(); return }
  if (s.busy) {
    if (continuationTracker) continuationTracker.userStop = true
    api.interrupt(convo?.sessionId)
    return
  }
  let text = els.input.value.trim()
  if (!text) return

  els.input.value = ''
  els.input.style.height = 'auto'

  if (s.comparePending) {
    await runCompareAsThreeThreads(text)
    return
  }

  const north = convo?.intentNorth?.trim()
  if (north) {
    text = `[当前任务] ${north}\n\n${text}`
  }

  try { localStorage.removeItem(DRAFT_KEY(convo?.id)) } catch {}
  sendUserText(text)
}

async function sendUserText(text, brief = null) {
  addUser(text, true, null, brief)
  renderBranchBar()
  continuationTracker = createContinuationTracker()
  sendEngineText(text)
}

function onDaemon(msg) {
  if (msg.kind === 'exit') { addAssistantText(`*[daemon 已退出 code=${msg.code}]*`); finishAssistantTurn(false); return }
  if (msg.kind === 'event') {
    const sid = msg.sessionId || 'main'
    const active = convo?.sessionId || store.get().activeSessionId || 'main'
    if (sid !== active) return
  }
  if (msg.kind !== 'event' || !msg.event) return
  const e = msg.event
  switch (e.type) {
    case 'route':
      store.set({ model: e.model, tier: e.tier, routeReason: e.reason })
      break
    case 'delta': if (e.kind === 'text') appendDelta(e.text); break
    case 'message': handleMessage(e.sdk); break
    case 'permission_request': clearStreamBubble(); addPermCard(e.id, e.toolName, e.message, e.input); break
    case 'usage':
      store.set({ usage: { input: e.inputTokens, output: e.outputTokens }, totalCost: store.get().totalCost + (Number(e.costUsd) || 0) })
      break
    case 'done': {
      commitStreamBubbleIfNeeded()
      const plain = lastAssistantPlainText(convo, streamBubble)
      if (continuationTracker?.awaitingSignal) {
        if (hasCompletionSignal(plain)) {
          stripCompletionFromLastItem()
          continuationTracker.awaitingSignal = false
          finishAssistantTurn(true)
        } else if (canAutoContinue(continuationTracker)) {
          attemptContinuation('abnormal')
        } else {
          continuationTracker.awaitingSignal = false
          finishAssistantTurn(false)
          toast('未见完成信号 <<CCUI_TASK_COMPLETE>>，已停止自动续写', { type: 'warn' })
        }
      } else {
        if (hasCompletionSignal(plain)) stripCompletionFromLastItem()
        finishAssistantTurn(false)
      }
      break
    }
    case 'interrupted':
      if (continuationTracker?.userStop) {
        finishAssistantTurn(false)
        toast('已停止', { type: 'info' })
      } else if (continuationTracker?.awaitingSignal && canAutoContinue(continuationTracker)) {
        attemptContinuation('abnormal')
      } else {
        finishAssistantTurn(false)
      }
      break
    case 'error':
      if (isTruncationError(e.error) && canAutoContinue(continuationTracker)) {
        attemptContinuation('truncated')
      } else {
        api.stopWatchdog()
        clearStreamBubble()
        addErrorCard(e.error)
        setBusy(false)
      }
      break
  }
}

function commitStreamBubbleIfNeeded() {
  if (!streamBubble?.text?.trim()) return
  const display = stripCompletionSignal(streamBubble.text.trim())
  const sdk = assistantSdk(display)
  convo.items.push({ t: 'msg', sdk: structuredClone(sdk) })
  clearStreamBubble()
  if (display) addAssistantText(display)
}

function stripCompletionFromLastItem() {
  for (let i = convo.items.length - 1; i >= 0; i--) {
    const it = convo.items[i]
    if (it.t === 'msg' && it.sdk?.type === 'assistant') {
      stripCompletionFromSdk(it.sdk)
      return
    }
  }
}

function lastUserText() {
  for (let i = convo.items.length - 1; i >= 0; i--) if (convo.items[i].t === 'user') return convo.items[i].text
  return ''
}

function addErrorCard(rawError) {
  clearEmpty()
  const human = humanizeError(rawError)
  const el = h('div', 'errorcard', `
    <div class="ec-head"><span class="ec-ico">${ICONS.warn}</span><span class="ec-title">出错了</span></div>
    <div class="ec-msg"></div>
    <details class="ec-raw"><summary>原始错误</summary><pre></pre></details>
    <div class="ec-actions">
      <button class="ec-fix">分析并修复</button>
      <button class="ec-retry">重试上一条</button>
    </div>`)
  el.querySelector('.ec-msg').textContent = human
  el.querySelector('.ec-raw pre').textContent = String(rawError || '')
  el.querySelector('.ec-fix').onclick = () => {
    const prev = lastUserText()
    const prompt = `刚才的操作报错了，请用中文：1) 分析根因；2) 给出可执行的修复步骤；3) 若涉及改代码，给出改前/改后对比。\n\n错误信息：\n${String(rawError || '')}\n\n我上一条请求是：${prev || '（无）'}`
    sendUserText(prompt)
  }
  el.querySelector('.ec-retry').onclick = () => {
    const prev = lastUserText()
    if (prev) sendUserText(prev); else toast('没有可重试的上一条', { type: 'warn' })
  }
  els.messages.appendChild(el); scrollDown()
}
