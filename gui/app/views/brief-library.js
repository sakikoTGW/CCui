// 简报库 — Task Brief 归档与复用
import { listLibrary, deleteFromLibrary, saveDraft } from '../brief/store.js'
import { normalizeBrief, assessBrief, domainLabels } from '../brief/schema.js'
import { toast, confirmPopover } from '../ui.js'

let container = null

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

export async function mountBriefLibrary(c) {
  container = c
  container.innerHTML = `
    <div class="view-head"><h1>简报库</h1>
      <p class="vh-sub">Task Brief — 结构化任务规格，从 Composer 存库或在此复用到新 Thread。</p>
    </div>
    <div class="brief-lib-list" id="briefLibList"></div>`

  await render()
}

async function render() {
  const list = container.querySelector('#briefLibList')
  const items = await listLibrary()
  list.innerHTML = ''
  if (!items.length) {
    list.appendChild(h('div', 'brief-lib-empty', '暂无简报。在对话 Composer 开启 Brief 模式，填写后点「存库」。'))
    return
  }
  for (const b of items) {
    const a = assessBrief(b)
    const row = h('div', 'brief-lib-row')
    row.innerHTML = `
      <div class="bl-main">
        <div class="bl-title"></div>
        <div class="bl-meta"></div>
        <div class="bl-outcome"></div>
      </div>
      <div class="bl-actions">
        <button type="button" class="btn-ghost bl-use">用到对话</button>
        <button type="button" class="btn-ghost bl-del">删除</button>
      </div>`
    row.querySelector('.bl-title').textContent = b.title || '未命名'
    row.querySelector('.bl-meta').textContent = `${domainLabels(b.domains).join(' · ') || '—'} · ${a.pct}% · ${new Date(b.savedAt || b.updatedAt).toLocaleString()}`
    row.querySelector('.bl-outcome').textContent = b.outcome || b.problem || ''
    row.querySelector('.bl-use').onclick = () => applyBrief(b)
    row.querySelector('.bl-del').onclick = e => {
      confirmPopover(e.target, '删除此简报？', async () => {
        await deleteFromLibrary(b.id)
        toast('已删除', { type: 'success' })
        await render()
      })
    }
    list.appendChild(row)
  }
}

async function applyBrief(b) {
  const n = normalizeBrief(b)
  window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'chat' }))
  window.dispatchEvent(new CustomEvent('ccui:apply-brief', { detail: n }))
  toast('已载入 Brief 到 Composer', { type: 'success' })
}
