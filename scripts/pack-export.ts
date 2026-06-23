#!/usr/bin/env bun
/**
 * ccui-pack 万能导出器（确定性，不靠 LLM 猜）：把"任意运行时的当前 agent"打成整合包。
 *
 *  L1（你装的，文件扫描）：skills / rules / MCP —— 按运行时适配表扫描（CCui / Claude Code /
 *                          Cursor / Codex / opencode / AstrBot / 通用）。见 runtimeAdapters.ts。
 *  L2（引擎的，抓包蒸馏）：base prompt / 工具 schema / system-reminder
 *                          —— 取 .ccui/packs 下最新抓包草稿合并（可选）。
 *
 * 供 .claude/skills/ccui-pack-self 技能调用，让 agent 自打包。规范见 docs/PACK_SPEC.md。
 *
 * 用法：
 *   bun scripts/pack-export.ts [--runtime auto|ccui|cursor|codex|opencode|claude-code|astrbot|generic-agents]
 *                              [--name <名>] [--out <路径>] [--harness <pack.json>] [--no-harness]
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RUNTIME_ADAPTERS,
  detectRuntimes,
  getAdapter,
  scanRuntime,
  scanUniversal,
  type RuntimeScan,
} from '../services/proxy/runtimeAdapters.js'

const _root = join(dirname(fileURLToPath(import.meta.url)), '..')

type Arg = { runtime?: string; name?: string; out?: string; harness?: string; noHarness?: boolean }
function parseArgs(argv: string[]): Arg {
  const a: Arg = {}
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--runtime') a.runtime = argv[++i]
    else if (t === '--name') a.name = argv[++i]
    else if (t === '--out') a.out = argv[++i]
    else if (t === '--harness') a.harness = argv[++i]
    else if (t === '--no-harness') a.noHarness = true
  }
  return a
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T
  } catch {
    return null
  }
}

async function latestHarnessDraft(cwd: string): Promise<{ file: string; pack: Record<string, unknown> } | null> {
  const dir = join(cwd, '.ccui', 'packs')
  let names: string[] = []
  try {
    names = (await fs.readdir(dir)).filter(n => n.endsWith('.pack.json'))
  } catch {
    return null
  }
  if (names.length === 0) return null
  const withTime = await Promise.all(
    names.map(async n => ({ n, mtime: (await fs.stat(join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })),
  )
  withTime.sort((x, y) => y.mtime - x.mtime)
  const file = join(dir, withTime[0].n)
  const pack = await readJson<Record<string, unknown>>(file)
  return pack ? { file, pack } : null
}

/**
 * 选定运行时：显式 --runtime；否则 auto。
 * auto 优先用检测到的"已核实"运行时；只剩通用兜底或没检测到 → 用 universal 深度扫描。
 */
async function resolveRuntime(cwd: string, arg?: string): Promise<{ id: string; detected: string[] }> {
  const detected = await detectRuntimes(cwd)
  if (arg && arg !== 'auto') return { id: arg, detected }
  const verified = detected.find(id => {
    const a = getAdapter(id)
    return a?.verified
  })
  return { id: verified ?? 'universal', detected }
}

