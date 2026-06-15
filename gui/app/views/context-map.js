// 项目结构 Graph — 粉色龙 #2/#6（轻量 repomap，Inspired by aider/cursor codebase map）
import { api } from '../api.js'
import { toast } from '../ui.js'

let container = null
let graph = null

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

export async function mountContextMap(c) {
  container = c
  container.innerHTML = `
    <div class="view-head"><h1>项目结构图</h1>
      <div class="vh-actions">
        <button class="btn-ghost" id="cg-refresh">重新扫描</button>
        <button class="btn-ghost" id="cg-send">发给 Agent</button>
        <button class="btn-primary" id="cg-copy">复制 Markdown</button>
      </div>
    </div>
    <p class="cg-hint">扫描目录 + import 边，缓存到 <code>.claude/ccui-project-graph.json</code> 供 Agent 记忆。非语义向量层，M4 再加强。</p>
    <div class="cg-stats" id="cg-stats"></div>
    <div class="cg-canvas-wrap"><div class="cg-canvas" id="cg-canvas"></div></div>
    <details class="cg-md"><summary>Markdown 摘要</summary><pre id="cg-md"></pre></details>`

  container.querySelector('#cg-refresh').onclick = () => load(true)
  container.querySelector('#cg-copy').onclick = () => {
    if (!graph?.summary) return
    navigator.clipboard.writeText(graph.summary).then(
      () => toast('已复制结构摘要', { type: 'success' }),
      () => toast('复制失败', { type: 'error' }),
    )
  }
  container.querySelector('#cg-send').onclick = () => {
    if (!graph?.summary) return
    window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'chat' }))
    window.dispatchEvent(new CustomEvent('ccui:insert-prompt', {
      detail: `请先阅读以下项目结构图，再回答我后续问题：\n\n${graph.summary}\n\n---\n\n`,
    }))
    toast('已切到对话并插入结构摘要', { type: 'info' })
  }

  await load(false)
}

async function load(refresh) {
  const canvas = container.querySelector('#cg-canvas')
  const stats = container.querySelector('#cg-stats')
  canvas.innerHTML = '<div class="cg-loading">扫描项目中…</div>'
  stats.textContent = ''
  try {
    const res = await api.request({ cmd: 'projectGraph', refresh: !!refresh }, 120000)
    graph = res.graph
    if (!graph) throw new Error('扫描失败')
    stats.textContent = `${graph.stats.files} 文件 · ${graph.stats.dirs} 目录 · ${graph.stats.importEdges} import 边 · ${new Date(graph.scannedAt).toLocaleString()}`
    container.querySelector('#cg-md').textContent = graph.summary
    renderGraph(canvas, graph)
    toast(refresh ? '结构图已更新' : '已加载结构图', { type: 'success' })
  } catch (e) {
    canvas.innerHTML = `<div class="cg-error">加载失败：${e.message}</div>`
  }
}

function areaForPath(path, areas) {
  const norm = path.replace(/\\/g, '/')
  for (const a of areas) {
    if (a.label === 'root') continue
    const seg = `/${a.label}/`
    if (norm.includes(seg) || norm.startsWith(`${a.label}/`)) return a.label
  }
  return 'root'
}

function renderGraph(host, g) {
  const areas = g.nodes.filter(n => n.kind === 'area')
  const files = g.nodes.filter(n => n.kind === 'file')
  const importEdges = g.edges.filter(e => e.kind === 'imports')

  const PAD = 24
  const ROW_H = 48
  const ROW_Y0 = 36
  const FILE_SPACING = 56
  const FILE_X0 = 140
  const MAX_FILES_PER_AREA = 14
  const MAX_EDGES = 48

  const W = Math.max(720, host.clientWidth || 720)
  const H = Math.max(300, ROW_Y0 + areas.length * ROW_H + 48)

  /** @type {Map<string, { x: number, y: number, kind: string, node?: typeof files[0] }>} */
  const pos = new Map()
  const areaY = new Map()

  areas.forEach((a, i) => {
    const y = ROW_Y0 + i * ROW_H
    areaY.set(a.id, y)
    pos.set(a.id, { x: PAD + 8, y, kind: 'area' })
  })

  const byArea = new Map(areas.map(a => [a.label, /** @type {typeof files} */ ([])]))
  for (const f of files) {
    const label = areaForPath(f.path, areas)
    if (!byArea.has(label)) byArea.set(label, [])
    byArea.get(label).push(f)
  }

  for (const a of areas) {
    const y = areaY.get(a.id)
    if (y == null) continue
    const list = (byArea.get(a.label) || []).slice(0, MAX_FILES_PER_AREA)
    list.forEach((f, j) => {
      pos.set(f.id, { x: FILE_X0 + j * FILE_SPACING, y, kind: 'file', node: f })
    })
  }

  const svg = [`<svg viewBox="0 0 ${W} ${H}" class="cg-svg" xmlns="http://www.w3.org/2000/svg">`]

  const drawn = new Set()
  let edgeCount = 0
  for (const e of importEdges) {
    if (edgeCount >= MAX_EDGES) break
    const p1 = pos.get(e.from)
    const p2 = pos.get(e.to)
    if (!p1 || !p2 || p1.kind !== 'file' || p2.kind !== 'file') continue
    const key = `${e.from}|${e.to}`
    if (drawn.has(key)) continue
    drawn.add(key)
    edgeCount++
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const cx = (p1.x + p2.x) / 2
    const cy = (p1.y + p2.y) / 2 - (Math.abs(dy) < 2 ? 18 : Math.sign(dy) * 8)
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) continue
    svg.push(
      `<path d="M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}" fill="none" stroke="#d97757" stroke-width="1.2" opacity="0.45"/>`,
    )
  }

  areas.forEach((a, i) => {
    const y = ROW_Y0 + i * ROW_H
    const count = Math.min((byArea.get(a.label) || []).length, MAX_FILES_PER_AREA)
    svg.push(
      `<rect x="${PAD}" y="${y - 14}" width="${W - PAD * 2}" height="32" rx="8" fill="var(--accent-weak,#f6e6df)" opacity="0.9"/>`,
    )
    svg.push(`<text x="${PAD + 12}" y="${y + 6}" class="cg-t">${esc(a.label)}</text>`)
    if (count > 0) {
      svg.push(
        `<text x="${W - PAD - 8}" y="${y + 6}" class="cg-t" text-anchor="end" fill="var(--text-3,#888)" font-size="10">${count} files</text>`,
      )
    }
  })

  for (const [, p] of pos) {
    if (p.kind !== 'file' || !p.node) continue
    const short = p.node.label.split('/').pop() || p.node.label
    svg.push(`<circle cx="${p.x}" cy="${p.y}" r="5" fill="#5b8a72" data-id="${escAttr(p.node.id)}"/>`)
    svg.push(`<title>${esc(p.node.label)}</title>`)
    if (FILE_SPACING >= 48) {
      svg.push(
        `<text x="${p.x}" y="${p.y + 16}" class="cg-t" text-anchor="middle" font-size="9" fill="var(--text-3,#888)">${esc(short.slice(0, 10))}</text>`,
      )
    }
  }

  svg.push('</svg>')
  host.innerHTML = svg.join('')

  host.querySelectorAll('circle[data-id]').forEach(c => {
    const id = c.getAttribute('data-id')
    const p = pos.get(id || '')
    if (!p?.node) return
    c.style.cursor = 'pointer'
    c.onclick = () =>
      window.dispatchEvent(new CustomEvent('ccui:openfile', { detail: { path: p.node.path } }))
  })
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
