/**
 * GUI Core Daemon — Bun 子进程，stdio NDJSON 协议
 */
import { AgentSession } from './agentSession.js'
import { bootstrapGuiDev } from './bootstrap.js'
import { listResources, toggleMcp, listDir, readFilePreview, relPath, scanProjectGraph, loadCachedProjectGraph, getProjectInfo } from './resources.js'
import { setDisabledResources, applyDisabledToEngine, type ResourceMap } from './resourceFilters.js'
import { Orchestrator, type LaneSpec } from './orchestrator.js'
import type { PermissionDecision } from '../types/permissions.js'

;(globalThis as Record<string, unknown>).MACRO ??= new Proxy(
  { VERSION: '2.0.0-dev' } as Record<string, unknown>,
  { get: (t, k) => (k in t ? t[k as string] : '') },
)

type Command =
  | { cmd: 'send'; text: string; taskType?: string; model?: string; systemPrompt?: string; sessionId?: string }
  | { cmd: 'respondPermission'; id: string; allow: boolean; updatedInput?: Record<string, unknown> }
  | { cmd: 'setRouter'; patch: Record<string, unknown> }
  | { cmd: 'interrupt'; sessionId?: string }
  | { cmd: 'reset'; sessionId?: string }
  | { cmd: 'hydrate'; sessionId?: string; items?: Array<{ t: string; text?: string; sdk?: unknown }>; engineMessages?: unknown[] }
  | { cmd: 'getMessages'; sessionId?: string; reqId?: string }
  | { cmd: 'setEnv'; patch: Record<string, string> }
  | { cmd: 'setDisabledResources'; ids: string[]; map?: ResourceMap; reqId?: string }
  | { cmd: 'listResources'; reqId?: string }
  | { cmd: 'toggleMcp'; name: string; enabled: boolean; reqId?: string }
  | { cmd: 'listDir'; path?: string; reqId?: string }
  | { cmd: 'readFile'; path: string; reqId?: string }
  | { cmd: 'projectGraph'; refresh?: boolean; reqId?: string }
  | { cmd: 'orchestrate'; prompt: string; lanes: LaneSpec[]; crossReview?: boolean; synthesize?: boolean; reqId?: string }
  | { cmd: 'interruptOrchestrate' }
  | { cmd: 'getProjectInfo'; reqId?: string }
  | { cmd: 'ping'; reqId?: string }
  | { cmd: 'setAllowedTools'; tools: string[]; reqId?: string }

const ALLOWED_ENV = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'DEEPSEEK_MODEL',
])

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
    const s = new AgentSession({ cwd: process.cwd(), autoApprove: sid !== 'main' })
    s.onEvent(event => out({ kind: 'event', sessionId: sid, event }))
    sessions.set(sid, s)
  }
  return sessions.get(sid)!
}

void applyDisabledToEngine()