export async function buildPack(
  cwd: string,
  opts: Arg = {},
): Promise<{ pack: Record<string, unknown>; outPath: string; stats: Record<string, unknown>; scan: RuntimeScan }> {
  const { id: runtimeId, detected } = await resolveRuntime(cwd, opts.runtime)

  let scan: RuntimeScan
  let runtimeInfo: { id: string; label: string; verified: boolean }
  if (runtimeId === 'universal') {
    scan = await scanUniversal(cwd)
    runtimeInfo = { id: 'universal', label: '通用（深度扫描）', verified: false }
  } else {
    const adapter = getAdapter(runtimeId)
    if (!adapter) {
      throw new Error(`未知运行时 "${runtimeId}"。可选：${RUNTIME_ADAPTERS.map(a => a.id).join(', ')}, universal`)
    }
    scan = await scanRuntime(cwd, adapter)
    runtimeInfo = { id: adapter.id, label: adapter.label, verified: adapter.verified }
  }
  const name = opts.name || `${basename(cwd) || 'agent'}-${runtimeInfo.id}`

  // L2 harness
  let harness: Record<string, unknown> = { base_system_prompt: '', tool_schemas: [], system_reminders: [] }
  let assembly: Record<string, unknown> = {
    wire_format: 'unknown', system_is_array: false, cache_breakpoints: 0,
    file_wrapper: null, message_count: 0, order_hint: ['system', 'history'],
  }
  let model: Record<string, unknown> = { name: process.env.ANTHROPIC_MODEL || 'unknown', params: {} }
  let fidelity = 'L1'
  let harnessFrom: string | null = null

  if (!opts.noHarness) {
    let draftPack: Record<string, unknown> | null = null
    if (opts.harness) {
      draftPack = await readJson<Record<string, unknown>>(opts.harness)
      harnessFrom = opts.harness
    } else {
      const latest = await latestHarnessDraft(cwd)
      if (latest) {
        draftPack = latest.pack
        harnessFrom = latest.file
      }
    }
    if (draftPack) {
      if (draftPack.harness) harness = draftPack.harness as Record<string, unknown>
      if (draftPack.assembly) assembly = draftPack.assembly as Record<string, unknown>
      if (draftPack.model) model = draftPack.model as Record<string, unknown>
      fidelity = 'L2'
    }
  }

  const pack = {
    schema: 'ccui-pack/v0.1',
    name,
    version: '0.1.0',
    runtime: runtimeInfo,
    knowledge: {
      skills: scan.skills.map(s => ({ name: s.name, source: 'path', ref: s.ref, scope: s.scope })),
      rules: scan.rules.map(r => ({ name: r.name, format: r.format, ref: r.ref, scope: r.scope })),
    },
    tools: {
      mcp: scan.mcp,
      builtin_map: [],
    },
    harness,
    assembly,
    model,
    loop: { maxTurns: null, planning: null, subagents: null, hooks: [] },
    meta: {
      capturedAt: new Date().toISOString(),
      source: harnessFrom ? 'wire+filesystem' : 'filesystem',
      capturedFrom: harnessFrom,
      detectedRuntimes: detected,
      sameModel: null,
      fidelity,
    },
  }

  const outPath = opts.out || join(cwd, '.ccui', 'exports', `${name}.pack.json`)
  const stats = {
    runtime: runtimeInfo.id,
    runtimeVerified: runtimeInfo.verified,
    detected,
    name,
    skills: scan.skills.length,
    rules: scan.rules.length,
    mcp: scan.mcp.length,
    tools: (harness.tool_schemas as unknown[] | undefined)?.length ?? 0,
    basePromptLen: (harness.base_system_prompt as string | undefined)?.length ?? 0,
    fidelity,
    harnessFrom: harnessFrom ?? '(none)',
  }
  return { pack, outPath, stats, scan }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const { pack, outPath, stats } = await buildPack(cwd, opts)
  await fs.mkdir(dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, JSON.stringify(pack, null, 2), 'utf8')
  console.error('[pack-export] 整合包已导出')
  console.error(`  runtime     ${stats.runtime}${stats.runtimeVerified ? '' : ' (unverified)'}`)
  console.error(`  detected    ${(stats.detected as string[]).join(', ') || '(none)'}`)
  console.error(`  out         ${outPath}`)
  console.error(`  name        ${stats.name}`)
  console.error(`  skills      ${stats.skills}`)
  console.error(`  rules       ${stats.rules}`)
  console.error(`  mcp         ${stats.mcp}`)
  console.error(`  harness     base_prompt=${stats.basePromptLen}ch tools=${stats.tools}`)
  console.error(`  fidelity    ${stats.fidelity}  (harness from: ${stats.harnessFrom})`)
}

if (import.meta.main) {
  await main()
}
