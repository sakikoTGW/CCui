import type { DaemonMessage, RespOk } from '@ccui/protocol'
import { reportError } from '../shell/diag'

/**
 * Typed daemon client. Single seam between the React renderer and the daemon.
 * - request/response correlation by reqId
 * - rejects with a real Error carrying the CcuiError code (never swallows)
 * - fan-out of unsolicited daemon messages to subscribers
 *
 * Replaces the untyped app/api.js. Daemon already validates inbound commands
 * (P2), so here we trust the discriminated `kind` and narrow at the call site.
 */

export class DaemonError extends Error {
  code: string
  detail?: unknown
  constructor(code: string, message: string, detail?: unknown) {
    super(message)
    this.name = 'DaemonError'
    this.code = code
    this.detail = detail
  }
}

type Subscriber = (msg: DaemonMessage) => void

interface Pending {
  resolve: (msg: RespOk) => void
  reject: (err: DaemonError) => void
  timer: ReturnType<typeof setTimeout>
}

const subscribers = new Set<Subscriber>()
const pending = new Map<string, Pending>()
let seq = 0
let started = false
let lastActivity = Date.now()

function ensureStarted(): void {
  if (started) return
  started = true
  window.ccui.onDaemon((msg) => {
    lastActivity = Date.now()
    if (msg.kind === 'resp' && 'reqId' in msg && msg.reqId && pending.has(msg.reqId)) {
      const p = pending.get(msg.reqId)!
      clearTimeout(p.timer)
      pending.delete(msg.reqId)
      if (msg.ok) p.resolve(msg)
      else p.reject(new DaemonError(msg.error.code, msg.error.message, msg.error.detail))
      return
    }
    for (const fn of subscribers) {
      try {
        fn(msg)
      } catch (e) {
        reportError({ scope: 'root', message: `daemon subscriber threw: ${String(e)}` })
      }
    }
  })
}

export interface DaemonClient {
  onMessage(fn: Subscriber): () => void
  request<T = Record<string, unknown>>(
    cmd: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<RespOk<T>>
  send(text: string, opts?: Parameters<Window['ccui']['send']>[1]): void
  interrupt(sessionId?: string): void
  reset(sessionId?: string): void
  respondPermission(id: string, allow: boolean, updatedInput?: unknown): void
  lastActivityAt(): number
}

export const daemon: DaemonClient = {
  onMessage(fn) {
    ensureStarted()
    subscribers.add(fn)
    return () => subscribers.delete(fn)
  },
  request<T = Record<string, unknown>>(cmd: Record<string, unknown>, timeoutMs = 15000) {
    ensureStarted()
    const reqId = `r${++seq}_${Date.now().toString(36)}`
    return new Promise<RespOk<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId)
        reject(new DaemonError('TIMEOUT', `daemon 请求超时: ${String(cmd.cmd ?? '')}`))
      }, timeoutMs)
      pending.set(reqId, {
        resolve: resolve as Pending['resolve'],
        reject,
        timer,
      })
      window.ccui.request({ ...cmd, reqId })
    })
  },
  send(text, opts) {
    lastActivity = Date.now()
    window.ccui.send(text, { sessionId: 'main', ...opts })
  },
  interrupt(sessionId) {
    window.ccui.interrupt(sessionId)
  },
  reset(sessionId) {
    window.ccui.reset(sessionId)
  },
  respondPermission(id, allow, updatedInput) {
    window.ccui.respondPermission(id, allow, updatedInput)
  },
  lastActivityAt() {
    return lastActivity
  },
}

/** Map raw daemon/API error text to a human Chinese hint. Ported from app/api.js. */
export function humanizeError(raw: unknown): string {
  const s = String((raw as { message?: string } | null)?.message ?? raw ?? '')
  if (/401|unauthor|api[_ ]?key/i.test(s)) return 'API Key 无效或缺失，请到设置检查。'
  if (/429|rate.?limit/i.test(s)) return '请求过于频繁（限流），稍后再试。'
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(s)) return '网络超时，请检查网络或稍后重试。'
  if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(s)) return '无法连接 API 服务地址，请检查网络与 BASE_URL。'
  if (/insufficient|balance|quota/i.test(s)) return '账户额度不足。'
  return s || '发生未知错误。'
}
