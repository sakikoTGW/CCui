// 变更审查 — 应用内视图，批处理允许/拒绝
import { getAll, respondBatch } from '../review-queue.js'

/** @typedef {{ id: string; kind: string; toolName: string; message?: string; path?: string; oldStr?: string; newStr?: string; selected?: boolean }} ReviewItem */

let container = null
/** @type {ReviewItem[]} */
let queue = []

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function selectedIds() {
  return queue.filter(x => x.selected !== false).map(x => x.id)
}

function sendBatch(ids, allow, alwaysAllow = false) {
  if (!ids.length) return
  void respondBatch(ids, allow, { alwaysAllow })
}

function renderDiff(oldStr, newStr) {
  const box = document.createElement('div')
  box.className = 'rv-diff'
  if (oldStr) {
    for (const line of String(oldStr).split('\n').slice(0, 80)) {
      const d = document.createElement('div')
      d.className = 'del'
      d.textContent = `- ${line}`
      box.appendChild(d)
    }
  }
  if (newStr) {
    for (const line of String(newStr).split('\n').slice(0, 80)) {
      const d = document.createElement('div')
      d.className = 'add'
      d.textContent = `+ ${line}`
      box.appendChild(d)
    }
  }
  return box
}

function renderCard(item) {
  const card = document.createElement('article')
  card.className = `rv-card${item.selected !== false ? ' rv-selected' : ''}`
  card.dataset.id = item.id

  const head = document.createElement('div')
  head.className = 'rv-card-head'

  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = item.selected !== false
  cb.onchange = () => {
    item.selected = cb.checked
    card.classList.toggle('rv-selected', cb.checked)
  }

  const meta = document.createElement('div')
  meta.className = 'rv-card-meta'
  const kindLabel = item.kind === 'diff' ? '文件变更' : '工具授权'
  const title = item.path || item.toolName || '—'
  meta.innerHTML = `
    <div class="rv-kind">${esc(kindLabel)}</div>
    <div class="rv-title">${esc(title)}</div>
    ${item.message ? `<div class="rv-msg">${esc(item.message)}</div>` : ''}`

  const actions = document.createElement('div')
  actions.className = 'rv-card-actions'
  const allowBtn = document.createElement('button')
  allowBtn.type = 'button'
  allowBtn.className = 'rv-btn rv-primary'
  allowBtn.textContent = item.kind === 'diff' ? '接受' : '允许'
  allowBtn.onclick = () => void respondBatch([item.id], true)

  const denyBtn = document.createElement('button')
  denyBtn.type = 'button'
  denyBtn.className = 'rv-btn rv-danger'
  denyBtn.textContent = '拒绝'
  denyBtn.onclick = () => void respondBatch([item.id], false)

  actions.append(allowBtn, denyBtn)
  head.append(cb, meta, actions)
  card.appendChild(head)

  if (item.kind === 'diff' && (item.oldStr || item.newStr)) {
    card.appendChild(renderDiff(item.oldStr, item.newStr))
  }

  return card
}

function render() {
  if (!container) return
  const count = container.querySelector('#reviewCount')
  const empty = container.querySelector('#reviewEmpty')
  const list = container.querySelector('#reviewList')
  const n = queue.length
  if (count) count.textContent = `${n} 待处理`
  if (empty) empty.hidden = n > 0
  if (list) {
    list.innerHTML = ''
    for (const item of queue) list.appendChild(renderCard(item))
  }
}

function syncFromQueue(items) {
  queue = (items || []).map(x => ({ ...x, selected: x.selected !== false }))
  render()
}

function onReviewQueue(e) {
  syncFromQueue(e.detail)
}

export function mountReview(c) {
  container = c
  container.innerHTML = `
    <div class="review-app">
      <header class="review-head">
        <div class="review-head-left">
          <h1>变更审查</h1>
          <span class="review-count" id="reviewCount">0 待处理</span>
        </div>
        <div class="review-head-actions">
          <button type="button" class="rv-btn" id="rvSelectAll">全选</button>
          <button type="button" class="rv-btn rv-primary" id="rvAllowSel">允许所选</button>
          <button type="button" class="rv-btn rv-danger" id="rvDenySel">拒绝所选</button>
          <span class="review-sep"></span>
          <button type="button" class="rv-btn rv-primary" id="rvAllowAll">全部允许</button>
          <button type="button" class="rv-btn rv-danger" id="rvDenyAll">全部拒绝</button>
        </div>
      </header>
      <div class="review-empty" id="reviewEmpty">暂无待审查项。Agent 请求工具权限或产生文件 diff 时会出现在这里。</div>
      <div class="review-list" id="reviewList"></div>
    </div>`

  container.querySelector('#rvSelectAll').onclick = () => {
    const allOn = queue.every(x => x.selected !== false)
    queue.forEach(x => { x.selected = !allOn })
    render()
  }
  container.querySelector('#rvAllowSel').onclick = () => sendBatch(selectedIds(), true)
  container.querySelector('#rvDenySel').onclick = () => sendBatch(selectedIds(), false)
  container.querySelector('#rvAllowAll').onclick = () => sendBatch(queue.map(x => x.id), true)
  container.querySelector('#rvDenyAll').onclick = () => sendBatch(queue.map(x => x.id), false)

  window.removeEventListener('ccui:review-queue', onReviewQueue)
  window.addEventListener('ccui:review-queue', onReviewQueue)
  syncFromQueue(getAll())
}
