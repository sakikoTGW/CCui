/**
 * 抓包蒸馏：把一次发给模型的请求体（Anthropic Messages / OpenAI Chat Completions）
 * 蒸馏成 ccui-pack 草稿的 harness / assembly / model 部分（L2 主体）。
 *
 * 纯函数、零引擎依赖 —— 保证可移植、可单测。规范见 docs/PACK_SPEC.md。
 */

export type WireFormat = 'anthropic' | 'openai'

export type ToolSchema = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type CcuiPackDraft = {
  schema: 'ccui-pack/v0.1'
  name: string
  version: string
  harness: {
    base_system_prompt: string
    tool_schemas: ToolSchema[]
    system_reminders: string[]
  }
  assembly: {
    wire_format: WireFormat
    system_is_array: boolean
    cache_breakpoints: number
    file_wrapper: string | null
    message_count: number
    order_hint: string[]
  }
  model: {
    name: string
    params: {
      max_tokens: number | null
      temperature: number | null
      top_p: number | null
      top_k: number | null
      stop_sequences: string[]
    }
  }
  meta: {
    capturedAt: string
    source: 'wire'
    capturedFrom: string | null
    sameModel: boolean | null
    fidelity: 'L2'
  }
}

type AnyRecord = Record<string, unknown>

function asRecord(v: unknown): AnyRecord | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : null
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Anthropic system 可能是 string 或 [{type:'text', text, cache_control?}] */
function extractAnthropicSystem(system: unknown): {
  text: string
  isArray: boolean
  cacheBreakpoints: number
} {
  if (typeof system === 'string') {
    return { text: system, isArray: false, cacheBreakpoints: 0 }
  }
  const arr = asArray(system)
  let text = ''
  let cacheBreakpoints = 0
  for (const block of arr) {
    const b = asRecord(block)
    if (!b) continue
    text += `${asString(b.text)}\n`
    if (b.cache_control) cacheBreakpoints++
  }
  return { text: text.trimEnd(), isArray: arr.length > 0, cacheBreakpoints }
}

/** OpenAI: system 散落在 messages[role=system] */
function extractOpenAiSystem(messages: unknown[]): string {
  const parts: string[] = []
  for (const m of messages) {
    const r = asRecord(m)
    if (!r || r.role !== 'system') continue
    if (typeof r.content === 'string') parts.push(r.content)
    else {
      for (const c of asArray(r.content)) {
        const cr = asRecord(c)
        if (cr && typeof cr.text === 'string') parts.push(cr.text)
      }
    }
  }
  return parts.join('\n')
}

function normalizeAnthropicTools(tools: unknown[]): ToolSchema[] {
  return tools
    .map(t => asRecord(t))
    .filter((t): t is AnyRecord => !!t)
    .map(t => ({
      name: asString(t.name),
      description: asString(t.description),
      input_schema: asRecord(t.input_schema) ?? {},
    }))
    .filter(t => t.name)
}

function normalizeOpenAiTools(tools: unknown[]): ToolSchema[] {
  return tools
    .map(t => asRecord(t))
    .filter((t): t is AnyRecord => !!t)
    .map(t => {
      const fn = asRecord(t.function) ?? t
      return {
        name: asString(fn.name),
        description: asString(fn.description),
        input_schema: asRecord(fn.parameters) ?? {},
      }
    })
    .filter(t => t.name)
}

/** 从所有文本里嗅出注入的 system-reminder 块（启发式，可证伪：限定明确句式） */
function sniffSystemReminders(haystacks: string[]): string[] {
  const out = new Set<string>()
  const re = /<system[_-]reminder>([\s\S]*?)<\/system[_-]reminder>/gi
  for (const h of haystacks) {
    let m: RegExpExecArray | null
    while ((m = re.exec(h))) {
      const body = m[1].trim()
      if (body) out.add(body)
    }
  }
  return [...out]
}

/** 嗅文件包裹标签，如 <file path="...">、<document>、```path */
function sniffFileWrapper(messagesText: string): string | null {
  const candidates = [
    /<file\b[^>]*>/i,
    /<document\b[^>]*>/i,
    /<attachment\b[^>]*>/i,
    /<code_block\b[^>]*>/i,
  ]
  for (const re of candidates) {
    const m = re.exec(messagesText)
    if (m) return m[0]
  }
  return null
}

function collectMessageText(messages: unknown[]): string {
  const parts: string[] = []
  for (const m of messages) {
    const r = asRecord(m)
    if (!r) continue
    if (typeof r.content === 'string') parts.push(r.content)
    else {
      for (const c of asArray(r.content)) {
        const cr = asRecord(c)
        if (cr && typeof cr.text === 'string') parts.push(cr.text)
      }
    }
  }
  return parts.join('\n')
}

export function detectWireFormat(body: AnyRecord, path: string): WireFormat {
  if ('system' in body || /\/v1\/messages/.test(path)) return 'anthropic'
  if (/chat\/completions/.test(path)) return 'openai'
  // 兜底：有顶层 system 视为 anthropic，否则 openai
  return 'system' in body ? 'anthropic' : 'openai'
}

export function distillRequest(
  rawBody: string,
  opts: { path?: string; capturedFrom?: string | null } = {},
): CcuiPackDraft | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }
  const body = asRecord(parsed)
  if (!body) return null

  const path = opts.path ?? ''
  const wire = detectWireFormat(body, path)
  const messages = asArray(body.messages)

  let basePrompt: string
  let systemIsArray = false
  let cacheBreakpoints = 0
  let toolSchemas: ToolSchema[]
  let topK: number | null = null

  if (wire === 'anthropic') {
    const sys = extractAnthropicSystem(body.system)
    basePrompt = sys.text
    systemIsArray = sys.isArray
    cacheBreakpoints = sys.cacheBreakpoints
    toolSchemas = normalizeAnthropicTools(asArray(body.tools))
    topK = typeof body.top_k === 'number' ? body.top_k : null
  } else {
    basePrompt = extractOpenAiSystem(messages)
    toolSchemas = normalizeOpenAiTools(asArray(body.tools))
  }

  const messagesText = collectMessageText(messages)
  const reminders = sniffSystemReminders([basePrompt, messagesText])
  const fileWrapper = sniffFileWrapper(messagesText)

  const stopSeqRaw = asArray(body.stop_sequences ?? body.stop)
  const stopSequences = stopSeqRaw.filter((s): s is string => typeof s === 'string')

  return {
    schema: 'ccui-pack/v0.1',
    name: `captured-${wire}`,
    version: '0.0.0',
    harness: {
      base_system_prompt: basePrompt,
      tool_schemas: toolSchemas,
      system_reminders: reminders,
    },
    assembly: {
      wire_format: wire,
      system_is_array: systemIsArray,
      cache_breakpoints: cacheBreakpoints,
      file_wrapper: fileWrapper,
      message_count: messages.length,
      order_hint: ['system', 'history'],
    },
    model: {
      name: asString(body.model) || 'unknown',
      params: {
        max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
        temperature: typeof body.temperature === 'number' ? body.temperature : null,
        top_p: typeof body.top_p === 'number' ? body.top_p : null,
        top_k: topK,
        stop_sequences: stopSequences,
      },
    },
    meta: {
      capturedAt: new Date().toISOString(),
      source: 'wire',
      capturedFrom: opts.capturedFrom ?? null,
      sameModel: null,
      fidelity: 'L2',
    },
  }
}
