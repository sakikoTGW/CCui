/**
 * Daemon 命令注册表 —— 替代巨型 switch。
 * 映射类型强制覆盖 protocol 里每一个命令；漏写一个 → 编译失败。
 * 每个 handler 自行 out() ack/resp/stream；抛错由 dispatch 统一兜成 CcuiError 信封。
 */
import type { Command, CommandKind, CommandOf } from '@ccui/protocol'
import { ccuiError, ErrorCode, toCcuiError } from '@ccui/protocol'
import type { AgentSession } from './agentSession.js'
import type { Orchestrator } from './orchestrator.js'
import {
  listResources, toggleMcp, listDir, readFilePreview, relPath,
  loadCachedProjectGraph, getProjectInfo,
} from './resources.js'
import { scanProjectGraph } from './projectIndexer.js'
import { setDisabledResources, applyDisabledToEngine } from './resourceFilters.js'
import type { PermissionDecision, Message } from '@ccui/engine-api'
import { recallLog } from '@ccui/engine-memory'

export interface DaemonCtx {
  out(obj: unknown): void
  getSession(id?: string): AgentSession
  mainSession: AgentSession
  sessions: Map<string, AgentSession>
  orchestrator: Orchestrator
}

const ALLOWED_ENV = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'DEEPSEEK_MODEL',
])

/** 每命令一个 handler，键名受 protocol 约束。 */
type Handlers = {
  [K in CommandKind]: (cmd: CommandOf<K>, ctx: DaemonCtx) => void | Promise<void>
}

