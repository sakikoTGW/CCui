// 数据工作室：全量搜索 + 批量导出 Markdown/PDF + 归档/回收站 + 分支树只读
import { marked } from '../../node_modules/marked/lib/marked.esm.js'
import { db } from '../db.js'
import { toast, confirmPopover } from '../ui.js'
import { registerOverlay } from '../modal.js'
import { renderBranchTree, renderBranchSvg } from '../branch-tree.js'

let container = null
let all = []          // 所有会话
let selected = new Set()
let filter = { q: '', from: '', to: '', model: '', tab: 'active' } // tab: active|archived|trash

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

export async function mountStudio(c) {
  container = c
  selected = new Set()
  container.innerHTML = `
    <div class="view-head"><h1>数据工作室</h1>
      <div class="vh-actions">
        <button class="btn-ghost" id="st-export">导出所选 Markdown</button>
        <button class="btn-ghost" id="st-export-pdf">导出所选 PDF</button>
        <button class="btn-ghost" id="st-export-all">备份全部 (JSON)</button>
      </div>
    </div>
    <div class="studio-tabs">
      <button class="st-tab active" data-tab="active">活跃</button>
      <button class="st-tab" data-tab="archived">已归档</button>
      <button class="st-tab" data-tab="trash">回收站</button>
    </div>
    <div class="studio-filters">
      <input id="st-q" type="search" placeholder="关键词（标题/正文）" />
      <label>从 <input id="st-from" type="date" /></label>
      <label>到 <input id="st-to" type="date" /></label>
      <input id="st-model" type="text" placeholder="模型包含…" />
      <button class="btn-ghost" id="st-clear">清空筛选</button>
    </div>
    <div class="studio-bulk" id="st-bulk" style="display:none">
      <span id="st-count"></span>
      <button class="btn-ghost" id="st-archive">归档</button>
      <button class="btn-ghost" id="st-restore">恢复</button>
      <button class="btn-ghost danger" id="st-trash">移入回收站</button>
      <button class="btn-ghost danger" id="st-purge">彻底删除</button>
    </div>
    <div class="studio-list" id="st-list"></div>`

  container.querySelectorAll('.st-tab').forEach(b => {
    b.onclick = () => {
      container.querySelectorAll('.st-tab').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      filter.tab = b.dataset.tab
      selected.clear()
      render()
    }
  })
  const bind = (id, key) => { const el = container.querySelector(id); el.oninput = () => { filter[key] = el.value.trim(); render() } }
  bind('#st-q', 'q'); bind('#st-from', 'from'); bind('#st-to', 'to'); bind('#st-model', 'model')
  container.querySelector('#st-clear').onclick = () => {
    filter = { q: '', from: '', to: '', model: '', tab: filter.tab }
    container.querySelector('#st-q').value = ''
    container.querySelector('#st-from').value = ''
    container.querySelector('#st-to').value = ''
    container.querySelector('#st-model').value = ''
    render()
  }
  container.querySelector('#st-export').onclick = exportSelectedMarkdown
  container.querySelector('#st-export-pdf').onclick = exportSelectedPdf
  container.querySelector('#st-export-all').onclick = exportAllJson
  container.querySelector('#st-archive').onclick = () => bulkSet({ archived: true, deletedAt: null })
  container.querySelector('#st-restore').onclick = () => bulkSet({ archived: false, deletedAt: null })
  container.querySelector('#st-trash').onclick = () => bulkSet({ deletedAt: Date.now() })
  container.querySelector('#st-purge').onclick = e => {
    if (!selected.size) return
    confirmPopover(e.target, `彻底删除 ${selected.size} 个会话？不可恢复`, async () => {
      for (const id of selected) await db.delete('conversations', id)
      toast('已彻底删除', { type: 'success' })
      selected.clear(); await load()
    })
  }

  await load()
}

async function load() {
  try { all = await db.getAll('conversations') } catch { all = [] }
  render()
}

function inTab(c) {
  if (c.deletedAt) return filter.tab === 'trash'
  if (c.archived) return filter.tab === 'archived'
  return filter.tab === 'active'
}

