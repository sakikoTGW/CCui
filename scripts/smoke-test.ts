#!/usr/bin/env bun
/**
 * 端到端冒烟测试 — 全部通过才算「跑通」
 * 用法: bun scripts/smoke-test.ts
 * 需要 ANTHROPIC_API_KEY（DeepSeek Key 亦可）
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from './loadEnv.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
const bun = process.execPath

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('❌ 请设置 ANTHROPIC_API_KEY')
  process.exit(1)
}

const baseEnv: Record<string, string> = {
  ...process.env,
  CLAUDE_CODE_DEV: '1',
  ANTHROPIC_API_KEY: apiKey,
  ANTHROPIC_BASE_URL:
    process.env.ANTHROPIC_BASE_URL ?? 'https://api.deepseek.com/anthropic',
}

type Case = {
  name: string
  args: string[]
  env?: Record<string, string>
  expectInOutput?: string[]
  expectExit?: number
  timeoutMs?: number
}

function runCase(c: Case): { ok: boolean; detail: string } {
  const env = { ...baseEnv, ...c.env }
  const r = spawnSync(
    bun,
    ['--define', 'MACRO.VERSION="2.0.0-dev"', join(root, 'src/entrypoints/cli.tsx'), ...c.args],
    {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: c.timeoutMs ?? 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const code = r.status ?? (r.signal ? 1 : 0)
  const expectExit = c.expectExit ?? 0

  if (code !== expectExit) {
    return {
      ok: false,
      detail: `exit ${code}, expected ${expectExit}\n${out.slice(0, 800)}`,
    }
  }
  for (const needle of c.expectInOutput ?? []) {
    if (!out.includes(needle)) {
      return { ok: false, detail: `missing "${needle}"\n${out.slice(0, 800)}` }
    }
  }
  return { ok: true, detail: `${(out.match(/\S/g) ?? []).length > 0 ? 'ok' : 'empty ok'}` }
}

const cases: Case[] = [
  {
    name: 'CLI --help',
    args: ['--help'],
    expectInOutput: ['Claude Code', '--print'],
    timeoutMs: 60_000,
  },
  {
    name: 'CLI --version',
    args: ['--version'],
    expectInOutput: ['2.0.0-dev'],
    timeoutMs: 60_000,
  },
  {
    name: 'DeepSeek ask（轻量）',
    args: [],
    env: {},
    expectExit: 0,
    timeoutMs: 60_000,
  },
  {
    name: 'CCui print --bare',
    args: ['--bare', '-p', '回复一个字：好', '--model', 'deepseek-v4-flash'],
    expectInOutput: ['好'],
    timeoutMs: 120_000,
  },
]

// ask 走独立脚本
function runAsk(): { ok: boolean; detail: string } {
  const r = spawnSync(bun, [join(root, 'scripts/deepseek-ask.ts'), '1+1=?'], {
    cwd: root,
    env: baseEnv,
    encoding: 'utf8',
    timeout: 60_000,
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status !== 0) return { ok: false, detail: out.slice(0, 500) }
  if (!/2|two/i.test(out)) return { ok: false, detail: `unexpected: ${out.slice(0, 200)}` }
  return { ok: true, detail: 'ok' }
}

console.log('CCui 冒烟测试开始…\n')
let failed = 0

for (const c of cases.filter(x => x.name !== 'DeepSeek ask（轻量）')) {
  process.stdout.write(`  ${c.name} … `)
  const r = runCase(c)
  if (r.ok) {
    console.log('✅')
  } else {
    console.log('❌')
    console.log(`    ${r.detail}\n`)
    failed++
  }
}

process.stdout.write('  DeepSeek ask（轻量） … ')
const ask = runAsk()
console.log(ask.ok ? '✅' : '❌')
if (!ask.ok) {
  console.log(`    ${ask.detail}\n`)
  failed++
}

console.log('')
if (failed > 0) {
  console.error(`❌ ${failed} 项失败`)
  process.exit(1)
}
console.log('✅ 全部通过。交互 REPL 请在真实终端运行: bun run start')
