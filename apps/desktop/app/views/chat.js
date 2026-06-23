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
import { diagCatch } from '../diag.js'
import { renderMarkdown, rehighlightVisibleCode } from './chat/markdown.js'
import { userDisplayText } from './chat/format.js'
import { appendDelta, clearStreamBubble, showThinking, hideThinking, appendThinkingDelta, finalizeThinkBubble, commitThinkBubbleIfNeeded } from './chat/stream.js'
import { initMention } from './chat/mention.js'
import { addToolCard, fillToolResult, addPermCard } from './chat/toolcards.js'
import { renderBranchBar, addCheckpoint, snapshotBranch, syncBranchPanelLayout } from './chat/branches.js'

export { syncBranchPanelLayout }

const DRAFT_KEY = id => `ccui:draft:${id || 'new'}`
const EMPTY_HTML = `<div class="empty-hero">
    <div class="empty-brand" aria-hidden="true">C</div>
    <h1>开始对话</h1>
    <p class="empty-sub">把任务交给 AI，全程可审、可分叉、可回溯。</p>
  </div>
  <div class="empty-caps">
    <div class="cap"><span class="cap-ico">@</span><div><b>指文件</b><i>拖入文件或输入 @ 选择</i></div></div>
    <div class="cap"><span class="cap-ico">/</span><div><b>用技能</b><i>输入 / 唤起 skills 与命令</i></div></div>
    <div class="cap"><span class="cap-ico">⌘K</span><div><b>快速搜索</b><i>Ctrl+K 跳转任意功能</i></div></div>
    <div class="cap"><span class="cap-ico">⎇</span><div><b>分叉对比</b><i>悬停消息编辑并建立分支</i></div></div>
  </div>
  <div class="examples">
    <button class="ex" type="button">解释这段代码在做什么</button>
    <button class="ex" type="button">帮我写单元测试</button>
    <button class="ex" type="button">读取 package.json 的 name</button>
    <button class="ex" type="button">这个项目是做什么的？</button>
  </div>`