async function handle(cmd: Command): Promise<void> {
  switch (cmd.cmd) {
    case 'ping':
      out(cmd.reqId ? { kind: 'resp', reqId: cmd.reqId, ok: true } : { kind: 'pong' })
      return
    case 'setAllowedTools':
      mainSession.setAllowedTools(cmd.tools)
      for (const s of sessions.values()) s.setAllowedTools(cmd.tools)
      out(cmd.reqId ? { kind: 'resp', reqId: cmd.reqId, ok: true } : { kind: 'ack', cmd: 'setAllowedTools' })
      return
    case 'setRouter':
      mainSession.router.setConfig(cmd.patch)
      out({ kind: 'ack', cmd: 'setRouter' })
      return
    case 'interrupt':
      if (cmd.sessionId) getSession(cmd.sessionId).interrupt()
      else { mainSession.interrupt(); orchestrator.interrupt() }
      out({ kind: 'ack', cmd: 'interrupt' })
      return
    case 'interruptOrchestrate':
      orchestrator.interrupt()
      out({ kind: 'ack', cmd: 'interruptOrchestrate' })
      return
    case 'reset':
      getSession(cmd.sessionId).resetHistory()
      out({ kind: 'ack', cmd: 'reset' })
      return
    case 'hydrate': {
      const sess = getSession(cmd.sessionId)
      await sess.hydrateFromGui({
        items: cmd.items as Array<{ t: string; text?: string; sdk?: import('../types/message.js').Message }>,
        engineMessages: cmd.engineMessages as import('../types/message.js').Message[],
      })
      out({ kind: 'ack', cmd: 'hydrate', sessionId: cmd.sessionId || 'main' })
      return
    }
    case 'getMessages': {
      const msgs = getSession(cmd.sessionId).exportMessages()
      out(cmd.reqId
        ? { kind: 'resp', reqId: cmd.reqId, ok: true, messages: msgs }
        : { kind: 'messages', sessionId: cmd.sessionId || 'main', messages: msgs })
      return
    }
    case 'setEnv': {
      const applied: string[] = []
      for (const [k, v] of Object.entries(cmd.patch || {})) {
        if (!ALLOWED_ENV.has(k)) continue
        if (typeof v === 'string' && v.length) { process.env[k] = v; applied.push(k) }
      }
      out({ kind: 'ack', cmd: 'setEnv', applied })
      return
    }
    case 'setDisabledResources': {
      setDisabledResources(cmd.ids || [], cmd.map)
      await applyDisabledToEngine()
      await mainSession.reloadCommands()
      out({ kind: 'resp', reqId: cmd.reqId, ok: true, count: (cmd.ids || []).length })
      return
    }
    case 'listResources': {
      const items = await listResources(process.cwd()).catch(() => [])
      out({ kind: 'resp', reqId: cmd.reqId, ok: true, items })
      return
    }
    case 'toggleMcp': {
      const ok = await toggleMcp(cmd.name, cmd.enabled)
      out({ kind: 'resp', reqId: cmd.reqId, ok, applied: ok })
      return
    }
    case 'listDir': {
      const res = await listDir(process.cwd(), cmd.path)
      out({ kind: 'resp', reqId: cmd.reqId, ok: true, ...res, root: process.cwd() })
      return
    }
    case 'readFile': {
      const res = await readFilePreview(cmd.path)
      out({ kind: 'resp', reqId: cmd.reqId, ok: true, ...res, rel: relPath(process.cwd(), cmd.path) })
      return
    }
    case 'projectGraph': {
      const cwd = process.cwd()
      let graph = cmd.refresh ? null : await loadCachedProjectGraph(cwd)
      if (!graph) graph = await scanProjectGraph(cwd).catch(() => null)
      out({ kind: 'resp', reqId: cmd.reqId, ok: !!graph, graph })
      return
    }
    case 'getProjectInfo': {
      const info = await getProjectInfo(process.cwd()).catch(() => null)
      out({ kind: 'resp', reqId: cmd.reqId, ok: !!info, info })
      return
    }
    case 'orchestrate': {
      out({ kind: 'ack', cmd: 'orchestrate' })
      try {
        const lanes = cmd.lanes?.length ? cmd.lanes : [
          { id: 'A', label: '方案 A' },
          { id: 'B', label: '方案 B' },
          { id: 'C', label: '方案 C' },
        ]
        const results = await orchestrator.runParallel(cmd.prompt, lanes)
        let reviews: Awaited<ReturnType<Orchestrator['crossReview']>> = []
        if (cmd.crossReview !== false) reviews = await orchestrator.crossReview(results)
        let synthesis = ''
        if (cmd.synthesize !== false && results.some(r => r.text)) {
          synthesis = await orchestrator.synthesize(cmd.prompt, results, reviews)
        }
        out({ kind: 'resp', reqId: cmd.reqId, ok: true, results, reviews, synthesis })
      } catch (e) {
        out({ kind: 'resp', reqId: cmd.reqId, ok: false, error: (e as Error).message })
      }
      return
    }
    case 'respondPermission': {
      const decision: PermissionDecision = cmd.allow
        ? { behavior: 'allow', updatedInput: cmd.updatedInput }
        : { behavior: 'deny', message: '用户拒绝', decisionReason: { type: 'other', reason: 'user denied' } }
      mainSession.respondPermission(cmd.id, decision)
      out({ kind: 'ack', cmd: 'respondPermission' })
      return
    }
    case 'send': {
      const sess = getSession(cmd.sessionId)
      out({ kind: 'ack', cmd: 'send', sessionId: cmd.sessionId || 'main' })
      try {
        await sess.send(cmd.text, {
          taskType: cmd.taskType as never,
          model: cmd.model,
          systemPrompt: cmd.systemPrompt,
        })
      } catch { /* error via onEvent */ }
      return
    }
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let idx: number
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let cmd: Command
    try { cmd = JSON.parse(line) as Command } catch {
      out({ kind: 'error', error: `bad json: ${line}` })
      continue
    }
    void handle(cmd)
  }
})
process.stdin.on('end', () => process.exit(0))

void bootstrapGuiDev(process.cwd()).then(() => {
  out({ kind: 'status', state: 'ready' })
})
