// 任务完成信号 + 异常截断续写（对齐引擎 max_output_tokens recovery 语义）

/** 模型主动完成时须单独一行输出 */
export const COMPLETION_SIGNAL = '<<CCUI_TASK_COMPLETE>>'

export const COMPLETION_RULE = `When you have fully finished the user's request (all steps done, no pending work), output exactly ${COMPLETION_SIGNAL} on its own line at the very end. Do not emit this signal until truly complete.`

const MAX_AUTO_CONTINUATIONS = 12

export function hasCompletionSignal(text) {
  if (!text) return false
  return text.includes(COMPLETION_SIGNAL)
}

export function stripCompletionSignal(text) {
  if (!text) return text
  return text.replace(new RegExp(`\\n?${escapeRe(COMPLETION_SIGNAL)}\\s*`, 'g'), '').trimEnd()
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildContinuationPrompt(reason) {
  const why = reason === 'truncated'
    ? '输出因 token 上限被截断'
    : reason === 'watchdog'
      ? '长时间无新输出'
      : '回合异常结束'
  return `[系统续写] ${why}，尚未见到完成信号 ${COMPLETION_SIGNAL}。不要道歉、不要复述已完成部分；从断点直接继续未完成的工作。全部完成后单独一行输出 ${COMPLETION_SIGNAL}。`
}

export function createContinuationTracker() {
  return { left: MAX_AUTO_CONTINUATIONS, userStop: false, awaitingSignal: false }
}

export function canAutoContinue(tracker) {
  return tracker && !tracker.userStop && tracker.left > 0
}

export function consumeContinuation(tracker) {
  if (!tracker || tracker.left <= 0) return false
  tracker.left -= 1
  return true
}

/** 从 convo.items / 流式气泡提取最近 assistant 纯文本 */
export function lastAssistantPlainText(convo, streamBubble) {
  if (streamBubble?.text) return streamBubble.text
  if (!convo?.items) return ''
  for (let i = convo.items.length - 1; i >= 0; i--) {
    const it = convo.items[i]
    if (it.t !== 'msg' || it.sdk?.type !== 'assistant') continue
    const content = it.sdk.message?.content
    if (!Array.isArray(content)) continue
    const parts = content.filter(b => b?.type === 'text').map(b => b.text || '')
    if (parts.length) return parts.join('')
  }
  return ''
}

export function isTruncationError(err) {
  const s = String(err || '').toLowerCase()
  return /max.?output.?token|output token limit|truncat|length limit|token limit/i.test(s)
}
