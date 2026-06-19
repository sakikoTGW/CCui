// 文件 diff 卡片渲染 + 进审查队列 + 内联接受/拒绝。跨模块回调经 ctx.hooks。
import { toast } from '../../ui.js'
import { enqueue, remove } from '../../review-queue.js'
import { ctx, h, getReviewState, setReviewState } from './ctx.js'

export function renderDiff(oldStr, newStr, input, toolName, toolUseId, live = true) {
  const key = toolUseId ? `diff_${toolUseId}` : null
  const resolved = key ? getReviewState(key) : null
  const wrap = h('div', 'diff-wrap')
  if (key) wrap.dataset.reviewId = key
  const diff = h('div', 'diff')
  if (oldStr) for (const line of String(oldStr).split('\n')) { const d = h('div', 'del'); d.textContent = `- ${line}`; diff.appendChild(d) }
  if (newStr) for (const line of String(newStr).split('\n')) { const a = h('div', 'add'); a.textContent = `+ ${line}`; diff.appendChild(a) }
  wrap.appendChild(diff)
  const path = (input && (input.file_path || input.path)) || ''

  if (resolved) wrap.classList.add(resolved === 'accepted' ? 'accepted' : 'rejected')

  if (live && !resolved) {
    const queueId = enqueue({
      id: key || undefined,
      kind: 'diff',
      toolName: toolName || 'Edit',
      path,
      oldStr: oldStr || '',
      newStr: newStr || '',
      input,
    })
    const bar = h('div', 'diff-actions')
    bar.innerHTML = `<button class="diff-accept">接受变更</button><button class="diff-reject">拒绝并请求撤销</button>`
    bar.querySelector('.diff-accept').onclick = () => {
      wrap.classList.add('accepted'); bar.remove()
      if (key) setReviewState(key, 'accepted')
      remove(queueId)
      ctx.hooks.persist()
      toast('已标记为接受', { type: 'success' })
    }
    bar.querySelector('.diff-reject').onclick = () => {
      wrap.classList.add('rejected'); bar.remove()
      if (key) setReviewState(key, 'rejected')
      remove(queueId)
      ctx.hooks.persist()
      ctx.hooks.sendUserText(`请撤销刚才${path ? `对 ${path}` : ''} 的修改（${toolName || 'Edit'}），恢复为变更前的内容。`)
    }
    wrap.appendChild(bar)
  } else if (resolved) {
    const badge = h('div', 'diff-resolved-badge', resolved === 'accepted' ? '已接受' : '已拒绝')
    wrap.appendChild(badge)
  }
  return wrap
}
