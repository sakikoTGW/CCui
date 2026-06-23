/**
 * 整合包目录 — 按运行时浏览 / 装别人的包 / 从本机引擎导入。
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RUNTIME_ADAPTERS,
  detectRuntimes,
  getAdapter,
  scanRuntime,
  type RuntimeScan,
} from '../../services/proxy/runtimeAdapters.js'
import { applyPack, type PackDoc, type ApplyReport } from './packApply.js'
import { embedPortableFiles, materializePortableBundle } from './packPortable.js'

const CCUI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CATALOG_DIR = join(CCUI_ROOT, '.ccui', 'catalog')

export type RuntimeInfo = {
  id: string
  label: string
  verified: boolean
  note?: string
  detected: boolean
  skillCount?: number
  ruleCount?: number
  mcpCount?: number
}

export type CatalogEntry = {
  id: string
  runtime: string
  label: string
  description: string
  type: 'runtime-import' | 'bundled' | 'community'
  file?: string
  url?: string
  author?: string
}

export type CatalogRegistry = {
  version: number
  entries: CatalogEntry[]
}

function scanToPackDoc(scan: RuntimeScan, runtimeId: string, name: string): PackDoc {
  const adapter = getAdapter(runtimeId)
  return {
    schema: 'ccui-pack/v0.1',
    name,
    version: '0.1.0',
    runtime: { id: runtimeId, label: adapter?.label || runtimeId, verified: adapter?.verified ?? false },
    knowledge: {
      skills: scan.skills.map(s => ({ name: s.name, source: 'path', ref: s.ref, scope: s.scope })),
      rules: scan.rules.map(r => ({ name: r.name, format: r.format, ref: r.ref, scope: r.scope })),
    },
    tools: { mcp: scan.mcp },
    meta: { fidelity: 'L1', source: 'runtime-import', runtime: runtimeId },
  }
}

export async function listRuntimes(cwd: string): Promise<RuntimeInfo[]> {
  const detected = new Set(await detectRuntimes(cwd))
  const pick = ['claude-code', 'codex', 'openclaw', 'hermes', 'cursor', 'ccui', 'opencode']
  const out: RuntimeInfo[] = []
  for (const id of pick) {
    const a = getAdapter(id)
    if (!a) continue
    let skillCount = 0
    let ruleCount = 0
    let mcpCount = 0
    if (detected.has(id)) {
      try {
        const scan = await scanRuntime(cwd, a)
        skillCount = scan.skills.length
        ruleCount = scan.rules.length
        mcpCount = scan.mcp.length
      } catch { /* ignore */ }
    }
    out.push({
      id: a.id,
      label: a.label,
      verified: a.verified,
      note: a.note,
      detected: detected.has(id),
      skillCount,
      ruleCount,
      mcpCount,
    })
  }
  return out
}

export async function loadCatalog(): Promise<CatalogRegistry> {
  const path = join(CATALOG_DIR, 'registry.json')
  try {
    const raw = await fs.readFile(path, 'utf8')
    return JSON.parse(raw) as CatalogRegistry
  } catch {
    return { version: 1, entries: defaultCatalogEntries() }
  }
}

function defaultCatalogEntries(): CatalogEntry[] {
  return [
    {
      id: 'import-claude-code',
      runtime: 'claude-code',
      label: '本机 Claude Code 配置',
      description: '从 ~/.claude/skills、CLAUDE.md、~/.claude.json MCP 导入到当前项目',
      type: 'runtime-import',
    },
    {
      id: 'import-codex',
      runtime: 'codex',
      label: '本机 Codex 配置',
      description: '从 ~/.codex、AGENTS.md、~/.codex/config.toml MCP 导入',
      type: 'runtime-import',
    },
    {
      id: 'import-openclaw',
      runtime: 'openclaw',
      label: '本机 OpenClaw 配置',
      description: '从 ~/.openclaw/openclaw.json、~/.openclaw/skills 导入',
      type: 'runtime-import',
    },
    {
      id: 'import-hermes',
      runtime: 'hermes',
      label: '本机 Hermes 配置',
      description: '从 ~/.hermes/config.yaml、~/.hermes/skills 导入',
      type: 'runtime-import',
    },
    {
      id: 'import-cursor',
      runtime: 'cursor',
      label: '本机 Cursor 配置',
      description: '从 ~/.cursor、.cursor/rules、MCP 导入',
      type: 'runtime-import',
    },
    {
      id: 'bundled-agents-starter',
      runtime: 'codex',
      label: 'Agents 通用入门包（便携）',
      description: '内置便携 skills：brainstorming + verification-before-completion，可直接装',
      type: 'bundled',
      file: 'agents-starter.pack.json',
      author: 'CCui',
    },
    {
      id: 'bundled-claude-starter',
      runtime: 'claude-code',
      label: 'Claude Code 入门包（便携）',
      description: '内置便携 skill：systematic-debugging',
      type: 'bundled',
      file: 'claude-starter.pack.json',
      author: 'CCui',
    },
  ]
}

