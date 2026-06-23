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
import { captureService } from './captureService.js'
import { addMcpServer, removeMcpServer, verifyMcp, addSkillFromPath, addRuleFromPath } from './resourceAdmin.js'
import { reloadMcpPool } from './mcpPool.js'
import { switchDaemonProject } from './projectSwitch.js'
import { buildCodeIndex, searchCode } from './codeIndexer.js'
import {
  listPacks, exportPack, readPackFile, applyPack, applyPackFile, buildBundle,
} from './packService.js'
import {
  listRuntimes, loadCatalog, importRuntimePack, installCatalogEntry, installExternalPack, exportPortablePack,
  runtimePackDoc, catalogPackDoc, externalPackDoc,
} from './packCatalog.js'
import {
  listInstances, createInstance, deleteInstance, activateInstance,
  installPackToInstance, removePackFromInstance, setInstanceIntercept, loadInstance,
} from './instanceStore.js'
import type { PackDoc } from './packApply.js'
import { mergeProjectConfigOnBoot, routerPatchFromProject, loadProjectConfig, loadContribConfig, type ProjectConfig } from './projectConfig.js'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { materializePortableBundle } from './packPortable.js'
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

function routeRespondPermission(
  ctx: DaemonCtx,
  id: string,
  decision: PermissionDecision,
  sessionId?: string,
): void {
  if (sessionId) {
    ctx.getSession(sessionId).respondPermission(id, decision)
    return
  }
  if (ctx.mainSession.hasPendingPermission(id)) {
    ctx.mainSession.respondPermission(id, decision)
    return
  }
  for (const s of ctx.sessions.values()) {
    if (s.hasPendingPermission(id)) {
      s.respondPermission(id, decision)
      return
    }
  }
  ctx.mainSession.respondPermission(id, decision)
}

async function refreshMcpForAllSessions(ctx: DaemonCtx): Promise<void> {
  await reloadMcpPool()
  ctx.mainSession.syncMcpFromPool()
  for (const s of ctx.sessions.values()) s.syncMcpFromPool()
}

/** 装包后把 CCui 行为契约注入所有会话 + 落地 verify 到 project.yaml（best-effort） */
async function applyBindingToAllSessions(
  ctx: DaemonCtx,
  report: { binding?: import('./ccuiBinding.js').CcuiBinding },
): Promise<void> {
  if (!report.binding) return
  ctx.mainSession.applyCcuiBinding(report.binding)
  for (const s of ctx.sessions.values()) s.applyCcuiBinding(report.binding)
  if (report.binding.verify?.onDone?.length || report.binding.verify?.smoke?.length) {
    try {
      await writeVerifyToProjectYaml(process.cwd(), report.binding.verify)
    } catch { /* best-effort */ }
  }
}

/** 装包到实例；若该实例正激活，则重新投射使之即时生效 */
async function installToInstanceAndMaybeActivate(
  ctx: DaemonCtx,
  reqId: string | undefined,
  id: string,
  getPack: (cwd: string) => Promise<PackDoc>,
): Promise<void> {
  try {
    const cwd = process.cwd()
    const pack = await getPack(cwd)
    const inst = await installPackToInstance(cwd, id, pack)
    await reactivateIfActive(ctx, id)
    ctx.out({ kind: 'resp', reqId, ok: true, instance: inst })
  } catch (e) {
    throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
  }
}

/** 若 id 是当前激活实例，重新激活（投射 + 注入合成 binding） */
async function reactivateIfActive(ctx: DaemonCtx, id: string): Promise<void> {
  const { activeId } = await listInstances(process.cwd())
  if (activeId !== id) return
  const { binding } = await activateInstance(process.cwd(), id)
  await ctx.mainSession.reloadCommands().catch(() => {})
  await refreshMcpForAllSessions(ctx)
  ctx.mainSession.applyCcuiBinding(binding ?? null)
  for (const s of ctx.sessions.values()) s.applyCcuiBinding(binding ?? null)
}