function fullText(c) {
  let s = c.title || ''
  for (const it of c.items || []) {
    if (it.t === 'user') s += '\n' + it.text
    else if (it.t === 'msg') s += '\n' + extractMsgText(it.sdk)
  }
  return s.toLowerCase()
}

function extractMsgText(sdk) {
  const content = sdk && sdk.message && sdk.message.content
  if (!Array.isArray(content)) return ''
  return content.map(b => {
    if (!b) return ''
    if (b.type === 'text') return b.text || ''
    if (b.type === 'thinking') return b.thinking || ''
    if (b.type === 'tool_use') return `[工具 ${b.name}]`
    return ''
  }).join('\n')
}

function matches(c) {
  if (!inTab(c)) return false
  if (filter.q && !fullText(c).includes(filter.q.toLowerCase())) return false
  if (filter.from && c.updatedAt < new Date(filter.from).getTime()) return false
  if (filter.to && c.updatedAt > new Date(filter.to).getTime() + 86400000) return false
  if (filter.model) {
    const m = (c.model || '').toLowerCase()
    if (!m.includes(filter.model.toLowerCase())) return false
  }
  return true
}

function render() {
  const list = container.querySelector('#st-list')
  const rows = all.filter(matches).sort((a, b) => b.updatedAt - a.updatedAt)
  list.innerHTML = ''
  if (!rows.length) {
    const empty = h('div', 'studio-empty')
    empty.innerHTML = `<p>没有匹配的会话</p><button class="btn-primary" id="st-go-chat">去对话开始第一条</button>`
    empty.querySelector('#st-go-chat').onclick = () => window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'chat' }))
    list.appendChild(empty)
    updateBulk()
    return
  }
  for (const c of rows) {
    const row = h('div', 'studio-row')
    if (selected.has(c.id)) row.classList.add('sel')
    const msgCount = (c.items || []).length
    const brCount = (c.branches || []).length
    const cpCount = (c.checkpoints || []).length
    row.innerHTML = `
      <input type="checkbox" class="st-cb" ${selected.has(c.id) ? 'checked' : ''} />
      <div class="sr-main">
        <div class="sr-title"></div>
        <div class="sr-meta"></div>
      </div>
      <button class="sr-branch" title="查看分支树">分支</button>
      <button class="sr-export" title="导出此会话">↧</button>`
    row.querySelector('.sr-title').textContent = c.title || '未命名'
    row.querySelector('.sr-meta').textContent = `${new Date(c.updatedAt).toLocaleString()} · ${msgCount} 条${brCount ? ` · ${brCount} 分支` : ''}${cpCount ? ` · ${cpCount} 检查点` : ''}${c.model ? ' · ' + c.model : ''}`
    const cb = row.querySelector('.st-cb')
    cb.onchange = () => { cb.checked ? selected.add(c.id) : selected.delete(c.id); row.classList.toggle('sel', cb.checked); updateBulk() }
    row.querySelector('.sr-export').onclick = e => { e.stopPropagation(); downloadMarkdown([c]) }
    row.querySelector('.sr-branch').onclick = e => { e.stopPropagation(); showBranchModal(c) }
    row.onclick = e => {
      if (e.target.closest('.st-cb') || e.target.closest('.sr-export') || e.target.closest('.sr-branch')) return
      import('./chat.js').then(m => {
        m.openConversation(c)
        window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'chat' }))
      })
    }
    list.appendChild(row)
  }
  updateBulk()
}

function showBranchModal(convo) {
  const back = h('div', 'modal-back')
  back.innerHTML = `
    <div class="modal branch-modal">
      <h2>分支树 · ${(convo.title || '未命名').slice(0, 40)}</h2>
      <div class="bm-svg" id="bm-svg"></div>
      <div class="bm-tree" id="bm-tree"></div>
      <div class="wl-actions">
        <button class="btn-ghost" id="bm-close">关闭</button>
        <button class="btn-primary" id="bm-open">在对话中打开</button>
      </div>
    </div>`
  document.body.appendChild(back)
  back.querySelector('#bm-svg').innerHTML = renderBranchSvg(convo)
  renderBranchTree(back.querySelector('#bm-tree'), { getConvo: () => convo })
  const close = () => { back.remove(); unregister() }
  const unregister = registerOverlay(back, close)
  back.querySelector('#bm-close').onclick = close
  back.onclick = e => { if (e.target === back) close() }
  back.querySelector('#bm-open').onclick = () => {
    close()
    import('./chat.js').then(m => {
      m.openConversation(convo)
      window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'chat' }))
    })
  }
}