/** 产出 PackDoc（不 apply）—— 供实例装包用 */
export async function runtimePackDoc(cwd: string, runtimeId: string): Promise<PackDoc> {
  const adapter = getAdapter(runtimeId)
  if (!adapter) throw new Error(`未知运行时：${runtimeId}`)
  const scan = await scanRuntime(cwd, adapter)
  if (!scan.skills.length && !scan.rules.length && !scan.mcp.length) {
    throw new Error(`未在本机检测到 ${adapter.label} 的 skills/rules/MCP。请先安装该引擎或检查 ~/.${runtimeId} 配置。`)
  }
  return scanToPackDoc(scan, runtimeId, `${runtimeId}-local-import`)
}

export async function catalogPackDoc(cwd: string, entryId: string): Promise<{ pack: PackDoc; entry: CatalogEntry }> {
  const catalog = await loadCatalog()
  const entry = catalog.entries.find(e => e.id === entryId)
  if (!entry) throw new Error(`目录项不存在：${entryId}`)
  if (entry.type === 'runtime-import') {
    return { pack: await runtimePackDoc(cwd, entry.runtime), entry }
  }
  if (entry.type === 'bundled' && entry.file) {
    const raw = await fs.readFile(join(CATALOG_DIR, entry.file), 'utf8')
    return { pack: JSON.parse(raw) as PackDoc, entry }
  }
  throw new Error(`暂不支持安装类型：${entry.type}`)
}

export async function externalPackDoc(srcPath: string): Promise<PackDoc> {
  const raw = await fs.readFile(srcPath, 'utf8')
  return JSON.parse(raw) as PackDoc
}

export async function importRuntimePack(cwd: string, runtimeId: string): Promise<ApplyReport> {
  const adapter = getAdapter(runtimeId)
  if (!adapter) throw new Error(`未知运行时：${runtimeId}`)
  const scan = await scanRuntime(cwd, adapter)
  if (!scan.skills.length && !scan.rules.length && !scan.mcp.length) {
    throw new Error(`未在本机检测到 ${adapter.label} 的 skills/rules/MCP。请先安装该引擎或检查 ~/.${runtimeId} 配置。`)
  }
  const pack = scanToPackDoc(scan, runtimeId, `${runtimeId}-local-import`)
  return applyPack(cwd, pack)
}

export async function installCatalogEntry(cwd: string, entryId: string): Promise<ApplyReport & { entry: CatalogEntry }> {
  const catalog = await loadCatalog()
  const entry = catalog.entries.find(e => e.id === entryId)
  if (!entry) throw new Error(`目录项不存在：${entryId}`)

  if (entry.type === 'runtime-import') {
    const report = await importRuntimePack(cwd, entry.runtime)
    return { ...report, entry }
  }

  if (entry.type === 'bundled' && entry.file) {
    const path = join(CATALOG_DIR, entry.file)
    return { ...(await installExternalPack(cwd, path)), entry }
  }

  throw new Error(`暂不支持安装类型：${entry.type}`)
}

/** 安装别人的 .pack.json（复制到 imports + 便携解压 + 装载） */
export async function installExternalPack(cwd: string, srcPath: string): Promise<ApplyReport> {
  const raw = await fs.readFile(srcPath, 'utf8')
  const pack = JSON.parse(raw) as PackDoc
  const importsDir = join(cwd, '.ccui', 'imports')
  await fs.mkdir(importsDir, { recursive: true })
  const dest = join(importsDir, basename(srcPath).replace(/[^\w.-]+/g, '_') || 'imported.pack.json')
  await fs.writeFile(dest, raw, 'utf8')
  await materializePortableBundle(cwd, pack)
  return applyPack(cwd, pack)
}

export async function exportPortablePack(
  cwd: string,
  opts: { runtime?: string; name?: string } = {},
): Promise<{ path: string; pack: PackDoc }> {
  const { buildPack } = await import('../../scripts/pack-export.js')
  const { pack, outPath } = await buildPack(cwd, {
    runtime: opts.runtime || 'auto',
    name: opts.name,
    noHarness: true,
  })
  const portable = await embedPortableFiles(pack as PackDoc, cwd)
  const exportsDir = join(cwd, '.ccui', 'exports')
  await fs.mkdir(exportsDir, { recursive: true })
  const name = portable.name || opts.name || 'portable-pack'
  const path = join(exportsDir, `${name}.portable.pack.json`)
  await fs.writeFile(path, JSON.stringify(portable, null, 2), 'utf8')
  return { path, pack: portable }
}

export function catalogForRuntime(entries: CatalogEntry[], runtimeId: string | 'all'): CatalogEntry[] {
  if (runtimeId === 'all') return entries
  return entries.filter(e => e.runtime === runtimeId || e.type === 'runtime-import' && e.runtime === runtimeId)
}

export { RUNTIME_ADAPTERS }