/** @type {ReturnType<typeof createCcSelect> | null} */
let presetSelect = null
/** @type {ReturnType<typeof createCcSelect> | null} */
let modelSelect = null

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
          <div class="compare-panel" id="comparePanel" hidden>
            <div class="cp-head">三路对比 · 选择采纳继续</div>
            <div class="pl-lanes" id="compareLanes"></div>
          </div>
          <div class="messages" id="messages">
            <div class="empty" id="empty">${EMPTY_HTML}</div>
          </div>
        </div>
      </div>
      <div class="composer">
        <div class="composer-meta">
          <div id="modelPickerHost"></div>
          <div id="presetPickerHost"></div>
        </div>
        <div id="composerContextHost"></div>
        <div class="composer-attachments" id="attachRow" hidden></div>
        <div class="composer-inner">
          <button id="attachBtn" class="attach-btn" type="button" title="附加文件"></button>
          <textarea id="input" rows="1" placeholder="输入消息，Enter 发送 / Shift+Enter 换行 / 拖入文件"></textarea>
          <button id="send" class="send" title="发送"></button>
        </div>
      </div>
    </div>`

  ctx.els = {
    messages: container.querySelector('#messages'),
    input: container.querySelector('#input'),
    send: container.querySelector('#send'),
    attachBtn: container.querySelector('#attachBtn'),
    attachRow: container.querySelector('#attachRow'),
    historyList: document.getElementById('historyList'),
    presetPickerHost: container.querySelector('#presetPickerHost'),
    modelPickerHost: container.querySelector('#modelPickerHost'),
    comparePanel: container.querySelector('#comparePanel'),
    compareLanes: container.querySelector('#compareLanes'),
  }
  // wire 跨模块回调（子模块经 ctx.hooks 调用，绕开循环依赖）
  ctx.hooks.persist = persist
  ctx.hooks.sendUserText = sendUserText
  ctx.hooks.renderItems = renderItems
  ctx.hooks.syncEngineContext = syncEngineContext
  ctx.hooks.refreshIntentRail = refreshIntentRail

  initPresetSelect()
  initModelSelect()

  bus.on('project-changed', payload => { void handleProjectChanged(payload) })
  window.ccui?.onProjectChanged?.(payload => { void handleProjectChanged(payload) })
  bus.on('mention-file', ({ path, rel }) => {
    if (path || rel) addAttachmentPaths([path || rel])
  })
  ctx.els.send.onclick = onSend
  ctx.els.input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    const sendKey = (() => { try { return window.ccuiPrefs?.get?.().sendKey } catch { return 'enter' } })() || 'enter'
    if (sendKey === 'ctrlenter') {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); onSend() }
    } else if (!e.shiftKey) {
      e.preventDefault(); onSend()
    }
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
  initMention(ctx.els.input)
  if (ctx.els.attachBtn) {
    ctx.els.attachBtn.innerHTML = ATTACH_ICON
    ctx.els.attachBtn.onclick = async () => {
      const picked = (await window.ccui?.pickFiles?.()) || []
      if (picked.length) addAttachments(picked)
    }
  }
  ctx.els.input.addEventListener('paste', async e => {
    const items = e.clipboardData?.items
    if (!items || ![...items].some(it => it.type?.startsWith('image/'))) return
    e.preventDefault()
    const p = await window.ccui?.saveClipboardImage?.()
    if (p) addAttachments([p]); else toast('剪贴板没有可用图片', { type: 'warn' })
  })
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
  bus.on('home-send', text => {
    if (!ctx.els?.input) return
    const q = String(text || '').trim()
    if (!q) return
    newConversation(true)
    ctx.els.input.value = q
    ctx.els.input.dispatchEvent(new Event('input'))
    void onSend()
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
  if (!el) { toast('消息未渲染，请切换会话后重试', { type: 'warn' }); return }
  startEdit(idx, ctx.convo.items[idx].text, el)
}

function syncComposerPlaceholder() {
  if (!ctx.els?.input) return
  if (store.get().comparePending) {
    ctx.els.input.placeholder = '同一任务 → 创建路线 A/B/C 三条对比会话，Enter 启动…'
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
  toast('已创建路线 A/B/C，正在并行运行…', { type: 'info' })

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
    toast('路线 A/B/C 已完成', { type: 'success' })
    showComparePanel(threads, resp.synthesis, resp.reviews)
  } catch (e) {
    toast(`Compare 失败：${e.message}`, { type: 'error' })
  } finally {
    setBusy(false)
    updateSendButton()
  }
}

function showComparePanel(threads, synthesis, reviews) {
  const panel = ctx.els?.comparePanel
  const lanes = ctx.els?.compareLanes
  if (!panel || !lanes) return
  panel.hidden = false
  lanes.innerHTML = ''
  for (const th of threads.sort((a, b) => (a.lane || '').localeCompare(b.lane || ''))) {
    const lane = th.lane || '?'
    const last = [...(th.items || [])].reverse().find(it => it.t === 'msg' && it.sdk?.type === 'assistant')
    const text = last?.sdk?.message?.content?.find?.(b => b?.type === 'text')?.text || '（空）'
    const card = h('div', 'pl-lane')
    card.innerHTML = `<div class="pl-label">路线 ${lane}</div><div class="pl-body"></div><button type="button" class="pl-adopt">采用此路线</button>`
    card.querySelector('.pl-body').textContent = text.slice(0, 800) + (text.length > 800 ? '…' : '')
    card.querySelector('.pl-adopt').onclick = () => {
      adoptCompareLane(th, synthesis)
      panel.hidden = true
    }
    lanes.appendChild(card)
  }
  if (Array.isArray(reviews) && reviews.length) {
    const rv = h('div', 'pl-reviews', `<div class="pl-label">交叉评审</div><pre></pre>`)
    rv.querySelector('pre').textContent = reviews.map(r => `[${r.fromLane || '?'}→${r.targetLane || '?'}] ${r.summary || r.text || ''}`).join('\n\n')
    lanes.appendChild(rv)
  }
}

function adoptCompareLane(thread, synthesis) {
  loadConversation(thread)
  if (synthesis) {
    ctx.convo.items.push({ t: 'msg', sdk: synthesisSdk(synthesis) })
    persist()
    renderItems()
  }
  toast(`已采用路线 ${thread.lane || ''}，可在此 Thread 继续`, { type: 'success' })
}

/** 写入或更新 thread 最后一条 assistant 消息（避免流式 + 批量重复） */
function writeAssistantItem(th, text) {
  const sdk = assistantSdk(text)
  const last = th.items[th.items.length - 1]
  if (last?.t === 'msg') last.sdk = sdk
  else th.items.push({ t: 'msg', sdk })
}

function initModelSelect() {
  if (!ctx.els?.modelPickerHost) return
  const buildOpts = () => {
    const s = store.get()
    const conn = (() => { try { return JSON.parse(localStorage.getItem('ccui:conn') || '{}') } catch { return {} } })()
    const models = new Set([
      conn.model,
      s.model,
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-chat',
    ].filter(Boolean))
    return [{ value: '', label: '自动', desc: '跟随预设/路由' }, ...[...models].map(m => ({ value: m, label: m }))]
  }
  modelSelect = createCcSelect({
    variant: 'pill',
    menuPlacement: 'above',
    fullWidth: false,
    placeholder: '模型',
    options: buildOpts(),
    value: store.get().chatModel || '',
    onChange: id => store.set({ chatModel: id || null }),
  })
  ctx.els.modelPickerHost.appendChild(modelSelect.el)
}

function inferTaskType(text) {
  const t = String(text || '')
  if (/规划|方案|架构|设计|plan/i.test(t)) return 'plan'
  if (/搜索|查找|glob|grep|find/i.test(t)) return 'search'
  if (/总结|摘要|summarize/i.test(t)) return 'summarize'
  if (/审查|review/i.test(t)) return 'review'
  if (/重构|refactor|edit/i.test(t)) return 'edit'
  return 'chat'
}

async function handleProjectChanged(payload) {
  const path = payload?.path || store.get().projectPath || ''
  if (path) store.set({ projectPath: path, projectName: payload?.name || path.split(/[/\\]/).pop() || '' })
  await refreshHistory()
  const list = (store.get().conversations || []).filter(c => !c.projectPath || c.projectPath === path)
  if (list.length) loadConversation(list[0])
  else showEmptySession()
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
      addAttachments(paths)
    })
  }
}

// ---------- 附件块（拖拽/选择文件 → 小图标 chip，发送时转 @path） ----------
const ATTACH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5"/></svg>'
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
const CODE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'rb', 'php', 'swift', 'kt', 'sh', 'sql', 'json', 'yaml', 'yml', 'toml', 'css', 'scss', 'html', 'vue', 'svelte'])

function fileKind(ext) {
  if (IMG_EXT.has(ext)) return 'img'
  if (CODE_EXT.has(ext)) return 'code'
  if (['md', 'txt', 'pdf', 'doc', 'docx', 'rtf'].includes(ext)) return 'doc'
  return 'file'
}

function kindIcon(kind) {
  if (kind === 'img') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/></svg>'
  if (kind === 'code') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l-3 3 3 3M16 9l3 3-3 3M13 6l-2 12"/></svg>'
  if (kind === 'doc') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></svg>'
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>'
}

function addAttachments(paths) {
  if (!ctx.els?.attachRow) return
  ctx.attachments = ctx.attachments || []
  let added = 0
  for (const raw of paths) {
    const p = String(raw).replace(/\\/g, '/')
    if (ctx.attachments.some(a => a.path === p)) continue
    const name = p.split('/').pop() || p
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
    ctx.attachments.push({ path: p, name, ext, kind: fileKind(ext) })
    added++
  }
  if (added) renderAttachments()
}

function removeAttachment(path) {
  if (!ctx.attachments) return
  ctx.attachments = ctx.attachments.filter(a => a.path !== path)
  renderAttachments()
}

function clearAttachments() {
  ctx.attachments = []
  renderAttachments()
}

function renderAttachments() {
  const row = ctx.els?.attachRow
  if (!row) return
  const list = ctx.attachments || []
  row.innerHTML = ''
  if (!list.length) { row.hidden = true; return }
  row.hidden = false
  for (const a of list) {
    const chip = h('div', `attach-chip kind-${a.kind}`)
    chip.title = a.path
    const icon = h('span', 'attach-ico'); icon.innerHTML = kindIcon(a.kind)
    const label = h('span', 'attach-name'); label.textContent = a.name
    const del = h('button', 'attach-x'); del.type = 'button'; del.textContent = '×'
    del.title = '移除'
    del.onclick = () => removeAttachment(a.path)
    chip.append(icon, label)
    if (a.ext) { const badge = h('span', 'attach-ext'); badge.textContent = a.ext; chip.append(badge) }
    chip.append(del)
    row.appendChild(chip)
  }
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
  clearAttachments()
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
  try { list = await db.getAll('conversations') } catch (e) { diagCatch('refreshHistory', e) }
  const pp = store.get().projectPath
  list = list.filter(c => c.kind !== 'compare' && (!pp || !c.projectPath || c.projectPath === pp))
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
    const msg = siblings.length > 1 ? `删除对比组（${siblings.length} 条会话）？` : `删除「${c.title || '未命名'}」？`
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
  clearAttachments()
  try { if (window.ccuiPrefs?.get?.().enterToFocus !== false) setTimeout(() => ctx.els?.input?.focus(), 60) } catch { /* prefs 未就绪 */ }
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
    } catch (e) { diagCatch('syncEngineMessages', e) }
  }
  try {
    await db.put('conversations', ctx.convo)
    refreshHistory()
    updateSessionTitle()
    import('./collab.js').then(m => m.broadcastConversation?.(ctx.convo)).catch(e => diagCatch('collab', e))
  } catch (e) { diagCatch('persist', e) }
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
  el.appendChild(buildMsgActions(display, false))
  ctx.els.messages.appendChild(el)
  scrollDown()
}

function addThinking(text, live = true) {
  if (!text) return
  const el = h('details', live ? 'thinking thinking-live' : 'thinking')
  const wantOpen = (() => { try { return !!window.ccuiPrefs?.get?.().thinkingOpen } catch { return false } })()
  el.open = live ? true : wantOpen
  el.appendChild(h('summary', null, live ? '思考中…' : '思考过程'))
  const body = h('div', 'think-body'); body.textContent = text
  el.appendChild(body)
  ctx.els.messages.appendChild(el); scrollDown()
}

function addAssistantText(text) {
  if (!text || !text.trim()) return
  const el = h('div', 'msg assistant', '<div class="role">CCui</div><div class="bubble md"></div>')
  renderMarkdown(el.querySelector('.bubble'), text)
  el.appendChild(buildMsgActions(text, true))
  ctx.els.messages.appendChild(el); scrollDown()
}

/** 消息悬浮操作条：复制（助手再加重新生成） */
function buildMsgActions(text, isAssistant) {
  const bar = h('div', 'msg-actions')
  const copy = h('button', 'msg-act', '复制'); copy.type = 'button'; copy.title = '复制内容'
  copy.onclick = () => {
    navigator.clipboard?.writeText(text || '').then(() => {
      copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制' }, 1400)
    }, () => {})
  }
  bar.appendChild(copy)
  if (isAssistant) {
    const regen = h('button', 'msg-act', '重新生成'); regen.type = 'button'; regen.title = '用上一条提问重答'
    regen.onclick = () => {
      if (store.get().busy) { toast('请先停止当前回答', { type: 'warn' }); return }
      const prev = lastUserText()
      if (prev) sendUserText(prev); else toast('没有可重答的上一条', { type: 'warn' })
    }
    bar.appendChild(regen)
  }
  return bar
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
  hideThinking()
  commitThinkBubbleIfNeeded()
  commitStreamBubbleIfNeeded()
  finalizeThinkBubble()
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
  showThinking()
  const s = store.get()
  const preset = s.presets.find(p => p.id === s.activePresetId)
  const stylePrompt = buildStylePrompt(s.codingStyle)
  const needCompletionRule = meta || ctx.continuationTracker?.awaitingSignal
  const systemPrompt = [stylePrompt, preset?.systemPrompt, needCompletionRule ? COMPLETION_RULE : null].filter(Boolean).join('\n\n')
  const model = s.chatModel || preset?.model
  api.send({
    text,
    model,
    taskType: inferTaskType(text),
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
  const body = ctx.els.input.value.trim()
  const atts = (ctx.attachments || []).map(a => `@${a.path}`)
  if (!body && !atts.length) return

  ctx.els.input.value = ''
  ctx.els.input.style.height = 'auto'

  let text = atts.length ? `${atts.join('\n')}${body ? `\n\n${body}` : ''}` : body
  clearAttachments()

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
    case 'delta':
      if (e.kind === 'text') { hideThinking(); appendDelta(e.text) }
      else if (e.kind === 'thinking') appendThinkingDelta(e.text)
      break
    case 'message': hideThinking(); handleMessage(e.sdk); break
    case 'permission_request': hideThinking(); clearStreamBubble(); addPermCard(e.id, e.toolName, e.message, e.input); break
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
