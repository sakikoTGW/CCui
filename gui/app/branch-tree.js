// 对话分支树 — 粉色龙「侧边分支树」+ Studio 只读视图
/** @typedef {{ id: string; kind: string; label: string; sub?: string; branchId?: string; checkpointId?: string; active?: boolean; depth: number }} TreeRow */

/**
 * @param {object} convo
 * @returns {TreeRow[]}
 */
export function buildBranchRows(convo) {
  if (!convo) return []
  const rows = []
  const items = convo.items || []
  rows.push({ id: 'root', kind: 'root', label: '当前主线', sub: `${items.length} 条记录`, active: true, depth: 0 })

  let userN = 0
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.t === 'user') {
      userN++
      const isDisc = it.brief?.discovery?.active
      rows.push({
        id: `u-${i}`,
        kind: isDisc ? 'discovery' : 'user',
        label: isDisc ? `#${userN} 探询` : `#${userN} 你`,
        sub: (it.brief?.discovery?.seed || it.text || '').slice(0, 36),
        depth: 1,
        itemIdx: i,
      })
    } else if (it.t === 'msg' && it.sdk?.type === 'assistant') {
      const txt = extractAssistant(it.sdk)
      rows.push({
        id: `a-${i}`,
        kind: 'assistant',
        label: 'CCui',
        sub: txt.slice(0, 36),
        depth: 1,
        itemIdx: i,
      })
    }
  }

  const cps = convo.checkpoints || []
  if (cps.length) {
    rows.push({ id: 'cp-head', kind: 'section', label: '检查点', sub: `${cps.length}`, depth: 0 })
    cps.slice().reverse().slice(0, 12).forEach((cp, i) => {
      rows.push({
        id: cp.id,
        kind: 'checkpoint',
        label: new Date(cp.at).toLocaleTimeString(),
        sub: cp.label || `快照 ${(cp.items || []).length} 条`,
        checkpointId: cp.id,
        depth: 1,
      })
    })
  }

  const branches = convo.branches || []
  if (branches.length) {
    rows.push({ id: 'br-head', kind: 'section', label: '分支快照', sub: `${branches.length}`, depth: 0 })
    branches.forEach((b, i) => {
      const fork = b.forkAt != null ? `@#${b.forkAt + 1}` : ''
      const isDisc = b.kind === 'discovery'
      rows.push({
        id: b.id,
        kind: isDisc ? 'discovery' : 'branch',
        label: `#${i + 1} ${b.label}`,
        sub: `${(b.items || []).length} 条 ${fork}${isDisc ? ' · 探询快照' : ''}`,
        branchId: b.id,
        depth: 1,
      })
    })
  }

  if (convo.compareGroupId) {
    rows.push({
      id: 'cmp',
      kind: 'compare',
      label: `Compare · Lane ${convo.lane || '?'}`,
      sub: convo.compareGroupId,
      depth: 0,
    })
  }

  return rows
}

function extractAssistant(sdk) {
  const content = sdk?.message?.content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b?.type === 'text').map(b => b.text || '').join(' ').trim()
}

/**
 * @param {HTMLElement} host
 * @param {{ getConvo: () => object|null, onSwitchBranch?: (id: string) => void, onRollback?: (id: string) => void }} opts
 */
export function renderBranchTree(host, opts) {
  const convo = opts.getConvo?.()
  const rows = buildBranchRows(convo)
  host.innerHTML = ''
  if (!convo || (!convo.items?.length && !convo.branches?.length && !convo.checkpoints?.length)) {
    host.appendChild(el('div', 'bt-empty', '发送消息后，主线、检查点与编辑分叉会显示在这里。'))
    return
  }
  const ul = el('ul', 'bt-list')
  for (const r of rows) {
    const li = el('li', `bt-node bt-${r.kind}${r.active ? ' bt-active' : ''}`)
    li.style.paddingLeft = `${8 + r.depth * 14}px`
    li.innerHTML = `<span class="bt-label">${esc(r.label)}</span><span class="bt-sub">${esc(r.sub || '')}</span>`
    if (r.branchId && opts.onSwitchBranch) {
      li.classList.add('bt-click')
      li.title = '切到此分支'
      li.onclick = () => opts.onSwitchBranch(r.branchId)
    } else if (r.checkpointId && opts.onRollback) {
      li.classList.add('bt-click')
      li.title = '回滚到此检查点'
      li.onclick = () => opts.onRollback(r.checkpointId)
    }
    ul.appendChild(li)
  }
  host.appendChild(ul)
}

/** 简易 SVG 拓扑（Studio 大图） */
export function renderBranchSvg(convo, width = 520, height = 320) {
  const rows = buildBranchRows(convo).filter(r => r.kind !== 'section')
  const svg = [`<svg viewBox="0 0 ${width} ${height}" class="bt-svg" xmlns="http://www.w3.org/2000/svg">`]
  const colX = [40, 180, 340]
  let y = 28
  const trunk = rows.filter(r => r.kind === 'root' || r.kind === 'user' || r.kind === 'assistant')
  for (const r of trunk) {
    const color = r.kind === 'user' ? '#5b8a72' : r.kind === 'assistant' ? '#d97757' : '#999'
    svg.push(`<circle cx="${colX[0]}" cy="${y}" r="6" fill="${color}"/>`)
    svg.push(`<text x="${colX[0] + 14}" y="${y + 4}" class="bt-svg-t">${esc(r.label)}</text>`)
    if (y > 28) svg.push(`<line x1="${colX[0]}" y1="${y - 18}" x2="${colX[0]}" y2="${y - 6}" stroke="#ccc" stroke-width="1.5"/>`)
    y += 26
  }
  let by = 28
  for (const r of rows.filter(x => x.kind === 'branch')) {
    svg.push(`<line x1="${colX[0]}" y1="${40}" x2="${colX[1]}" y2="${by}" stroke="#d97757" stroke-width="1" stroke-dasharray="4 3"/>`)
    svg.push(`<rect x="${colX[1] - 8}" y="${by - 10}" width="140" height="20" rx="6" fill="var(--accent-weak, #f6e6df)"/>`)
    svg.push(`<text x="${colX[1]}" y="${by + 4}" class="bt-svg-t">${esc(r.label)}</text>`)
    by += 28
  }
  svg.push('</svg>')
  return svg.join('')
}

function el(tag, cls, html) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (html != null) n.textContent = html
  return n
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}