async function writeVerifyToProjectYaml(
  cwd: string,
  verify: { onDone?: string[]; smoke?: string[] },
): Promise<void> {
  const dir = join(cwd, '.ccui')
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, 'project.yaml')
  let existing = ''
  try { existing = await fs.readFile(file, 'utf8') } catch { /* none */ }
  if (existing.includes('verify:')) return // 不覆盖用户已有 verify
  const lines = ['verify:']
  if (verify.onDone?.length) {
    lines.push('  onDone:')
    for (const c of verify.onDone) lines.push(`    - ${c}`)
  }
  if (verify.smoke?.length) {
    lines.push('  smoke:')
    for (const c of verify.smoke) lines.push(`    - ${c}`)
  }
  await fs.writeFile(file, `${existing.trimEnd()}\n${lines.join('\n')}\n`.trimStart(), 'utf8')
}

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
      if (ok) await refreshMcpForAllSessions(ctx)
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
    routeRespondPermission(ctx, cmd.id, decision, cmd.sessionId)
    ctx.out({ kind: 'ack', cmd: 'respondPermission' })
  },

  captureProxy(cmd, ctx) {
    captureService.setEmitter(ctx.out)
    let res
    if (cmd.action === 'start') res = captureService.start({ port: cmd.port, upstream: cmd.upstream })
    else if (cmd.action === 'stop') res = captureService.stop()
    else res = captureService.status()
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, ...res })
  },

  captureList(cmd, ctx) {
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, items: captureService.list() })
  },

  async addMcpServer(cmd, ctx) {
    const r = await addMcpServer(process.cwd(), cmd.name, cmd.config as never)
    await ctx.mainSession.reloadCommands().catch(() => {})
    if (r.ok) await refreshMcpForAllSessions(ctx)
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: r.ok, file: r.file })
  },

  async removeMcpServer(cmd, ctx) {
    const r = await removeMcpServer(process.cwd(), cmd.name)
    if (r.ok) await refreshMcpForAllSessions(ctx)
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: r.ok })
  },

  async verifyMcp(cmd, ctx) {
    const r = await verifyMcp(process.cwd(), cmd.name)
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: r.ok, reachable: r.reachable, level: r.level, detail: r.detail })
  },

  async addSkillPath(cmd, ctx) {
    const r = await addSkillFromPath(process.cwd(), cmd.path)
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: r.ok, name: r.name })
  },

  async addRulePath(cmd, ctx) {
    const r = await addRuleFromPath(process.cwd(), cmd.path)
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: r.ok, name: r.name })
  },

  async setProjectRoot(cmd, ctx) {
    try {
      await switchDaemonProject(cmd.path, [ctx.mainSession, ...ctx.sessions.values()])
      await mergeProjectConfigOnBoot(
        cmd.path,
        patch => ctx.mainSession.router.setConfig(patch),
        ids => { setDisabledResources(ids); void applyDisabledToEngine() },
      )
      void buildCodeIndex(cmd.path).catch(e => {
        process.stderr.write(`[codeIndexer] build failed: ${(e as Error).message}\n`)
      })
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, path: cmd.path })
    } catch (e) {
      throw ccuiError(ErrorCode.PROJECT_INFO_FAILED, toCcuiError(e).message, { feature: 'projects' })
    }
  },

  async packList(cmd, ctx) {
    const items = await listPacks(process.cwd())
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, items })
  },

  async packExport(cmd, ctx) {
    try {
      const r = await exportPack(process.cwd(), {
        runtime: cmd.runtime,
        name: cmd.name,
        noHarness: cmd.noHarness,
      })
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, path: r.path, stats: r.stats, pack: r.pack })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async packRead(cmd, ctx) {
    try {
      const pack = await readPackFile(cmd.path)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, pack })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async packApply(cmd, ctx) {
    try {
      const report = cmd.path
        ? await applyPackFile(process.cwd(), cmd.path)
        : await applyPack(process.cwd(), cmd.pack as never)
      await ctx.mainSession.reloadCommands().catch(() => {})
      if (report.mcp.length) await refreshMcpForAllSessions(ctx)
      await applyBindingToAllSessions(ctx, report)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, report })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async bundleExport(cmd, ctx) {
    try {
      const bundle = await buildBundle(process.cwd(), cmd.workspace)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, bundle })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async bundleImport(cmd, ctx) {
    try {
      const bundle = cmd.bundle
      let report = null
      const pack = bundle.pack as Record<string, unknown> | undefined
      if (pack && typeof pack === 'object') {
        report = await applyPack(process.cwd(), pack as never)
        await ctx.mainSession.reloadCommands().catch(() => {})
        if (report.mcp.length) await refreshMcpForAllSessions(ctx)
        await applyBindingToAllSessions(ctx, report)
      }
      const project = bundle.project as ProjectConfig | undefined
      if (project) {
        const patch = routerPatchFromProject(project)
        if (Object.keys(patch).length) ctx.mainSession.router.setConfig(patch)
        if (project.disabledResources?.length) {
          setDisabledResources(project.disabledResources)
          await applyDisabledToEngine()
        }
      }
      ctx.out({
        kind: 'resp',
        reqId: cmd.reqId,
        ok: true,
        report,
        workspace: bundle.workspace ?? null,
        project: bundle.project ?? null,
        contrib: bundle.contrib ?? null,
      })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async getProjectConfig(cmd, ctx) {
    const project = await loadProjectConfig(process.cwd())
    const contrib = await loadContribConfig(process.cwd())
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, project, contrib })
  },

  async listRuntimes(cmd, ctx) {
    const runtimes = await listRuntimes(process.cwd())
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, runtimes })
  },

  async packCatalog(cmd, ctx) {
    const catalog = await loadCatalog()
    const runtimes = await listRuntimes(process.cwd())
    const entries = cmd.runtime
      ? catalog.entries.filter(e => e.runtime === cmd.runtime)
      : catalog.entries
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, entries, runtimes })
  },

  async packImportRuntime(cmd, ctx) {
    try {
      const report = await importRuntimePack(process.cwd(), cmd.runtime)
      await ctx.mainSession.reloadCommands().catch(() => {})
      if (report.mcp.length) await refreshMcpForAllSessions(ctx)
      await applyBindingToAllSessions(ctx, report)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, report })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async packInstallCatalog(cmd, ctx) {
    try {
      const result = await installCatalogEntry(process.cwd(), cmd.entryId)
      await ctx.mainSession.reloadCommands().catch(() => {})
      if (result.mcp.length) await refreshMcpForAllSessions(ctx)
      await applyBindingToAllSessions(ctx, result)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, report: result, entry: result.entry })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async packInstallFile(cmd, ctx) {
    try {
      const report = await installExternalPack(process.cwd(), cmd.path)
      await ctx.mainSession.reloadCommands().catch(() => {})
      if (report.mcp.length) await refreshMcpForAllSessions(ctx)
      await applyBindingToAllSessions(ctx, report)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, report })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async packInstallInline(cmd, ctx) {
    try {
      const cwd = process.cwd()
      const pack = cmd.pack as import('./packApply.js').PackDoc
      const importsDir = join(cwd, '.ccui', 'imports')
      await fs.mkdir(importsDir, { recursive: true })
      const fname = (cmd.filename || `${pack.name || 'imported'}.pack.json`).replace(/[^\w.-]+/g, '_')
      await fs.writeFile(join(importsDir, fname), JSON.stringify(pack, null, 2), 'utf8')
      await materializePortableBundle(cwd, pack)
      const report = await applyPack(cwd, pack)
      await ctx.mainSession.reloadCommands().catch(() => {})
      if (report.mcp.length) await refreshMcpForAllSessions(ctx)
      await applyBindingToAllSessions(ctx, report)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, report })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async packExportPortable(cmd, ctx) {
    try {
      const r = await exportPortablePack(process.cwd(), { runtime: cmd.runtime, name: cmd.name })
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, path: r.path, pack: r.pack })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  // —— 实例（PCL 启动器）——
  async instanceList(cmd, ctx) {
    const { instances, activeId } = await listInstances(process.cwd())
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, instances, activeId })
  },

  async instanceCreate(cmd, ctx) {
    try {
      const inst = await createInstance(process.cwd(), { name: cmd.name, runtime: cmd.runtime })
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, instance: inst })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async instanceDelete(cmd, ctx) {
    try {
      await deleteInstance(process.cwd(), cmd.id)
      await ctx.mainSession.reloadCommands().catch(() => {})
      await refreshMcpForAllSessions(ctx)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async instanceActivate(cmd, ctx) {
    try {
      // 瓶口接管：实例开启 intercept → 先起 captureProxy，拿到代理 url 传给 activate 做 base_url 改道
      let proxyUrl: string | undefined
      const inst = await loadInstance(process.cwd(), cmd.id)
      if (inst?.intercept?.enabled) {
        const st = captureService.start({ upstream: inst.intercept.upstream })
        proxyUrl = st.url ?? undefined
      }
      const { instance, binding, baseUrl } = await activateInstance(process.cwd(), cmd.id, { proxyUrl })
      await ctx.mainSession.reloadCommands().catch(() => {})
      await refreshMcpForAllSessions(ctx)
      ctx.mainSession.applyCcuiBinding(binding ?? null)
      for (const s of ctx.sessions.values()) s.applyCcuiBinding(binding ?? null)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, instance, binding, baseUrl, proxyUrl })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async instanceSetIntercept(cmd, ctx) {
    try {
      const inst = await setInstanceIntercept(process.cwd(), cmd.id, cmd.enabled, cmd.upstream)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, instance: inst })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async instanceInstallCatalog(cmd, ctx) {
    await installToInstanceAndMaybeActivate(ctx, cmd.reqId, cmd.id, async cwd => (await catalogPackDoc(cwd, cmd.entryId)).pack)
  },

  async instanceInstallFile(cmd, ctx) {
    await installToInstanceAndMaybeActivate(ctx, cmd.reqId, cmd.id, () => externalPackDoc(cmd.path))
  },

  async instanceInstallInline(cmd, ctx) {
    await installToInstanceAndMaybeActivate(ctx, cmd.reqId, cmd.id, async () => cmd.pack as PackDoc)
  },

  async instanceImportRuntime(cmd, ctx) {
    await installToInstanceAndMaybeActivate(ctx, cmd.reqId, cmd.id, cwd => runtimePackDoc(cwd, cmd.runtime))
  },

  async instanceRemovePack(cmd, ctx) {
    try {
      const inst = await removePackFromInstance(process.cwd(), cmd.id, cmd.packName)
      await reactivateIfActive(ctx, cmd.id)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, instance: inst })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async auditList(cmd, ctx) {
    const { readAudit } = await import('./auditLog.js')
    const items = await readAudit(process.cwd(), cmd.limit ?? 200)
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, items })
  },

  async profileList(cmd, ctx) {
    const { listProfiles } = await import('./profileService.js')
    const items = await listProfiles(process.cwd())
    ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, items })
  },

  async profileExport(cmd, ctx) {
    try {
      const { exportProfile } = await import('./profileService.js')
      const r = await exportProfile(process.cwd(), cmd.name)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, path: r.path, stats: r.profile.stats, files: r.profile.files.length })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'profile' })
    }
  },

  async profileImport(cmd, ctx) {
    try {
      const { importProfile } = await import('./profileService.js')
      let profile = cmd.profile as import('./profileService.js').ProjectProfile | undefined
      if (!profile && cmd.path) profile = JSON.parse(await fs.readFile(cmd.path, 'utf8'))
      if (!profile) throw new Error('缺少 profile（path 或 inline）')
      const report = await importProfile(process.cwd(), profile, { overwrite: cmd.overwrite })
      await ctx.mainSession.reloadCommands().catch(() => {})
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, report })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'profile' })
    }
  },

  async runtimeBaseUrl(cmd, ctx) {
    try {
      const { applyBaseUrl, revertBaseUrl } = await import('./runtimeProjection.js')
      if (cmd.revert) {
        await revertBaseUrl(cmd.runtime, process.cwd())
        ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, reverted: true })
        return
      }
      if (!cmd.baseUrl) throw new Error('缺少 baseUrl')
      const r = await applyBaseUrl(cmd.runtime, process.cwd(), cmd.baseUrl)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: r.ok, file: r.file, skipped: r.skipped })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async packExportAstrbotPlugin(cmd, ctx) {
    try {
      const cwd = process.cwd()
      const pack = cmd.path ? await readPackFile(cmd.path) : (cmd.pack as PackDoc)
      const dest = cmd.dest || join(cwd, 'data', 'plugins')
      const { writeAstrbotPlugin } = await import('./astrbotPlugin.js')
      const r = await writeAstrbotPlugin(cwd, pack, dest)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, dirName: r.dirName, pluginDir: r.pluginDir, skills: r.skills, mcp: r.mcp })
    } catch (e) {
      throw ccuiError(ErrorCode.RESOURCE_SCAN_FAILED, toCcuiError(e).message, { feature: 'packs' })
    }
  },

  async buildCodeIndex(cmd, ctx) {
    try {
      const index = await buildCodeIndex(process.cwd())
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, chunks: index.chunks.length })
    } catch (e) {
      throw ccuiError(ErrorCode.MAP_SCAN_FAILED, toCcuiError(e).message, { feature: 'map' })
    }
  },

  async searchCode(cmd, ctx) {
    try {
      const hits = await searchCode(process.cwd(), cmd.query, cmd.limit ?? 12)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: true, hits })
    } catch (e) {
      throw ccuiError(ErrorCode.MAP_SCAN_FAILED, toCcuiError(e).message, { feature: 'map' })
    }
  },

  async testApi(cmd, ctx) {
    const key = process.env.ANTHROPIC_API_KEY
    const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')
    if (!key) {
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: false, error: '未设置 API Key' })
      return
    }
    const model = process.env.ANTHROPIC_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat'
    const t0 = Date.now()
    try {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(20_000),
      })
      const ms = Date.now() - t0
      const ok = res.status !== 401 && res.status !== 403
      let detail = `HTTP ${res.status}`
      if (!ok) detail = (await res.text()).slice(0, 300)
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok, status: res.status, latencyMs: ms, detail })
    } catch (e) {
      ctx.out({ kind: 'resp', reqId: cmd.reqId, ok: false, error: toCcuiError(e).message })
    }
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