function updateBulk() {
  const bulk = container.querySelector('#st-bulk')
  if (!bulk) return
  bulk.style.display = selected.size ? 'flex' : 'none'
  const cnt = container.querySelector('#st-count')
  if (cnt) cnt.textContent = `已选 ${selected.size} 个`
  // 按当前 tab 调整可用动作
  const inTrash = filter.tab === 'trash'
  container.querySelector('#st-archive').style.display = inTrash ? 'none' : ''
  container.querySelector('#st-trash').style.display = inTrash ? 'none' : ''
  container.querySelector('#st-restore').style.display = filter.tab === 'active' ? 'none' : ''
  container.querySelector('#st-purge').style.display = inTrash ? '' : 'none'
}

async function bulkSet(patch) {
  if (!selected.size) return
  for (const id of selected) {
    const c = all.find(x => x.id === id)
    if (!c) continue
    Object.assign(c, patch)
    await db.put('conversations', c)
  }
  toast('已更新', { type: 'success' })
  selected.clear()
  await load()
}

// ---------- 导出 Markdown ----------
function convoToMarkdown(c) {
  let md = `# ${c.title || '未命名会话'}\n\n`
  md += `> 更新于 ${new Date(c.updatedAt).toLocaleString()}${c.model ? ' · 模型 ' + c.model : ''}\n\n`
  for (const it of c.items || []) {
    if (it.t === 'user') md += `## 用户\n\n${it.text}\n\n`
    else if (it.t === 'msg') {
      const sdk = it.sdk
      const content = sdk && sdk.message && sdk.message.content
      if (!Array.isArray(content)) continue
      if (sdk.type === 'assistant') {
        let body = ''
        for (const b of content) {
          if (!b) continue
          if (b.type === 'text') body += (b.text || '') + '\n\n'
          else if (b.type === 'thinking') body += `<details><summary>思考</summary>\n\n${b.thinking || ''}\n\n</details>\n\n`
          else if (b.type === 'tool_use') body += `\`\`\`\n[工具] ${b.name} ${JSON.stringify(b.input || {})}\n\`\`\`\n\n`
        }
        if (body.trim()) md += `## 助手\n\n${body}`
      }
    }
  }
  return md
}

function downloadMarkdown(convos) {
  if (!convos.length) return
  let md
  let name
  if (convos.length === 1) { md = convoToMarkdown(convos[0]); name = `${(convos[0].title || 'convo').slice(0, 24)}.md` }
  else { md = convos.map(convoToMarkdown).join('\n\n---\n\n'); name = `ccui-export-${convos.length}.md` }
  const blob = new Blob([md], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

function exportSelectedMarkdown() {
  if (!selected.size) { toast('请先勾选会话', { type: 'warn' }); return }
  const convos = all.filter(c => selected.has(c.id))
  downloadMarkdown(convos)
  toast(`已导出 ${convos.length} 个会话`, { type: 'success' })
}

async function exportSelectedPdf() {
  if (!selected.size) { toast('请先勾选会话', { type: 'warn' }); return }
  const convos = all.filter(c => selected.has(c.id))
  const md = convos.map(convoToMarkdown).join('\n\n---\n\n')
  const html = marked.parse(md)
  try {
    const r = await window.ccui.exportPdf(html, `ccui-${convos.length}`)
    if (r.ok) toast(`PDF 已保存：${r.path}`, { type: 'success' })
    else toast('已取消导出', { type: 'info' })
  } catch (e) { toast(`PDF 导出失败：${e.message}`, { type: 'error' }) }
}

async function exportAllJson() {
  const payload = await db.exportAll()
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `ccui-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href)
  toast('已备份全部数据', { type: 'success' })
}
