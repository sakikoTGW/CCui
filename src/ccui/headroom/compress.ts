import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js'
import { isCcuiSubsystemEnabled, CCUI_SUBSYSTEM } from '../config.js'

const MAX_TOOL_RESULT_CHARS = 12_000
const JSON_ARRAY_PREVIEW = 40

let enabled = false

export function initCcuiHeadroom(): void {
  enabled = true
  logForDebugging('[ccui/headroom] tool-result compression layer ready', {
    level: 'debug',
  })
}

function compressText(content: string): { text: string; saved: number } {
  if (content.length <= MAX_TOOL_RESULT_CHARS) {
    return { text: content, saved: 0 }
  }

  // JSON array: keep schema + sample rows
  const trimmed = content.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const arr = JSON.parse(trimmed) as unknown[]
      if (Array.isArray(arr) && arr.length > JSON_ARRAY_PREVIEW) {
        const preview = arr.slice(0, JSON_ARRAY_PREVIEW)
        const text =
          JSON.stringify(preview, null, 2) +
          `\n\n[ccui/headroom] ${arr.length - JSON_ARRAY_PREVIEW} more items omitted. Ask to expand if needed.`
        return { text, saved: content.length - text.length }
      }
    } catch {
      // fall through
    }
  }

  // Logs / long text: head + tail, keep ERROR/FATAL lines in middle scan
  const lines = content.split('\n')
  const errorLines = lines.filter(l =>
    /error|fatal|exception|traceback|failed/i.test(l),
  )
  const head = lines.slice(0, 80).join('\n')
  const tail = lines.slice(-40).join('\n')
  const mid =
    errorLines.length > 0
      ? `\n\n--- errors (headroom) ---\n${errorLines.slice(0, 30).join('\n')}\n`
      : ''
  const text =
    head +
    mid +
    `\n\n[ccui/headroom] ... ${lines.length - 120} lines omitted ...\n\n` +
    tail
  const capped = text.slice(0, MAX_TOOL_RESULT_CHARS)
  return { text: capped, saved: content.length - capped.length }
}

function compressMessageContent(content: unknown): {
  content: unknown
  saved: number
} {
  if (typeof content === 'string') {
    const r = compressText(content)
    return { content: r.text, saved: r.saved }
  }
  if (!Array.isArray(content)) return { content, saved: 0 }

  let saved = 0
  const next = content.map(block => {
    if (
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      (block as { type: string }).type === 'tool_result' &&
      'content' in block
    ) {
      const tr = block as { type: 'tool_result'; content: unknown }
      if (typeof tr.content === 'string') {
        const r = compressText(tr.content)
        saved += r.saved
        return { ...tr, content: r.text }
      }
    }
    return block
  })
  return { content: next, saved }
}

/**
 * L3 上下文预算层：在 microcompact 之后、API 之前压缩超大 tool_result。
 * 本地启发式；若已装 headroom CLI 可后续接 proxy，此处不阻塞启动。
 */
export function applyCcuiHeadroom(messages: Message[]): {
  messages: Message[]
  bytesSaved: number
} {
  if (!enabled || !isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.headroom)) {
    return { messages, bytesSaved: 0 }
  }

  let bytesSaved = 0
  const out = messages.map(m => {
    if (m.type !== 'user') return m
    const { content, saved } = compressMessageContent(
      (m as { message?: { content?: unknown } }).message?.content ??
        (m as { content?: unknown }).content,
    )
    bytesSaved += saved
    if (saved === 0) return m
    if ('message' in m && m.message) {
      return { ...m, message: { ...m.message, content } }
    }
    return { ...m, content }
  }) as Message[]

  if (bytesSaved > 0) {
    logForDebugging(
      `[ccui/headroom] saved ~${roughTokenCountEstimation(String(bytesSaved))} tok from tool results`,
      { level: 'debug' },
    )
  }
  return { messages: out, bytesSaved }
}
