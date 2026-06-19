// 流式临时气泡：token delta 累积渲染。状态在 ctx.streamBubble（全模块共享）。
import { ctx, h, clearEmpty, scrollDown } from './ctx.js'

export function ensureStreamBubble() {
  if (ctx.streamBubble) return ctx.streamBubble
  clearEmpty()
  const el = h('div', 'msg assistant', '<div class="role">CCui</div><div class="bubble streaming"></div>')
  const body = el.querySelector('.bubble')
  ctx.els.messages.appendChild(el)
  ctx.streamBubble = { el, body, text: '' }
  return ctx.streamBubble
}

export function appendDelta(text) {
  const sb = ensureStreamBubble()
  sb.text += text
  sb.body.textContent = sb.text
  scrollDown()
}

export function clearStreamBubble() {
  if (ctx.streamBubble) { ctx.streamBubble.el.remove(); ctx.streamBubble = null }
}
