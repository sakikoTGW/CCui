// 对话视图控制器。流式渲染是全应用热路径，保持命令式 DOM（token 高频更新下 React
// reconciliation 反而更差）；按职责拆出的子模块见 ./chat/*：
//   ctx       共享可变状态 + 跨模块晚绑定 hooks
//   markdown  Markdown/代码高亮     format   纯格式化工具
//   diff      文件 diff 卡片         toolcards 工具卡/结果/时间线/权限卡
//   stream    流式气泡               branches 分支/检查点/分支树
// 本文件负责：装载、会话生命周期、发送循环、daemon 事件机、消息级编排。
import { store } from '../store.js'
import { api, humanizeError } from '../api.js'
import { db, uid } from '../db.js'
import { toast, confirmPopover } from '../ui.js'
import { attachTemplateEngine } from './templates.js'
import { buildStylePrompt } from './settings.js'
import { ICONS } from '../icons.js'
import { runCompare, stopParallel } from '../parallel.js'
import { clear as clearReviewQueue } from '../review-queue.js'
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
import { bindGoalHotkey } from '../brief/composer.js'
import { briefSummary } from '../brief/schema.js'
import { mountIntentRail, computeIntent } from '../intent-rail.js'
import { buildHydratePayload } from '../session-sync.js'
import { createCcSelect } from '../cc-select.js'
import { bus } from '../bus.js'
import { ctx, h, setReviewState, clearEmpty, scrollDown, lastUserText } from './chat/ctx.js'
import { renderMarkdown, rehighlightVisibleCode } from './chat/markdown.js'
import { userDisplayText } from './chat/format.js'
import { appendDelta, clearStreamBubble } from './chat/stream.js'
import { addToolCard, fillToolResult, addPermCard } from './chat/toolcards.js'
import { renderBranchBar, addCheckpoint, snapshotBranch, syncBranchPanelLayout } from './chat/branches.js'

export { syncBranchPanelLayout }

const DRAFT_KEY = id => `ccui:draft:${id || 'new'}`
const EMPTY_HTML = `<div class="empty-brand" aria-hidden="true">C</div>
  <h1>开始对话</h1>
  <p>左侧每条都是独立会话。拖拽文件到输入框可附加路径。<br/>
  悬停你的消息可<strong>编辑并分叉</strong>；<kbd>Ctrl+Shift+E</kbd> 编辑上一条。<br/>
  会话栏下半<strong>分支树</strong> · 发送框上方可<strong>钉住这次要做</strong>（<kbd>Ctrl+Shift+B</kbd>） · 活动栏<strong>结构图</strong>。</p>
  <div class="examples">
    <button class="ex" type="button">解释这段代码在做什么</button>
    <button class="ex" type="button">帮我写单元测试</button>
    <button class="ex" type="button">读取 package.json 的 name</button>
    <button class="ex" type="button">这个项目是做什么的？</button>
  </div>`

/** @type {ReturnType<typeof createCcSelect> | null} */
let presetSelect = null

function refreshIntentRail() {
  ctx.intentRail?.refresh()
}

function handleIntentDebt(action) {
  switch (action) {
    case 'review':
      bus.emit('switch-view', 'review')
      break
    case 'compare':
      handleIntentAlign(computeIntent(ctx.convo, null, store.get()).north || 'Compare 结论')
      break
    default:
      break
  }
}

