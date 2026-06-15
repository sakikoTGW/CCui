// Composer context — 发送框上的「这次要做」+ 待处理（防 solo 时丢方向）
import { pendingCount } from './review-queue.js'

/**
 * @param {object|null} convo
 * @param {object|null} brief
 * @param {{ busy?: boolean; comparePending?: boolean }} storeSlice
 */
export function computeIntent(convo, _brief, storeSlice = {}) {
  let north = convo?.intentNorth?.trim() || ''

  const debts = []
  if (convo?.compareGroupId && !convo.compareResolved) {
    debts.push({ id: 'cmp', label: '对比：还没选主路', action: 'compare' })
  }
  const rq = pendingCount()
  if (rq > 0) debts.push({ id: 'review', label: `${rq} 项待确认`, action: 'review' })

  let mode = 'idle'
  if (storeSlice.busy) mode = 'run'
  else if (convo?.compareGroupId) mode = 'compare'
  else if (north) mode = 'execute'
  else if ((convo?.items?.length || 0) > 0) mode = 'explore'

  return { north, mode, debts }
}

function shouldShowContext(snap) {
  return !!(snap.north || snap.debts.length)
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   getConvo: () => object|null,
 *   getStore: () => object,
 *   onDebtAction: (action: string) => void,
 *   onNorthEdit: (text: string) => void,
 * }} opts
 */
export function mountIntentRail(host, opts) {
  if (!host) return { refresh: () => {} }

  host.className = 'composer-context-host'
  host.innerHTML = `
    <div class="composer-context" hidden>
      <div class="cc-inner">
        <span class="cc-dot" aria-hidden="true"></span>
        <button type="button" class="cc-goal" title="点击编辑这次要做到哪"></button>
        <button type="button" class="cc-pending" hidden title="点击查看待处理项"></button>
      </div>
      <div class="cc-pending-panel" hidden></div>
    </div>`

  const root = host.querySelector('.composer-context')
  const pendingBtn = host.querySelector('.cc-pending')
  const pendingPanel = host.querySelector('.cc-pending-panel')
  const dot = host.querySelector('.cc-dot')
  let editing = false
  let goalClick = null

  function goalBtn() {
    return host.querySelector('.cc-goal')
  }

  function refresh() {
    const snap = computeIntent(opts.getConvo(), null, opts.getStore())
    const show = shouldShowContext(snap)
    root.hidden = !show
    if (!show) return snap

    root.dataset.mode = snap.mode
    dot.className = `cc-dot cc-dot-${snap.mode}`

    const gb = goalBtn()
    if (gb && !editing) {
      if (snap.north) {
        gb.textContent = `这次要做：${snap.north}`
        gb.classList.remove('cc-goal-empty')
      } else {
        gb.textContent = '点此写这次要做到哪'
        gb.classList.add('cc-goal-empty')
      }
      if (snap.mode === 'compare' && opts.getConvo()?.lane) {
        gb.textContent = `对比中 · Lane ${opts.getConvo().lane} · ${snap.north || '选主路'}`
      }
    }

    if (snap.debts.length) {
      pendingBtn.hidden = false
      pendingBtn.textContent = `待处理 ${snap.debts.length}`
      pendingPanel.innerHTML = snap.debts.map(d =>
        `<button type="button" class="cc-pending-row" data-action="${d.action || ''}">${esc(d.label)}</button>`,
      ).join('')
      root.classList.add('cc-has-pending')
    } else {
      pendingBtn.hidden = true
      pendingPanel.hidden = true
      root.classList.remove('cc-has-pending')
    }

    return snap
  }

  goalClick = () => {
    if (editing) return
    const curBtn = goalBtn()
    if (!curBtn) return
    editing = true
    const cur = opts.getConvo()?.intentNorth || ''
    const inp = document.createElement('input')
    inp.className = 'cc-goal-input'
    inp.value = cur || (curBtn.textContent.startsWith('点此') ? '' : curBtn.textContent.replace(/^这次要做：/, '').replace(/^对比中 · Lane \S+ · /, ''))
    inp.placeholder = '这次要做到哪（一句）'
    curBtn.replaceWith(inp)
    inp.focus()
    const commit = () => {
      opts.onNorthEdit(inp.value.trim())
      editing = false
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'cc-goal'
      btn.title = '点击编辑这次要做到哪'
      btn.onclick = goalClick
      inp.replaceWith(btn)
      refresh()
    }
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); commit() }
      if (e.key === 'Escape') {
        editing = false
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'cc-goal'
        btn.title = '点击编辑这次要做到哪'
        btn.onclick = goalClick
        inp.replaceWith(btn)
        refresh()
      }
    }
    inp.onblur = () => { if (editing) commit() }
  }
  goalBtn()?.addEventListener('click', goalClick)

  pendingBtn.onclick = () => { pendingPanel.hidden = !pendingPanel.hidden }
  pendingPanel.onclick = e => {
    const row = e.target.closest('.cc-pending-row')
    if (!row) return
    pendingPanel.hidden = true
    opts.onDebtAction(row.dataset.action || '')
  }

  document.addEventListener('click', e => {
    if (!host.contains(e.target)) pendingPanel.hidden = true
  })

  refresh()
  return { refresh, focusGoalEdit: () => { root.hidden = false; goalClick() } }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
}
