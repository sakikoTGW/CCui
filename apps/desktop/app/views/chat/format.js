// 纯格式化工具：工具入参摘要 / 工具类型判定 / 工具结果取文本 / 用户消息显示文本。
// 无副作用、无状态，便于单测。
import { briefSummary, stripBriefMarker } from '../../brief/schema.js'

const PARAM_KEYS = ['file_path', 'path', 'pattern', 'command', 'query', 'url', 'prompt']

export function summarizeInput(input) {
  if (!input || typeof input !== 'object') return ''
  for (const k of PARAM_KEYS) if (input[k] != null) return String(input[k])
  const keys = Object.keys(input)
  return keys.length ? `${keys[0]}: ${JSON.stringify(input[keys[0]]).slice(0, 60)}` : ''
}

export const isEditTool = n => /edit|write|notebook/i.test(n)

export function resultText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(b => (typeof b === 'string' ? b : b && b.text ? b.text : '')).join('')
  return ''
}

export function userDisplayText(text, brief) {
  const parts = text.split('\n---\nSupplement:')
  if (parts.length > 1) {
    const sup = parts.pop()?.trim()
    if (sup) return sup
  }
  return briefSummary(brief) || stripBriefMarker(text).slice(0, 200)
}
