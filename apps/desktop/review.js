// 变更审查窗口 — 批处理允许/拒绝
/** @typedef {{ id: string; kind: string; toolName: string; message?: string; path?: string; oldStr?: string; newStr?: string; selected?: boolean }} ReviewItem */

let queue = []

const els = {
  count: document.getElementById('reviewCount'),
  empty: document.getElementById('reviewEmpty'),
  list: document.getElementById('reviewList'),
  selectAll: document.getElementById('rvSelectAll'),
  allowSel: document.getElementById('rvAllowSel'),
  denySel: document.getElementById('rvDenySel'),
  allowAll: document.getElementById('rvAllowAll'),
  denyAll: document.getElementById('rvDenyAll'),
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function selectedIds() {
  return queue.filter(x => x.selected !== false).map(x => x.id)
}

function sendBatch(ids, allow, alwaysAllow = false) {
  if (!ids.length) return
  window.ccui?.reviewAction?.({ action: 'batch', ids, allow, alwaysAllow })
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
  allowBtn.onclick = () => window.ccui?.reviewAction?.({ action: 'single', ids: [item.id], allow: true })

  const denyBtn = document.createElement('button')
  denyBtn.type = 'button'
  denyBtn.className = 'rv-btn rv-danger'
  denyBtn.textContent = item.kind === 'diff' ? '拒绝' : '拒绝'
  denyBtn.onclick = () => window.ccui?.reviewAction?.({ action: 'single', ids: [item.id], allow: false })

  actions.append(allowBtn, denyBtn)
  head.append(cb, meta, actions)
  card.appendChild(head)

  if (item.kind === 'diff' && (item.oldStr || item.newStr)) {
    card.appendChild(renderDiff(item.oldStr, item.newStr))
  }

  return card
}

function render() {
  const n = queue.length
  els.count.textContent = `${n} 待处理`
  els.empty.hidden = n > 0
  els.list.innerHTML = ''
  for (const item of queue) els.list.appendChild(renderCard(item))
}

window.ccui?.onReviewQueue?.(items => {
  queue = (items || []).map(x => ({ ...x, selected: x.selected !== false }))
  render()
})

els.selectAll.onclick = () => {
  const allOn = queue.every(x => x.selected !== false)
  queue.forEach(x => { x.selected = !allOn })
  render()
}
els.allowSel.onclick = () => sendBatch(selectedIds(), true)
els.denySel.onclick = () => sendBatch(selectedIds(), false)
els.allowAll.onclick = () => sendBatch(queue.map(x => x.id), true)
els.denyAll.onclick = () => sendBatch(queue.map(x => x.id), false)

render()
