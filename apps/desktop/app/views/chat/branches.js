// 分支 + 检查点（快照）：分支条 UI、检查点下拉、回滚/切分支、分支树面板。
import { store } from '../../store.js'
import { toast } from '../../ui.js'
import { uid } from '../../db.js'
import { createCcSelect } from '../../cc-select.js'
import { renderBranchTree } from '../../branch-tree.js'
import { ctx, h, lastUserText } from './ctx.js'

let checkpointSelect = null

export function applyBranchPanelLayout() {
  if (localStorage.getItem('ccui:branch-panel') == null && localStorage.getItem('ccui:branch-sidebar') === '1') {
    localStorage.setItem('ccui:branch-panel', '1')
  }
  const collapsed = localStorage.getItem('ccui:branch-panel') === '1'
  const panel = document.getElementById('srBranchPanel')
  panel?.classList.toggle('collapsed', collapsed)
  const btn = document.getElementById('toggleBranchPanel')
  if (btn) {
    const label = collapsed ? '展开分支树' : '收起分支树'
    btn.title = label
    btn.setAttribute('aria-label', label)
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
  }
}

export function syncBranchPanelLayout() {
  applyBranchPanelLayout()
}

export function refreshBranchTreePanel() {
  const host = document.getElementById('branchTreeHost')
  if (!host) return
  renderBranchTree(host, {
    getConvo: () => ctx.convo,
    onSwitchBranch: id => switchBranch(id),
    onRollback: id => rollbackCheckpoint(id),
  })
}

export function renderBranchBar() {
  const bar = document.getElementById('branchBar')
  if (!bar || !ctx.convo) return
  const branches = ctx.convo.branches || []
  const checkpoints = ctx.convo.checkpoints || []
  const hasItems = ctx.convo.items.length > 0
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

export function addCheckpoint() {
  if (!ctx.convo || !ctx.convo.items.length) return
  ctx.convo.checkpoints = ctx.convo.checkpoints || []
  const label = (lastUserText() || '检查点').slice(0, 16)
  ctx.convo.checkpoints.push({ id: uid('cp'), label, at: Date.now(), items: JSON.parse(JSON.stringify(ctx.convo.items)) })
  if (ctx.convo.checkpoints.length > 30) ctx.convo.checkpoints.shift()
}

export function rollbackCheckpoint(id) {
  if (store.get().busy) { toast('请先停止当前回答', { type: 'error' }); return }
  const cp = (ctx.convo.checkpoints || []).find(x => x.id === id)
  if (!cp) return
  // 回滚前把当前状态存为分支，避免丢失
  snapshotBranch(Math.max(0, ctx.convo.items.length - 1))
  ctx.convo.items = JSON.parse(JSON.stringify(cp.items))
  ctx.hooks.syncEngineContext()
  ctx.hooks.renderItems()
  toast('已回滚到检查点（当前状态已存为分支，引擎上下文已重置）', { type: 'success' })
  ctx.hooks.persist()
}

export function snapshotBranch(idx) {
  if (!ctx.convo.branches) ctx.convo.branches = []
  const orig = ctx.convo.items[idx]
  const label = ((orig && orig.text) || '编辑点').slice(0, 16)
  ctx.convo.branches.push({
    id: uid('b'),
    label,
    forkAt: idx,
    createdAt: Date.now(),
    items: JSON.parse(JSON.stringify(ctx.convo.items)),
  })
  if (ctx.convo.branches.length > 20) ctx.convo.branches.shift()
}

export function switchBranch(id) {
  if (store.get().busy) { toast('请先停止当前回答', { type: 'error' }); return }
  const b = (ctx.convo.branches || []).find(x => x.id === id)
  if (!b) return
  ctx.convo.items = JSON.parse(JSON.stringify(b.items))
  ctx.hooks.syncEngineContext()
  ctx.hooks.renderItems()
  toast('已切回分支（引擎上下文已重置）', { type: 'success' })
  ctx.hooks.persist()
  ctx.hooks.refreshIntentRail()
}
