// chat 控制器的共享可变状态 + 跨模块晚绑定回调。
//
// 为什么需要它：chat 是全应用的流式渲染热路径，原本 1283 行挤在一个文件里。拆成
// 子模块（markdown/format/diff/toolcards/stream/branches）后，这些模块都要读写"当前
// 会话 / DOM 引用 / 工具卡表 / 流式气泡"——必须是同一份引用，否则状态分裂。所以把
// 这些可变状态收在唯一的 ctx 上，所有模块共享。
//
// hooks 放 chat.js 里定义、子模块需要回调的函数（persist / renderItems / ...）。在
// mountChat 时一次性 wire，子模块运行时经 ctx.hooks.* 调用，绕开 ESM 循环依赖。
export const ctx = {
  /** @type {{ messages: HTMLElement, input: HTMLTextAreaElement, send: HTMLElement, historyList: HTMLElement, presetPickerHost: HTMLElement }|null} */
  els: null,
  /** @type {Map<string, { card: HTMLElement, body: HTMLElement, name: string, start: number, live: boolean }>} */
  toolCards: new Map(),
  /** @type {{ id: string, title: string, items: any[], [k: string]: any }|null} 当前会话 */
  convo: null,
  /** @type {{ el: HTMLElement, body: HTMLElement, text: string }|null} 流式临时气泡 */
  streamBubble: null,
  /** @type {any} 续写跟踪器 */
  continuationTracker: null,
  /** 批量渲染时抑制滚动 */
  bulkRendering: false,
  /** @type {any} intent rail 实例 */
  intentRail: null,
  /** chat.js 在 mountChat 时注入的跨模块回调 */
  hooks: {
    persist: () => {},
    sendUserText: () => {},
    renderItems: () => {},
    syncEngineContext: () => {},
    refreshIntentRail: () => {},
  },
}

export function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

export function getReviewState(key) {
  return ctx.convo?.reviewState?.[key] || null
}

export function setReviewState(key, status) {
  if (!ctx.convo) return
  if (!ctx.convo.reviewState) ctx.convo.reviewState = {}
  ctx.convo.reviewState[key] = status
}

export function clearEmpty() {
  const e = ctx.els?.messages.querySelector('#empty')
  if (e) e.remove()
}

export function scrollDown(force = false) {
  if (ctx.bulkRendering && !force) return
  if (ctx.els) ctx.els.messages.scrollTop = ctx.els.messages.scrollHeight
}

export function lastUserText() {
  const items = ctx.convo?.items || []
  for (let i = items.length - 1; i >= 0; i--) if (items[i].t === 'user') return items[i].text
  return ''
}
