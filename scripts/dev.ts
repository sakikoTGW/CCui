#!/usr/bin/env bun
/**
 * 开发启动器 — 注入原版 Bun build 才有的编译期常量。
 * 用法: bun scripts/dev.ts [claude args...]
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadDotEnv } from './loadEnv.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
const entry = join(root, 'src/entrypoints/cli.tsx')
const args = process.argv.slice(2)
const isPrintMode =
  args.includes('-p') ||
  args.includes('--print') ||
  args.some(a => a.startsWith('-p') && a.length > 2)

// Bun --define 需要 JSON 格式的值
const bunBin = process.execPath
const cmd = [
  bunBin,
  '--define',
  'MACRO.VERSION="2.0.0-dev"',
  entry,
  ...args,
]

const env = {
  ...process.env,
  CLAUDE_CODE_DEV: '1',
}

spawnSync(
  bunBin,
  ['--define', 'MACRO.VERSION="2.0.0-dev"', join(root, 'scripts/seed-dev.ts')],
  { cwd: root, env, stdio: 'ignore', shell: false },
)

const result = spawnSync(cmd[0], cmd.slice(1), {
  stdio: isPrintMode ? ['ignore', 'inherit', 'inherit'] : 'inherit',
  cwd: root,
  env,
  shell: false,
})

process.exit(result.status ?? 1)
