/**
 * GUI Core Daemon — Bun 子进程，stdio NDJSON 协议。
 * 命令面与错误信封由 @ccui/protocol 单一真相约束；分发逻辑见 handlers.ts。
 */
import { AgentSession } from './agentSession.js'
import { bootstrapGuiDev } from './bootstrap.js'
import { applyDisabledToEngine, setDisabledResources } from './resourceFilters.js'
import { mergeProjectConfigOnBoot } from './projectConfig.js'
import { Orchestrator } from './orchestrator.js'
import { dispatch, type DaemonCtx } from './handlers.js'
import { parseCommandLine } from '@ccui/protocol'

;(globalThis as Record<string, unknown>).MACRO ??= new Proxy(
  { VERSION: '2.0.0-dev' } as Record<string, unknown>,
  { get: (t, k) => (k in t ? t[k as string] : '') },
)

function out(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

const sessions = new Map<string, AgentSession>()
const mainSession = new AgentSession({ cwd: process.cwd(), autoApprove: false })
sessions.set('main', mainSession)
mainSession.onEvent(event => out({ kind: 'event', sessionId: 'main', event }))

const orchestrator = new Orchestrator(obj => out(obj), sid => getSession(sid))

function getSession(id?: string): AgentSession {
  const sid = id || 'main'
  if (!sessions.has(sid)) {
    const s = new AgentSession({ cwd: process.cwd(), autoApprove: false })
    s.setAuditSessionId(sid)
    s.onEvent(event => out({ kind: 'event', sessionId: sid, event }))
    sessions.set(sid, s)
  }
  return sessions.get(sid)!
}

const ctx: DaemonCtx = { out, getSession, mainSession, sessions, orchestrator }

void applyDisabledToEngine()

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let idx: number
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    const parsed = parseCommandLine(line)
    if (!parsed.ok) {
      out({ kind: 'error', error: parsed.error })
      continue
    }
    void dispatch(parsed.command, ctx)
  }
})
process.stdin.on('end', () => process.exit(0))

void bootstrapGuiDev(process.cwd()).then(async () => {
  await mergeProjectConfigOnBoot(
    process.cwd(),
    patch => mainSession.router.setConfig(patch),
    ids => { setDisabledResources(ids); void applyDisabledToEngine() },
  )
  void import('./codeIndexer.js').then(m => m.buildCodeIndex(process.cwd()).catch(() => {}))
  // status/ready 为 renderer 契约；ready 为旧测试契约，两者并发以兼容。
  out({ kind: 'status', state: 'ready' })
  out({ kind: 'ready' })
})