async function markCompareGroupResolved() {
  if (!ctx.convo?.compareGroupId || ctx.convo.compareResolved) return
  ctx.convo.compareResolved = true
  const siblings = (store.get().conversations || []).filter(x => x.compareGroupId === ctx.convo.compareGroupId)
  for (const s of siblings.length ? siblings : [ctx.convo]) {
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
  if (!ctx.convo) return
  const snap = computeIntent(ctx.convo, null, store.get())
  if (!snap.north) {
    toast('先写「这次要做到哪」', { type: 'info' })
    ctx.intentRail?.focusGoalEdit?.()
    return
  }
  handleIntentAlign(snap.north)
}

export function mountChat(container) {
  container.innerHTML = `
    <div class="ws">
      <div class="stage-chat" id="stageChat">
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

  ctx.els = {
    messages: container.querySelector('#messages'),
    input: container.querySelector('#input'),
    send: container.querySelector('#send'),
    historyList: document.getElementById('historyList'),
    presetPickerHost: container.querySelector('#presetPickerHost'),
  }
  // wire 跨模块回调（子模块经 ctx.hooks 调用，绕开循环依赖）
  ctx.hooks.persist = persist
  ctx.hooks.sendUserText = sendUserText
  ctx.hooks.renderItems = renderItems
  ctx.hooks.syncEngineContext = syncEngineContext
  ctx.hooks.refreshIntentRail = refreshIntentRail

  initPresetSelect()

  ctx.els.send.innerHTML = ICONS.send
  ctx.els.send.onclick = onSend
  ctx.els.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  })
  ctx.els.input.addEventListener('input', () => {
    ctx.els.input.style.height = 'auto'
    ctx.els.input.style.height = `${Math.min(ctx.els.input.scrollHeight, 180)}px`
    saveDraft()
  })
  bindExamples(container)
  document.getElementById('newConvo')?.addEventListener('click', () => newConversation(true))
  document.getElementById('newCompare')?.addEventListener('click', () => startCompareMode())
  attachTemplateEngine(ctx.els.input)
  bindFileDrop(container)
  ctx.intentRail = mountIntentRail(container.querySelector('#composerContextHost'), {
    getConvo: () => ctx.convo,
    getStore: () => store.get(),
    onNorthEdit: text => {
      if (!ctx.convo) return
      ctx.convo.intentNorth = text
      persist()
      refreshIntentRail()
    },
    onDebtAction: handleIntentDebt,
  })
  store.subscribe(s => {
    if (s.view === 'chat') refreshIntentRail()
  })
  bus.on('review-queue', () => refreshIntentRail())
  bindGoalHotkey(() => ctx.intentRail?.focusGoalEdit?.())
  bus.on('focus-goal', () => ctx.intentRail?.focusGoalEdit?.())
  document.addEventListener('keydown', onChatHotkey)
  bus.on('apply-brief', b => {
    if (!ctx.convo || !b) return
    ctx.convo.intentNorth = (b.outcome || b.problem || '').trim()
    persist()
    refreshIntentRail()
    toast('已钉住任务目标', { type: 'success' })
  })
  bus.on('review-diff', detail => {
    const { item, allow } = detail || {}
    if (!item) return
    const key = item.id || (item.permId ? `perm_${item.permId}` : null)
    if (key) setReviewState(key, allow ? 'accepted' : 'rejected')
    const sel = item.id ? `[data-review-id="${item.id}"]` : null
    if (sel) {
      const wrap = ctx.els.messages.querySelector(sel)
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
  bus.on('review-perm', detail => {
    const { permId, allow } = detail || {}
    if (permId == null || permId === '') return
    const pid = String(permId)
    setReviewState(`perm_${pid}`, allow ? 'accepted' : 'rejected')
    const card = ctx.els.messages?.querySelector(`.permcard[data-perm-id="${CSS.escape(pid)}"]`)
    if (card) card.remove()
    persist()
  })
  restoreDraft()

  bus.on('hljs-theme', rehighlightVisibleCode)
  bus.on('theme-changed', rehighlightVisibleCode)
  bootChat()
  api.onMessage(onDaemon)
  bus.on('new-convo', () => newConversation(true))
  bus.on('start-compare', () => startCompareMode())
  bus.on('align-check', () => runAlignCheck())
  bus.on('insert-prompt', prefix => {
    if (!ctx.els?.input) return
    ctx.els.input.value = `${prefix || ''}${ctx.els.input.value}`.trim()
    ctx.els.input.dispatchEvent(new Event('input'))
    ctx.els.input.focus()
  })
  bus.on('set-prompt', val => {
    if (!ctx.els?.input) return
    ctx.els.input.value = val || ''
    ctx.els.input.dispatchEvent(new Event('input'))
    ctx.els.input.focus()
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
  ctx.els?.input?.focus()
}

export function getActiveConversation() {
  return ctx.convo ? JSON.parse(JSON.stringify(ctx.convo)) : null
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
  if (!ctx.els || !ctx.convo) return
  if (store.get().busy) { toast('请先停止当前回答', { type: 'error' }); return }
  let idx = -1
  for (let i = ctx.convo.items.length - 1; i >= 0; i--) {
    if (ctx.convo.items[i].t === 'user') { idx = i; break }
  }
  if (idx < 0) { toast('没有可编辑的用户消息', { type: 'warn' }); return }
  let userN = 0
  for (let i = 0; i <= idx; i++) if (ctx.convo.items[i].t === 'user') userN++
  const el = ctx.els.messages.querySelectorAll('.msg.user')[userN - 1]
  if (!el) { toast('消息未渲染，请切换 Thread 后重试', { type: 'warn' }); return }
  startEdit(idx, ctx.convo.items[idx].text, el)
}

function syncComposerPlaceholder() {
  if (!ctx.els?.input) return
  if (store.get().comparePending) {
    ctx.els.input.placeholder = '同一任务 → 创建 Lane A/B/C 三条 Thread，Enter 启动…'
    return
  }
  ctx.els.input.placeholder = '输入消息，Enter 发送 / Shift+Enter 换行'
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
  ctx.els.input.value = ''
  ctx.els.input.style.height = 'auto'

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
    if (threads.some(t => t.id === ctx.convo?.id)) {
      ctx.convo = JSON.parse(JSON.stringify(threads.find(t => t.id === ctx.convo.id) || threads[0]))
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
  if (!ctx.els?.presetPickerHost) return
  presetSelect = createCcSelect({
    variant: 'pill',
    menuPlacement: 'above',
    fullWidth: false,
    icon: ICONS.presets,
    placeholder: '默认',
    options: [{ value: '', label: '默认', desc: '不附加系统提示' }],
    onChange: id => applyPresetId(id || null),
  })
  ctx.els.presetPickerHost.appendChild(presetSelect.el)
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
    b.onclick = () => { ctx.els.input.value = b.textContent; onSend() }
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
  if (!ctx.els?.input) return
  const refs = paths.map(p => `@${p.replace(/\\/g, '/')}`).join('\n')
  const sep = ctx.els.input.value.trim() ? '\n' : ''
  ctx.els.input.value = `${ctx.els.input.value}${sep}${refs}`
  ctx.els.input.dispatchEvent(new Event('input'))
  ctx.els.input.focus()
  toast(`已附加 ${paths.length} 个文件`, { type: 'info' })
}

/** 供 Studio / 命令面板打开会话 */
export function openConversation(c) {
  if (!ctx.els) return
  loadConversation(c)
}

async function bootChat() {
  await refreshHistory()
  const list = store.get().conversations || []
  if (list.length) loadConversation(list[0])
  else showEmptySession()
}

function showEmptySession() {
  ctx.convo = blankThread()
  store.set({ currentConversationId: ctx.convo.id, activeSessionId: ctx.convo.sessionId })
  api.reset(ctx.convo.sessionId)
  renderBranchBar()
}

function newConversation(resetEngine = true) {
  ctx.convo = blankThread()
  store.set({ currentConversationId: ctx.convo.id, activeSessionId: ctx.convo.sessionId, comparePending: false })
  if (resetEngine) api.reset(ctx.convo.sessionId)
  syncComposerPlaceholder()
  showEmptyState(true)
  renderBranchBar()
  restoreDraft()
}

function showEmptyState(withExamples = false) {
  if (!ctx.els) return
  ctx.els.messages.innerHTML = ''
  ctx.toolCards = new Map()
  ctx.streamBubble = null
  const empty = h('div', 'empty')
  empty.id = 'empty'
  if (withExamples) {
    empty.innerHTML = EMPTY_HTML
    bindExamples(empty)
  } else {
    empty.innerHTML = `<h1>开始对话</h1><p>新的会话已就绪。输入消息或按 Ctrl+K 搜索功能。</p>`
  }
  ctx.els.messages.appendChild(empty)
}

function saveDraft() {
  if (!ctx.els || !ctx.convo) return
  try { localStorage.setItem(DRAFT_KEY(ctx.convo.id), ctx.els.input.value) } catch {}
}

export function updateSessionTitle() {
  const el = document.getElementById('sessionTitle')
  if (!el) return
  el.textContent = ctx.convo?.title || '新对话'
}

function restoreDraft() {
  if (!ctx.els || !ctx.convo) return
  try {
    const d = localStorage.getItem(DRAFT_KEY(ctx.convo.id))
    if (d) { ctx.els.input.value = d; ctx.els.input.dispatchEvent(new Event('input')) }
  } catch {}
}

async function refreshHistory() {
  if (!ctx.els) return
  let list = []
  try { list = await db.getAll('conversations') } catch {}
  list = list.filter(c => c.kind !== 'compare')
  list.sort((a, b) => b.updatedAt - a.updatedAt)
  store.set({ conversations: list })
  ctx.els.historyList.innerHTML = ''
  if (!list.length) {
    ctx.els.historyList.appendChild(h('div', 'history-empty', '<span class="he-ico" aria-hidden="true">💬</span>开始新对话<br/><span class="he-sub">发送第一条消息后，会话会出现在这里</span>'))
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
      ctx.els.historyList.appendChild(h('div', 'history-group-label', `Compare · ${label}`))
      for (const s of siblings) appendHistoryItem(s)
    } else {
      appendHistoryItem(c)
    }
  }
}

function appendHistoryItem(c) {
  const item = h('div', 'history-item' + (c.lane ? ' lane' : ''))
  if (c.id === ctx.convo?.id) item.classList.add('active')
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
      if (siblings.some(s => s.id === ctx.convo?.id)) newConversation(true)
      refreshHistory()
    })
  }
  item.onclick = () => loadConversation(c)
  ctx.els.historyList.appendChild(item)
}

function syncEngineContext() {
  if (!ctx.convo) return
  const payload = buildHydratePayload(ctx.convo)
  if (!payload.items.length && !payload.engineMessages?.length) {
    api.reset(ctx.convo.sessionId)
    return
  }
  api.hydrateSession(ctx.convo.sessionId, payload)
}

function loadConversation(c) {
  clearReviewQueue()
  ctx.convo = JSON.parse(JSON.stringify(c))
  if (ctx.convo.kind === 'compare') {
    toast('旧版 Compare 格式已废弃，请用 + Compare 重新创建', { type: 'warn' })
    return
  }
  if (!ctx.convo.sessionId) ctx.convo.sessionId = `thread_legacy_${ctx.convo.id}`
  if (!ctx.convo.branches) ctx.convo.branches = []
  if (!ctx.convo.checkpoints) ctx.convo.checkpoints = []
  if (!ctx.convo.reviewState) ctx.convo.reviewState = {}
  store.set({ currentConversationId: ctx.convo.id, activeSessionId: ctx.convo.sessionId, comparePending: false })
  syncComposerPlaceholder()
  renderItems()
  refreshHistory()
  restoreDraft()
  updateSessionTitle()
  refreshIntentRail()
  syncEngineContext()
}

function renderItems() {
  if (!ctx.els) return
  ctx.bulkRendering = true
  ctx.els.messages.innerHTML = ''
  ctx.toolCards = new Map()
  ctx.streamBubble = null
  resetInspectorTimeline()
  renderBranchBar()
  if (!ctx.convo.items.length) {
    ctx.bulkRendering = false
    showEmptyState(true)
    return
  }
  for (let i = 0; i < ctx.convo.items.length; i++) {
    const it = ctx.convo.items[i]
    if (it.t === 'user') addUser(it.text, false, i, it.brief || null)
    else if (it.t === 'msg') handleMessage(it.sdk, false)
    else if (it.t === 'recall') addRecallCard(it.recall, false)
  }
  ctx.bulkRendering = false
  scrollDown(true)
  refreshIntentRail()
  bus.emit('layout-check')
}

function resetInspectorTimeline() {
  const tl = document.getElementById('insp-timeline')
  if (tl) tl.innerHTML = '<div class="tl-empty"><span class="tl-empty-ico" aria-hidden="true">⚙</span>尚无工具调用</div>'
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
  ctx.convo.items = ctx.convo.items.slice(0, idx)
  syncEngineContext()
  renderItems()
  sendUserText(newText)
}

async function persist() {
  if (!ctx.convo || !ctx.convo.items.length) return
  ctx.convo.updatedAt = Date.now()
  if (ctx.convo.title === '新对话') {
    const firstUser = ctx.convo.items.find(i => i.t === 'user')
    if (firstUser) ctx.convo.title = firstUser.text.slice(0, 24)
  }
  if (!store.get().busy) {
    try {
      const resp = await api.getMessages(ctx.convo.sessionId)
      if (resp?.ok && Array.isArray(resp.messages) && resp.messages.length) {
        ctx.convo.engineMessages = resp.messages
      }
    } catch {}
  }
  try {
    await db.put('conversations', ctx.convo)
    refreshHistory()
    updateSessionTitle()
    import('./collab.js').then(m => m.broadcastConversation?.(ctx.convo)).catch(() => {})
  } catch {}
}

// ---------- 消息级渲染（编排子模块） ----------
function addUser(text, record = true, idx = null, brief = null) {
  clearEmpty()
  if (record) {
    const item = { t: 'user', text }
    if (brief) item.brief = brief
    ctx.convo.items.push(item)
    idx = ctx.convo.items.length - 1
  }
  const el = h('div', 'msg user', `<div class="role">你</div><div class="bubble"></div><button class="msg-edit" title="编辑并建立分支">${ICONS.edit}</button>`)
  if (brief) {
    const badge = h('div', 'brief-badge', briefSummary(brief))
    el.insertBefore(badge, el.querySelector('.bubble'))
  }
  const display = brief ? userDisplayText(text, brief) : text
  el.querySelector('.bubble').textContent = display
  el.querySelector('.msg-edit').onclick = () => startEdit(idx, text, el)
  ctx.els.messages.appendChild(el)
  scrollDown()
}

function addThinking(text, live = true) {
  if (!text) return
  const el = h('details', live ? 'thinking thinking-live' : 'thinking')
  if (!live) el.open = false
  el.appendChild(h('summary', null, live ? '思考中…' : '思考过程'))
  const body = h('div', 'think-body'); body.textContent = text
  el.appendChild(body)
  ctx.els.messages.appendChild(el); scrollDown()
}

function addAssistantText(text) {
  if (!text || !text.trim()) return
  const el = h('div', 'msg assistant', '<div class="role">CCui</div><div class="bubble md"></div>')
  renderMarkdown(el.querySelector('.bubble'), text)
  ctx.els.messages.appendChild(el); scrollDown()
}

function handleMessage(sdk, record = true) {
  if (sdk && sdk.type === 'assistant') {
    stripCompletionFromSdk(sdk)
    clearStreamBubble()
  }
  if (!sdk) return
  const content = sdk.message && sdk.message.content
  if (!Array.isArray(content)) return
  if (record) ctx.convo.items.push({ t: 'msg', sdk: structuredClone(sdk) })
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

// ---------- 发送 / 续写 / daemon ----------
function finishAssistantTurn() {
  api.stopWatchdog()
  clearStreamBubble()
  setBusy(false)
  if (ctx.convo?.items?.length) addCheckpoint()
  renderBranchBar()
  persist()
  void maybeShowRecall()
}

function startTurnWatchdog() {
  api.startWatchdog(() => {
    if (canAutoContinue(ctx.continuationTracker)) attemptContinuation('watchdog')
    else toast('长时间无响应，自动续写次数已用尽', { type: 'error' })
  }, 600000)
}

function attemptContinuation(reason) {
  if (!consumeContinuation(ctx.continuationTracker)) {
    finishAssistantTurn(false)
    toast('未见完成信号，已停止自动续写', { type: 'warn' })
    return
  }
  ctx.continuationTracker.awaitingSignal = true
  toast(`检测到异常中断，正在续写…（剩余 ${ctx.continuationTracker.left} 次）`, { type: 'info' })
  sendEngineText(buildContinuationPrompt(reason), { meta: true })
}

function sendEngineText(text, { meta = false } = {}) {
  setBusy(true)
  const s = store.get()
  const preset = s.presets.find(p => p.id === s.activePresetId)
  const stylePrompt = buildStylePrompt(s.codingStyle)
  const needCompletionRule = meta || ctx.continuationTracker?.awaitingSignal
  const systemPrompt = [stylePrompt, preset?.systemPrompt, needCompletionRule ? COMPLETION_RULE : null].filter(Boolean).join('\n\n')
  api.send({
    text,
    model: preset?.model,
    systemPrompt,
    sessionId: ctx.convo?.sessionId || 'main',
  })
  startTurnWatchdog()
}

function setBusy(v) {
  store.set({ busy: v, daemonStatus: v ? 'busy' : (store.get().daemonStatus === 'offline' ? 'offline' : 'ready') })
  updateSendButton()
  refreshIntentRail()
}

function updateSendButton() {
  if (!ctx.els) return
  const s = store.get()
  const running = s.busy || s.orchBusy
  ctx.els.send.disabled = false
  ctx.els.send.innerHTML = running ? ICONS.stop : ICONS.send
  ctx.els.send.title = running ? '停止' : '发送'
  ctx.els.send.classList.toggle('stop', running)
  ctx.els.input.closest('.composer')?.classList.toggle('busy', running)
}

async function onSend() {
  const s = store.get()
  if (s.orchBusy) { stopParallel(); updateSendButton(); return }
  if (s.busy) {
    if (ctx.continuationTracker) ctx.continuationTracker.userStop = true
    api.interrupt(ctx.convo?.sessionId)
    return
  }
  let text = ctx.els.input.value.trim()
  if (!text) return

  ctx.els.input.value = ''
  ctx.els.input.style.height = 'auto'

  if (s.comparePending) {
    await runCompareAsThreeThreads(text)
    return
  }

  const north = ctx.convo?.intentNorth?.trim()
  if (north) {
    text = `[当前任务] ${north}\n\n${text}`
  }

  try { localStorage.removeItem(DRAFT_KEY(ctx.convo?.id)) } catch {}
  sendUserText(text)
}

async function sendUserText(text, brief = null) {
  addUser(text, true, null, brief)
  renderBranchBar()
  ctx.continuationTracker = createContinuationTracker()
  sendEngineText(text)
}

function onDaemon(msg) {
  if (msg.kind === 'exit') { addAssistantText(`*[daemon 已退出 code=${msg.code}]*`); finishAssistantTurn(false); return }
  if (msg.kind === 'event') {
    const sid = msg.sessionId || 'main'
    const active = ctx.convo?.sessionId || store.get().activeSessionId || 'main'
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
      const plain = lastAssistantPlainText(ctx.convo, ctx.streamBubble)
      if (ctx.continuationTracker?.awaitingSignal) {
        if (hasCompletionSignal(plain)) {
          stripCompletionFromLastItem()
          ctx.continuationTracker.awaitingSignal = false
          finishAssistantTurn(true)
        } else if (canAutoContinue(ctx.continuationTracker)) {
          attemptContinuation('abnormal')
        } else {
          ctx.continuationTracker.awaitingSignal = false
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
      if (ctx.continuationTracker?.userStop) {
        finishAssistantTurn(false)
        toast('已停止', { type: 'info' })
      } else if (ctx.continuationTracker?.awaitingSignal && canAutoContinue(ctx.continuationTracker)) {
        attemptContinuation('abnormal')
      } else {
        finishAssistantTurn(false)
      }
      break
    case 'error':
      if (isTruncationError(e.error) && canAutoContinue(ctx.continuationTracker)) {
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
  if (!ctx.streamBubble?.text?.trim()) return
  const display = stripCompletionSignal(ctx.streamBubble.text.trim())
  const sdk = assistantSdk(display)
  ctx.convo.items.push({ t: 'msg', sdk: structuredClone(sdk) })
  clearStreamBubble()
  if (display) addAssistantText(display)
}

function stripCompletionFromLastItem() {
  for (let i = ctx.convo.items.length - 1; i >= 0; i--) {
    const it = ctx.convo.items[i]
    if (it.t === 'msg' && it.sdk?.type === 'assistant') {
      stripCompletionFromSdk(it.sdk)
      return
    }
  }
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
  ctx.els.messages.appendChild(el); scrollDown()
}

// ---------- 记忆召回可视（CCui 差异化）----------
// daemon getRecall 读引擎内存的 recall 日志（hybridRecall 每轮 recordRecall），
// 把「本轮基于哪些记忆作答」直接呈现在对话流里，可展开看候选/打分/图谱命中。
function addRecallCard(recall, record = true) {
  if (!recall || !Array.isArray(recall.candidates)) return
  const isSel = p => (recall.selected || []).some(s => s === p || s.endsWith(p) || p.endsWith(s))
  const n = (recall.selected || []).length
  const gh = (recall.graphHits || []).length
  const el = h('details', 'recall-card')
  const sum = h('summary', 'recall-sum')
  sum.innerHTML = `<span class="rc-ico" aria-hidden="true">🧠</span><span class="rc-title">召回 ${n} 条记忆</span><span class="rc-tag">${recall.method === 'hybrid+llm' ? 'LLM 精排' : '混合检索'}</span>${gh ? `<span class="rc-tag">图命中 ${gh}</span>` : ''}`
  el.appendChild(sum)
  const body = h('div', 'recall-body')
  const cand = recall.candidates.slice(0, 12)
  if (!cand.length) {
    body.appendChild(h('div', 'rc-empty', '本轮未命中已有记忆。'))
  } else {
    for (const c of cand) {
      const on = isSel(c.path)
      const row = h('div', `rc-row${on ? ' rc-on' : ''}`)
      const star = h('span', 'rc-star'); star.textContent = on ? '★' : '·'
      const score = h('span', 'rc-score'); score.textContent = (Number(c.score) || 0).toFixed(2)
      const path = h('span', 'rc-path'); path.textContent = String(c.path || '').replace(/\\/g, '/')
      const why = h('span', 'rc-why'); why.textContent = (c.reasons || []).join(' · ')
      row.append(star, score, path, why)
      body.appendChild(row)
    }
  }
  if (gh) {
    const g = h('div', 'rc-graph'); g.textContent = `图谱关联：${recall.graphHits.join(', ')}`
    body.appendChild(g)
  }
  el.appendChild(body)
  ctx.els.messages.appendChild(el); scrollDown()
  if (record && ctx.convo) { ctx.convo.items.push({ t: 'recall', recall }); persist() }
}

async function maybeShowRecall() {
  try {
    const r = await api.request({ cmd: 'getRecall' }, 6000)
    const last = r && r.last
    if (!last || !last.at || ctx.lastRecallAt === last.at) return
    ctx.lastRecallAt = last.at
    addRecallCard(last, true)
  } catch {}
}
