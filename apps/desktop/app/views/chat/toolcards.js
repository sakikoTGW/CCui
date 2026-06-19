// 工具透明化：工具调用卡片 / 结果回填 / Inspector 时间线 / 权限授权卡片。
import { ICONS } from '../../icons.js'
import { api } from '../../api.js'
import { toast } from '../../ui.js'
import { enqueue, remove } from '../../review-queue.js'
import { toggleAllowedTool } from '../../permissions.js'
import { bus } from '../../bus.js'
import { ctx, h, getReviewState, setReviewState, scrollDown } from './ctx.js'
import { summarizeInput, isEditTool, resultText } from './format.js'
import { renderDiff } from './diff.js'

export function addToolCard(block, live = true) {
  const { id, name, input } = block
  const el = h('div', live ? 'toolcard tc-running' : 'toolcard', `
    <div class="head"><span class="ico">${ICONS.tool}</span><span class="name"></span><span class="arg"></span><span class="spin">${live ? '运行中…' : '—'}</span></div>
    <div class="tbody"></div>`)
  el.querySelector('.name').textContent = name
  el.querySelector('.arg').textContent = summarizeInput(input)
  const body = el.querySelector('.tbody')
  if (isEditTool(name) && input && (input.old_string != null || input.new_string != null)) {
    body.appendChild(renderDiff(input.old_string || '', input.new_string || '', input, name, id, live))
  }
  if (!live) {
    bindHistoricalToolToggle(el)
    if (body.children.length) el.classList.add('tc-collapsed')
  }
  ctx.els.messages.appendChild(el)
  ctx.toolCards.set(id, { card: el, body, name, start: Date.now(), live })
  scrollDown()
}

function bindHistoricalToolToggle(card) {
  card.classList.add('tc-historical')
  const head = card.querySelector('.head')
  if (!head) return
  head.addEventListener('click', () => card.classList.toggle('tc-collapsed'))
}

export function fillToolResult(toolUseId, content, isError, live = true) {
  const entry = ctx.toolCards.get(toolUseId)
  if (!entry) return
  const ms = live ? Date.now() - entry.start : 0
  const spin = entry.card.querySelector('.spin')
  if (spin) {
    spin.textContent = live
      ? (isError ? `失败 · ${ms}ms` : `${ms}ms`)
      : (isError ? '失败' : '完成')
    spin.className = isError ? 'spin err' : 'spin done'
  }
  entry.card.classList.remove('tc-running')
  if (!live) {
    entry.card.classList.add('tc-collapsed')
    if (isError) entry.card.classList.add('tc-failed')
  }
  if (live) addTimeline(entry.name, ms, isError)
  const text = resultText(content).trim()
  if (text && !entry.body.querySelector('.diff-wrap')) {
    const pre = h('pre', 'toolresult')
    pre.textContent = text.length > 1200 ? text.slice(0, 1200) + '\n… (已截断)' : text
    entry.body.appendChild(pre)
  }
  scrollDown()
}

export function addTimeline(name, ms, isError) {
  const tl = document.getElementById('insp-timeline')
  if (!tl) return
  const ph = tl.querySelector('.tl-empty'); if (ph) ph.remove()
  const statusCls = isError ? 'tl-dot err' : 'tl-dot ok'
  const row = h('div', 'row', `<span class="tl-name"><span class="${statusCls}" aria-hidden="true"></span><span class="${isError ? 'err' : ''}">${name}</span></span><span>${ms}ms</span>`)
  tl.appendChild(row)
}

export function addPermCard(id, toolName, message, input) {
  const path = (input && (input.file_path || input.path)) || ''
  const queueId = enqueue({
    id: `perm_${id}`,
    kind: 'permission',
    permId: id,
    toolName,
    message: message || '',
    path,
    oldStr: input?.old_string,
    newStr: input?.new_string,
    input,
  })
  const el = h('div', 'permcard')
  el.dataset.permId = String(id)
  el.innerHTML = `
    <div class="t">需要授权：${toolName}</div><div class="m"></div>
    <div class="btns"><button class="allow">允许一次</button><button class="always">始终允许</button><button class="deny">拒绝</button>
    <button class="open-review" type="button">审查窗</button></div>`
  el.querySelector('.m').textContent = message || path || ''
  const permKey = `perm_${id}`
  const finish = (status, allow) => {
    setReviewState(permKey, status)
    api.respondPermission(id, allow)
    remove(queueId)
    el.remove()
    ctx.hooks.persist()
  }
  el.querySelector('.allow').onclick = () => finish('accepted', true)
  el.querySelector('.always').onclick = async () => {
    try {
      await toggleAllowedTool(toolName, true)
      toast(`已记住：${toolName} 将自动允许`, { type: 'success' })
    } catch (e) { toast(`保存失败：${e.message}`, { type: 'error' }) }
    finish('accepted', true)
  }
  el.querySelector('.deny').onclick = () => finish('rejected', false)
  el.querySelector('.open-review').onclick = () => bus.emit('switch-view', 'review')
  ctx.els.messages.appendChild(el); scrollDown()
}