export const handlers: Handlers = {
  ping(cmd, ctx) {
    ctx.out(cmd.reqId ? { kind: 'resp', reqId: cmd.reqId, ok: true } : { kind: 'pong' })
  },

  setAllowedTools(cmd, ctx) {
    ctx.mainSession.setAllowedTools(cmd.tools)
    for (const s of ctx.sessions.values()) s.setAllowedTools(cmd.tools)
    ctx.out(cmd.reqId ? { kind: 'resp', reqId: cmd.reqId, ok: true } : { kind: 'ack', cmd: 'setAllowedTools' })
  },

  setRouter(cmd, ctx) {
    ctx.mainSession.router.setConfig(cmd.patch)
    ctx.out({ kind: 'ack', cmd: 'setRouter' })
  },

  interrupt(cmd, ctx) {
    if (cmd.sessionId) ctx.getSession(cmd.sessionId).interrupt()
    else { ctx.mainSession.interrupt(); ctx.orchestrator.interrupt() }
    ctx.out({ kind: 'ack', cmd: 'interrupt' })
  },

  interruptOrchestrate(_cmd, ctx) {
    ctx.orchestrator.interrupt()
    ctx.out({ kind: 'ack', cmd: 'interruptOrchestrate' })
  },

  reset(cmd, ctx) {
    ctx.getSession(cmd.sessionId).resetHistory()
    ctx.out({ kind: 'ack', cmd: 'reset' })
  },

  async hydrate(cmd, ctx) {
    const sess = ctx.getSession(cmd.sessionId)
    await sess.hydrateFromGui({
      items: cmd.items as Array<{ t: string; text?: string; sdk?: Message }>,
      engineMessages: cmd.engineMessages as Message[],
    })
    ctx.out({ kind: 'ack', cmd: 'hydrate', sessionId: cmd.sessionId || 'main' })
  },

  getMessages(cmd, ctx) {
    const msgs = ctx.getSession(cmd.sessionId).exportMessages()
    ctx.out(cmd.reqId
      ? { kind: 'resp', reqId: cmd.reqId, ok: true, messages: msgs }
      : { kind: 'messages', sessionId: cmd.sessionId || 'main', messages: msgs })
  },

  setEnv(cmd, ctx) {
    const applied: string[] = []
    for (const [k, v] of Object.entries(cmd.patch || {})) {
      if (!ALLOWED_ENV.has(k)) continue
      if (typeof v === 'string' && v.length) { process.env[k] = v; applied.push(k) }
    }
    ctx.out({ kind: 'ack', cmd: 'setEnv', applied })
  },

  async setDisabledResources(cmd, ctx) {
    setDisabledResources(cmd.ids || [], cmd.map)
    await applyDisabledToEngine()
    await ctx.mainSession.reloadCommands()
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, count: (cmd.ids || []).length })
  },

  async listResources(cmd, ctx) {
    // 不再 .catch(()=>[]) 静默吞错：扫描总失败 → 显式 RESOURCE_SCAN_FAILED
    let items
    try {
      items = await listResources(process.cwd())
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'console' })
    }
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, items })
  },

  async toggleMcp(cmd, ctx) {
    let ok = false
    try {
      ok = await toggleMcp(cmd.name, cmd.enabled)
    } catch (e) {
      throw ccuiError(ErrorCode.MCP_TOGGLE_FAILED, toCcuiError(e).message, { feature: 'console' })
    }
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok, applied: ok })
  },

  async listDir(cmd, ctx) {
    let res
    try {
      res = await listDir(process.cwd(), cmd.path)
    } catch (e) {
      throw ccuiError(ErrorCode.DIR_LIST_FAILED, toCcuiError(e).message, { feature: 'filetree' })
    }
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, ...res, root: process.cwd() })
  },

  async readFile(cmd, ctx) {
    let res
    try {
      res = await readFilePreview(cmd.path)
    } catch (e) {
      throw ccuiError(ErrorCode.FILE_READ_FAILED, toCcuiError(e).message, { feature: 'filetree' })
    }
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, ...res, rel: relPath(process.cwd(), cmd.path) })
  },

  async projectGraph(cmd, ctx) {
    const cwd = process.cwd()
    let graph = cmd.refresh ? null : await loadCachedProjectGraph(cwd).catch(() => null)
    if (!graph) {
      try {
        graph = await scanProjectGraph(cwd)
      } catch (e) {
        // 可选功能：显式报错码，不静默 ok:false
        throw ccuiError(ErrorCode.MAP_SCAN_FAILED, toCcuiError(e).message, { feature: 'map' })
      }
    }
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: !!graph, graph })
  },

  async getProjectInfo(cmd, ctx) {
    let info
    try {
      info = await getProjectInfo(process.cwd())
    } catch (e) {
      throw ccuiError(ErrorCode.PROJECT_INFO_FAILED, toCcuiError(e).message, { feature: 'projects' })
    }
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: !!info, info })
  },

  getRecall(cmd, ctx) {
    // 记忆召回日志在引擎内存（hybridRecall 每轮 recordRecall）。读快照给 UI 可视化。
    let last = null
    let history: readonly unknown[] = []
    try {
      last = recallLog.getLastRecallEvent()
      history = recallLog.getRecallHistory()
    } catch {
      /* 记忆未启用/未初始化 → 返回空 */
    }
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, last, history })
  },

  async orchestrate(cmd, ctx) {
    ctx.out({ kind: 'ack', cmd: 'orchestrate' })
    try {
      const lanes = cmd.lanes?.length ? cmd.lanes : [
        { id: 'A', label: '方案 A' },
        { id: 'B', label: '方案 B' },
        { id: 'C', label: '方案 C' },
      ]
      const results = await ctx.orchestrator.runParallel(cmd.prompt, lanes)
      let reviews: Awaited<ReturnType<Orchestrator['crossReview']>> = []
      if (cmd.crossReview !== false) reviews = await ctx.orchestrator.crossReview(results)
      let synthesis = ''
      if (cmd.synthesize !== false && results.some(r => r.text)) {
        synthesis = await ctx.orchestrator.synthesize(cmd.prompt, results, reviews)
      }
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, results, reviews, synthesis })
    } catch (e) {
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: false, error: toCcuiError(e, ErrorCode.ORCHESTRATE_FAILED, 'orchestrate') })
    }
  },

  respondPermission(cmd, ctx) {
    const decision: PermissionDecision = cmd.allow
      ? { behavior: 'allow', updatedInput: cmd.updatedInput }
      : { behavior: 'deny', message: '用户拒绝', decisionReason: { type: 'other', reason: 'user denied' } }
    ctx.mainSession.respondPermission(cmd.id, decision)
    ctx.out({ kind: 'ack', cmd: 'respondPermission' })
  },

  async send(cmd, ctx) {
    const sess = ctx.getSession(cmd.sessionId)
    ctx.out({ kind: 'ack', cmd: 'send', sessionId: cmd.sessionId || 'main' })
    // send 的错误经会话事件流上报（done/error event），此处吞 throw 不影响其他 session
    try {
      await sess.send(cmd.text, {
        taskType: cmd.taskType as never,
        model: cmd.model,
        systemPrompt: cmd.systemPrompt,
      })
    } catch (e) {
      ctx.out({ kind: 'event', sessionId: cmd.sessionId || 'main', event: { type: 'error', error: toCcuiError(e, ErrorCode.SESSION_CRASHED, 'chat').message } })
    }
  },
}

/**
 * 分发单条命令：查注册表 → 执行 → 统一兜错。
 * 一个命令抛错只回该命令的 CcuiError 信封，不波及 daemon 进程或其他命令。
 */
export async function dispatch(cmd: Command, ctx: DaemonCtx): Promise<void> {
  const handler = handlers[cmd.cmd] as (c: Command, ctx: DaemonCtx) => void | Promise<void>
  try {
    await handler(cmd, ctx)
  } catch (e) {
    const reqId = (cmd as { reqId?: string }).reqId
    const error = toCcuiError(e)
    if (reqId) ctx.out({ kind: 'resp', reqId, ok: false, error })
    else ctx.out({ kind: 'error', error })
  }
}
