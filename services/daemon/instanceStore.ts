/**
 * 实例（Instance）—— PCL / MultiMC 心智的核心。
 *
 * CCui = 启动器。每个实例是一个**隔离**的 harness 环境：
 *   实例 = 运行时(版本) + 装进它的整合包们（skills/rules/MCP/行为契约）。
 *
 * 关键纪律：
 *   - 整合包物化到实例自己的目录 `.ccui/instances/<id>/`，**不污染本机** ~/.claude 等。
 *   - 「激活实例」= 把这套 harness 投射到当前项目（带安装清单），并把合成 binding 注入会话。
 *   - 「切换实例」= 先按清单干净卸下旧实例的投射，再投射新实例。删实例一键清空。
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { PackDoc } from './packApply.js'
import type { CcuiBinding } from './ccuiBinding.js'
import { resolveRuleFile, resolveSkillDir } from './packPortable.js'
import { runtimeProjectionDirs } from '../proxy/runtimeAdapters.js'
import { writeAstrbotPlugin } from './astrbotPlugin.js'
import {
  mcpTargetFor, mergeMcp, unmergeMcp, addHermesExternalDir, removeHermesExternalDir,
  applyBaseUrl, revertBaseUrl, baseUrlTargetFor,
  type McpFormat, type McpServers,
} from './runtimeProjection.js'

export type InstancePack = {
  name: string
  source: string
  installedAt: string
  skills: string[]
  rules: string[]
  mcp: string[]
  binding?: CcuiBinding
}

export type Instance = {
  id: string
  name: string
  runtime: string
  createdAt: string
  activatedAt?: string
  packs: InstancePack[]
  /** 瓶口接管：启动时把该 runtime 的 base_url 改道到 CCui 代理 */
  intercept?: { enabled: boolean; upstream?: string }
}

type ProjectionManifest = {
  instanceId: string | null
  /** skills 投射目标目录（相对项目，按实例 runtime 决定，如 .agents/skills、.claude/skills） */
  skillsDir: string
  /** rules 投射目标目录（相对项目） */
  ruleDir: string
  skills: string[] // 投到 skillsDir 的目录名
  rules: string[] // 投到 ruleDir 的文件名
  mcp: string[] // 合并进 mcpFileAbs 的 server 名
  /** MCP 合并目标文件（绝对路径，可能在 ~/.hermes 等全局） */
  mcpFileAbs?: string
  /** MCP 目标格式（回滚时按格式反向删除） */
  mcpFormat?: McpFormat
  /** AstrBot 特殊投射：生成的插件目录（相对 cwd），切换/卸载时整目录删除 */
  astrbotPluginDirs?: string[]
  /** Hermes：登记进 config.yaml skills.external_dirs 的目录（回滚时移除） */
  hermesExternalDir?: { configAbs: string; skillsAbs: string }
  /** 瓶口接管：已对哪个 runtime 改了 base_url（回滚时还原） */
  baseUrlRuntime?: string
}

function instancesRoot(cwd: string): string {
  return join(cwd, '.ccui', 'instances')
}
function instanceDir(cwd: string, id: string): string {
  return join(instancesRoot(cwd), id)
}
function indexPath(cwd: string): string {
  return join(instancesRoot(cwd), 'index.json')
}
function projectionPath(cwd: string): string {
  return join(cwd, '.ccui', 'active-projection.json')
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(p, 'utf8')) as T } catch { return fallback }
}

async function writeJson(p: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8')
}

type IndexFile = { active: string | null; ids: string[] }

async function loadIndex(cwd: string): Promise<IndexFile> {
  return readJson<IndexFile>(indexPath(cwd), { active: null, ids: [] })
}
async function saveIndex(cwd: string, idx: IndexFile): Promise<void> {
  await writeJson(indexPath(cwd), idx)
}

export async function loadInstance(cwd: string, id: string): Promise<Instance | null> {
  const p = join(instanceDir(cwd, id), 'instance.json')
  if (!(await exists(p))) return null
  return readJson<Instance | null>(p, null)
}

async function saveInstance(cwd: string, inst: Instance): Promise<void> {
  await writeJson(join(instanceDir(cwd, inst.id), 'instance.json'), inst)
}

export async function listInstances(cwd: string): Promise<{ instances: Instance[]; activeId: string | null }> {
  const idx = await loadIndex(cwd)
  const instances: Instance[] = []
  for (const id of idx.ids) {
    const inst = await loadInstance(cwd, id)
    if (inst) instances.push(inst)
  }
  return { instances, activeId: idx.active }
}

