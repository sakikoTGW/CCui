/**
 * 整合包门面 — 导出 / 列表 / 读取 / ccui-bundle v1
 */
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { buildPack } from '../../scripts/pack-export.js'
import { applyPack, applyPackFile, readPackFile, type PackDoc } from './packApply.js'
import { loadProjectConfig, loadContribConfig } from './projectConfig.js'
import { analyzePortability, type CcuiBinding } from './ccuiBinding.js'

export type PackListItem = {
  path: string
  name: string
  kind: 'export' | 'capture' | 'external'
  mtimeMs: number
  fidelity?: string
  skills?: number
  rules?: number
  mcp?: number
  binding?: 'portable-L1' | 'ccui-native'
}

async function statMtime(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).mtimeMs
  } catch {
    return 0
  }
}

async function scanDir(dir: string, kind: PackListItem['kind']): Promise<PackListItem[]> {
  let names: string[] = []
  try {
    names = (await fs.readdir(dir)).filter(n => n.endsWith('.pack.json'))
  } catch {
    return []
  }
  const out: PackListItem[] = []
  for (const n of names) {
    const path = join(dir, n)
    let meta: PackDoc | null = null
    try {
      meta = await readPackFile(path)
    } catch { /* ignore */ }
    const port = analyzePortability(meta?.ccui)
    out.push({
      path,
      name: meta?.name || n.replace(/\.pack\.json$/, ''),
      kind,
      mtimeMs: await statMtime(path),
      fidelity: meta?.meta?.fidelity,
      skills: meta?.knowledge?.skills?.length,
      rules: meta?.knowledge?.rules?.length,
      mcp: meta?.tools?.mcp?.length,
      binding: port.binding,
    })
  }
  return out
}

export async function listPacks(cwd: string): Promise<PackListItem[]> {
  const items = [
    ...(await scanDir(join(cwd, '.ccui', 'exports'), 'export')),
    ...(await scanDir(join(cwd, '.ccui', 'packs'), 'capture')),
    ...(await scanDir(join(cwd, '.ccui', 'imports'), 'external')),
  ]
  items.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return items
}

/** 从项目配置 + 默认安全策略派生 CCui 行为契约（让导出的包默认 ccui-native）。 */
async function deriveBinding(cwd: string): Promise<CcuiBinding> {
  const cfg = await loadProjectConfig(cwd)
  const binding: CcuiBinding = {
    bindingVersion: '1',
    review: {
      // 默认护城河策略：写盘/执行类强制审查；只读放行；Bash 高风险禁批量
      forceAsk: ['Bash', 'Write', 'Edit', 'MultiEdit'],
      highRisk: ['Bash'],
      autoAllow: ['Read', 'Glob', 'Grep', 'LS'],
    },
    loop: { maxTurns: 32 },
  }
  if (cfg?.router && (cfg.router.mode || cfg.router.strongModel || cfg.router.weakModel)) {
    const mode = cfg.router.mode
    binding.router = {
      mode: mode === 'auto' || mode === 'strong-only' || mode === 'weak-only' ? mode : undefined,
      strongModel: cfg.router.strongModel,
      weakModel: cfg.router.weakModel,
    }
  }
  if (cfg?.verify && (cfg.verify.onDone?.length || cfg.verify.smoke?.length)) {
    binding.verify = { onDone: cfg.verify.onDone, smoke: cfg.verify.smoke }
  }
  return binding
}

export async function exportPack(
  cwd: string,
  opts: { runtime?: string; name?: string; noHarness?: boolean; bindCcui?: boolean } = {},
): Promise<{ path: string; pack: PackDoc; stats: Record<string, unknown> }> {
  const { pack, outPath, stats } = await buildPack(cwd, {
    runtime: opts.runtime || 'auto',
    name: opts.name,
    noHarness: opts.noHarness,
  })
  const doc = pack as PackDoc
  if (opts.bindCcui !== false) {
    doc.ccui = await deriveBinding(cwd)
    const port = analyzePortability(doc.ccui)
    doc.meta = { ...doc.meta, binding: port.binding }
    ;(stats as Record<string, unknown>).binding = port.binding
    ;(stats as Record<string, unknown>).bound = port.bound
  }
  await fs.mkdir(join(cwd, '.ccui', 'exports'), { recursive: true })
  await fs.writeFile(outPath, JSON.stringify(doc, null, 2), 'utf8')
  return { path: outPath, pack: doc, stats }
}

export async function buildBundle(cwd: string, workspace?: unknown): Promise<Record<string, unknown>> {
  const { pack } = await exportPack(cwd, { runtime: 'auto' })
  const project = await loadProjectConfig(cwd)
  const contrib = await loadContribConfig(cwd)
  return {
    schema: 'ccui-bundle/v1',
    exportedAt: new Date().toISOString(),
    projectRoot: cwd.replace(/\\/g, '/'),
    pack,
    project,
    contrib,
    workspace: workspace ?? null,
  }
}

export { applyPack, applyPackFile, readPackFile }

export function packBasename(path: string): string {
  return basename(path)
}
