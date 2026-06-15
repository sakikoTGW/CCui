#!/usr/bin/env bun
/** 自动补全缺失依赖并尝试启动 CLI */
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bun = process.execPath
const args = process.argv.slice(2)
const cliArgs = args.length ? args : ['--help']

function normalizePkg(raw: string): string | null {
  if (raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('@ant/')) {
    return null
  }
  if (raw.startsWith('@')) {
    const parts = raw.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : raw
  }
  return raw.split('/')[0] ?? raw
}

function runCli(): { ok: boolean; missing?: string; output: string } {
  const r = spawnSync(
    bun,
    ['--define', 'MACRO.VERSION="2.0.0-dev"', join(root, 'src/entrypoints/cli.tsx'), ...cliArgs],
    { cwd: root, encoding: 'utf8' },
  )
  const output = (r.stdout ?? '') + (r.stderr ?? '')
  if (r.status === 0) return { ok: true, output }
  const m = output.match(/Cannot find (?:package|module) '([^']+)'/)
  if (m) {
    const pkg = normalizePkg(m[1])
    if (!pkg) return { ok: false, output }
    return { ok: false, missing: pkg, output }
  }
  return { ok: false, output }
}

for (let i = 0; i < 80; i++) {
  const result = runCli()
  if (result.ok) {
    process.stdout.write(result.output)
    process.exit(0)
  }
  if (result.missing) {
    console.error(`[${i + 1}] installing ${result.missing}...`)
    const install = spawnSync(bun, ['add', result.missing], { cwd: root, stdio: 'inherit' })
    if (install.status !== 0) {
      console.error(`Failed to install ${result.missing}`)
      process.exit(1)
    }
    continue
  }
  console.error(result.output)
  process.exit(1)
}

console.error('Too many missing dependencies')
process.exit(1)