export async function createInstance(cwd: string, opts: { name: string; runtime: string }): Promise<Instance> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const inst: Instance = {
    id,
    name: opts.name || `实例-${id}`,
    runtime: opts.runtime || 'ccui',
    createdAt: new Date().toISOString(),
    packs: [],
  }
  await fs.mkdir(instanceDir(cwd, id), { recursive: true })
  await saveInstance(cwd, inst)
  const idx = await loadIndex(cwd)
  idx.ids.push(id)
  if (!idx.active) idx.active = id
  await saveIndex(cwd, idx)
  return inst
}

export async function deleteInstance(cwd: string, id: string): Promise<void> {
  const idx = await loadIndex(cwd)
  if (idx.active === id) {
    await unprojectActive(cwd)
    idx.active = idx.ids.find(x => x !== id) ?? null
  }
  idx.ids = idx.ids.filter(x => x !== id)
  await saveIndex(cwd, idx)
  await fs.rm(instanceDir(cwd, id), { recursive: true, force: true })
}

/** 把整合包物化进**实例自己的目录**（隔离，不碰项目/本机） */
export async function installPackToInstance(cwd: string, id: string, pack: PackDoc): Promise<Instance> {
  const inst = await loadInstance(cwd, id)
  if (!inst) throw new Error(`实例不存在：${id}`)
  const dir = instanceDir(cwd, id)
  const skillsDest = join(dir, 'skills')
  const rulesDest = join(dir, 'rules')
  await fs.mkdir(skillsDest, { recursive: true })
  await fs.mkdir(rulesDest, { recursive: true })

  const skills: string[] = []
  const rules: string[] = []
  const mcp: string[] = []

  // 便携包优先用内嵌文件；否则按 ref 从本机找
  const bundleFiles = pack.bundle?.files
  if (bundleFiles?.length) {
    for (const f of bundleFiles) {
      const dest = join(dir, f.path.replace(/\//g, '\\'))
      await fs.mkdir(dirname(dest), { recursive: true })
      await fs.writeFile(dest, f.content, 'utf8')
      const m = f.path.match(/^skills\/([^/]+)\//)
      if (m && !skills.includes(m[1])) skills.push(m[1])
      const r = f.path.match(/^rules\/(.+)$/)
      if (r && !rules.includes(r[1])) rules.push(r[1])
    }
  } else {
    for (const s of pack.knowledge?.skills ?? []) {
      const name = String(s.name || basename(String(s.ref || '')))
      const src = await resolveSkillDir(cwd, name, String(s.ref || ''), null)
      if (!src) continue
      await fs.cp(src, join(skillsDest, name), { recursive: true })
      skills.push(name)
    }
    for (const r of pack.knowledge?.rules ?? []) {
      const name = String(r.name || basename(String(r.ref || '')))
      const src = await resolveRuleFile(cwd, name, String(r.ref || ''), null)
      if (!src) continue
      await fs.copyFile(src, join(rulesDest, name))
      rules.push(name)
    }
  }

  // MCP 写进实例的 mcp.json
  const instMcp = await readJson<{ mcpServers: Record<string, unknown> }>(join(dir, 'mcp.json'), { mcpServers: {} })
  for (const m of pack.tools?.mcp ?? []) {
    const n = String(m.name || '').trim()
    if (!n) continue
    const cfg: Record<string, unknown> = {}
    if (m.url) { cfg.type = m.type || 'http'; cfg.url = m.url } else if (m.command) { cfg.type = 'stdio'; cfg.command = m.command; if (m.args) cfg.args = m.args }
    if (m.env) cfg.env = m.env
    instMcp.mcpServers[n] = cfg
    mcp.push(n)
  }
  await writeJson(join(dir, 'mcp.json'), instMcp)

  // 去重叠加：同名包替换
  inst.packs = inst.packs.filter(p => p.name !== (pack.name || 'unnamed'))
  inst.packs.push({
    name: pack.name || 'unnamed',
    source: pack.meta?.source || pack.runtime?.id || 'pack',
    installedAt: new Date().toISOString(),
    skills,
    rules,
    mcp,
    binding: pack.ccui,
  })
  await saveInstance(cwd, inst)
  return inst
}

export async function removePackFromInstance(cwd: string, id: string, packName: string): Promise<Instance> {
  const inst = await loadInstance(cwd, id)
  if (!inst) throw new Error(`实例不存在：${id}`)
  const pack = inst.packs.find(p => p.name === packName)
  if (pack) {
    const dir = instanceDir(cwd, id)
    for (const s of pack.skills) await fs.rm(join(dir, 'skills', s), { recursive: true, force: true })
    for (const r of pack.rules) await fs.rm(join(dir, 'rules', r), { force: true })
    if (pack.mcp.length) {
      const instMcp = await readJson<{ mcpServers: Record<string, unknown> }>(join(dir, 'mcp.json'), { mcpServers: {} })
      for (const n of pack.mcp) delete instMcp.mcpServers[n]
      await writeJson(join(dir, 'mcp.json'), instMcp)
    }
  }
  inst.packs = inst.packs.filter(p => p.name !== packName)
  await saveInstance(cwd, inst)
  return inst
}

/** 合成实例内所有包的行为契约：数组取并集，标量后装覆盖先装 */
export function mergeInstanceBinding(inst: Instance): CcuiBinding | undefined {
  const bindings = inst.packs.map(p => p.binding).filter((b): b is CcuiBinding => !!b)
  if (!bindings.length) return undefined
  const out: CcuiBinding = { bindingVersion: '1' }
  const uniq = (a: string[] = [], b: string[] = []) => Array.from(new Set([...a, ...b]))
  for (const b of bindings) {
    if (b.router) out.router = { ...out.router, ...b.router }
    if (b.review) {
      out.review = {
        forceAsk: uniq(out.review?.forceAsk, b.review.forceAsk),
        highRisk: uniq(out.review?.highRisk, b.review.highRisk),
        autoAllow: uniq(out.review?.autoAllow, b.review.autoAllow),
      }
    }
    if (b.loop?.maxTurns) out.loop = { maxTurns: b.loop.maxTurns }
    if (b.harness) out.harness = { ...out.harness, ...b.harness }
    if (b.verify) out.verify = { ...out.verify, ...b.verify }
    if (b.compareLanes?.length) out.compareLanes = b.compareLanes
  }
  return out
}

/** 卸下当前投射（按清单从项目移除上一个实例投射的技能/规则/MCP） */
export async function unprojectActive(cwd: string): Promise<void> {
  const man = await readJson<ProjectionManifest | null>(projectionPath(cwd), null)
  if (!man) return
  const skillsDir = man.skillsDir || '.claude/skills'
  const ruleDir = man.ruleDir || '.claude/rules'
  for (const s of man.skills) await fs.rm(join(cwd, skillsDir, s), { recursive: true, force: true })
  for (const r of man.rules) await fs.rm(join(cwd, ruleDir, r), { force: true })
  for (const p of man.astrbotPluginDirs ?? []) await fs.rm(join(cwd, p), { recursive: true, force: true })
  if (man.mcp.length && man.mcpFileAbs && man.mcpFormat) {
    await unmergeMcp(man.mcpFileAbs, man.mcpFormat, man.mcp).catch(() => {})
  }
  if (man.hermesExternalDir) {
    await removeHermesExternalDir(man.hermesExternalDir.configAbs, man.hermesExternalDir.skillsAbs).catch(() => {})
  }
  if (man.baseUrlRuntime) {
    await revertBaseUrl(man.baseUrlRuntime, cwd).catch(() => {})
  }
  await fs.rm(projectionPath(cwd), { force: true }).catch(() => {})
}

export async function setInstanceIntercept(cwd: string, id: string, enabled: boolean, upstream?: string): Promise<Instance> {
  const inst = await loadInstance(cwd, id)
  if (!inst) throw new Error(`实例不存在：${id}`)
  inst.intercept = { enabled, upstream }
  await saveInstance(cwd, inst)
  return inst
}

/** 激活实例：先卸旧投射 → 把实例的 skills/rules/mcp 投射到项目 → 写新清单
 *  opts.proxyUrl：若实例开启瓶口接管且 runtime 支持 base_url，则把它改道到该代理地址。 */
export async function activateInstance(
  cwd: string,
  id: string,
  opts: { proxyUrl?: string } = {},
): Promise<{ instance: Instance; binding: CcuiBinding | undefined; baseUrl?: { runtime: string; file?: string; skipped?: string } }> {
  const inst = await loadInstance(cwd, id)
  if (!inst) throw new Error(`实例不存在：${id}`)
  await unprojectActive(cwd)

  const dir = instanceDir(cwd, id)
  // 第一把刀：按实例 runtime 决定投射到哪个引擎认的目录（codex→.agents/skills，claude→.claude/skills…）
  const { skillsDir, ruleDir } = runtimeProjectionDirs(inst.runtime)
  const man: ProjectionManifest = { instanceId: id, skillsDir, ruleDir, skills: [], rules: [], mcp: [] }

  const skillsSrc = join(dir, 'skills')

  if (inst.runtime === 'astrbot') {
    // AstrBot：把整合包包装成插件 data/plugins/ccui_<pack>/（HARNESS_RESEARCH.md §5）
    const pluginsRoot = join(cwd, 'data', 'plugins')
    await fs.mkdir(pluginsRoot, { recursive: true })
    man.astrbotPluginDirs = []
    for (const p of inst.packs) {
      const pack: PackDoc = {
        schema: 'ccui-pack/v0.1',
        name: p.name,
        knowledge: { skills: p.skills.map(s => ({ name: s, ref: join(dir, 'skills', s, 'SKILL.md') })) },
        tools: { mcp: [] },
      }
      const r = await writeAstrbotPlugin(cwd, pack, pluginsRoot)
      man.astrbotPluginDirs.push(join('data', 'plugins', r.dirName))
    }
  } else if (inst.runtime === 'hermes') {
    // Hermes：非侵入挂载 —— 把实例 skills 目录登记进 ~/.hermes/config.yaml 的 skills.external_dirs
    if (await exists(skillsSrc)) {
      const target = mcpTargetFor('hermes', cwd) // 借此拿到 ~/.hermes/config.yaml
      const ok = await addHermesExternalDir(target.absFile, skillsSrc).catch(() => false)
      if (ok) man.hermesExternalDir = { configAbs: target.absFile, skillsAbs: skillsSrc }
    }
  } else {
    // 目录型 runtime（claude/ccui/cursor/codex/openclaw）：投射到各自认的 skills 目录
    if (await exists(skillsSrc)) {
      await fs.mkdir(join(cwd, skillsDir), { recursive: true })
      for (const e of await fs.readdir(skillsSrc, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        await fs.cp(join(skillsSrc, e.name), join(cwd, skillsDir, e.name), { recursive: true })
        man.skills.push(e.name)
      }
    }
    const rulesSrc = join(dir, 'rules')
    if (await exists(rulesSrc)) {
      await fs.mkdir(join(cwd, ruleDir), { recursive: true })
      for (const e of await fs.readdir(rulesSrc, { withFileTypes: true })) {
        if (!e.isFile()) continue
        await fs.copyFile(join(rulesSrc, e.name), join(cwd, ruleDir, e.name))
        man.rules.push(e.name)
      }
    }
  }

  // MCP 端口：按 runtime 真实目标+格式合并（.mcp.json / openclaw JSON5 / hermes YAML / astrbot JSON）
  const instMcp = await readJson<{ mcpServers: McpServers }>(join(dir, 'mcp.json'), { mcpServers: {} })
  if (instMcp.mcpServers && Object.keys(instMcp.mcpServers).length) {
    const target = mcpTargetFor(inst.runtime, cwd)
    const res = await mergeMcp(target, instMcp.mcpServers)
    if (res.added.length) {
      man.mcp = res.added
      man.mcpFileAbs = res.file
      man.mcpFormat = res.format
    }
  }

  // 瓶口接管：把该 runtime 的 base_url 改道到 CCui 代理（opts.proxyUrl 由 daemon 起好代理后传入）
  let baseUrl: { runtime: string; file?: string; skipped?: string } | undefined
  if (inst.intercept?.enabled && opts.proxyUrl && baseUrlTargetFor(inst.runtime, cwd)) {
    const r = await applyBaseUrl(inst.runtime, cwd, opts.proxyUrl)
    if (r.ok) man.baseUrlRuntime = inst.runtime
    baseUrl = { runtime: inst.runtime, file: r.file, skipped: r.skipped }
  }

  await writeJson(projectionPath(cwd), man)

  inst.activatedAt = new Date().toISOString()
  await saveInstance(cwd, inst)
  const idx = await loadIndex(cwd)
  idx.active = id
  await saveIndex(cwd, idx)

  return { instance: inst, binding: mergeInstanceBinding(inst), baseUrl }
}

export async function getActiveInstance(cwd: string): Promise<Instance | null> {
  const idx = await loadIndex(cwd)
  if (!idx.active) return null
  return loadInstance(cwd, idx.active)
}
