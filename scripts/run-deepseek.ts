#!/usr/bin/env bun
/**
 * DeepSeek + 完整 CCui CLI（交互 REPL 带进度条）
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from './loadEnv.js'
import {
  createStartupProgressBar,
  feedProgressLine,
  type StartupProgressBar,
} from './startup-progress.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
const args = process.argv.slice(2)
const passthrough = args[0] === '--' ? args.slice(1) : args

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('请设置 ANTHROPIC_API_KEY（DeepSeek API Key）')
  process.exit(1)
}

const env: Record<string, string | undefined> = {
  ...process.env,
  CLAUDE_CODE_DEV: '1',
  CCUI_MEMORY: '1',
  CCUI_STACK: '1',
  ANTHROPIC_BASE_URL:
    process.env.ANTHROPIC_BASE_URL ?? 'https://api.deepseek.com/anthropic',
}

const cliArgs = passthrough.length ? passthrough : []
const isPrintMode =
  cliArgs.includes('-p') ||
  cliArgs.includes('--print') ||
  cliArgs.some(a => a.startsWith('-p') && a.length > 2)

const bunCli = [
  '--define',
  'MACRO.VERSION="2.0.0-dev"',
  join(root, 'src/entrypoints/cli.tsx'),
  ...cliArgs,
]

function drainProgressLines(text: string, bar: StartupProgressBar): void {
  for (const line of text.split('\n')) {
    if (feedProgressLine(line, bar) === 'ignore' && line.trim()) {
      process.stderr.write(`${line}\n`)
    }
  }
}

console.error('DeepSeek 模式启动 CCui…')
console.error('[1/3] 准备开发环境配置…')

spawnSync(
  process.execPath,
  ['--define', 'MACRO.VERSION="2.0.0-dev"', join(root, 'scripts/seed-dev.ts')],
  { cwd: root, env, stdio: 'ignore', shell: false },
)

if (isPrintMode) {
  const result = spawnSync(process.execPath, bunCli, {
    stdio: ['ignore', 'inherit', 'inherit'],
    cwd: root,
    env,
    shell: false,
  })
  process.exit(result.status ?? 1)
}

const bar = createStartupProgressBar()
bar.update(5, '准备启动…')

console.error('[2/3] 预热界面模块（首次约 1-3 分钟）…')
bar.update(8, '预热 App/REPL 模块…')
const warm = spawnSync(
  process.execPath,
  [
    '--define',
    'MACRO.VERSION="2.0.0-dev"',
    join(root, 'scripts/warm-repl-cache.ts'),
  ],
  { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false },
)
if (warm.stderr?.length) {
  drainProgressLines(warm.stderr.toString(), bar)
}
if (warm.status !== 0) {
  bar.stop()
  if (warm.stderr?.length) process.stderr.write(warm.stderr.toString())
  process.exit(warm.status ?? 1)
}

console.error('[3/3] 启动交互界面…')
bar.update(18, '启动 CLI…')

let buf = ''
const onStderrChunk = (chunk: Buffer | string): void => {
  buf += chunk.toString()
  let nl = buf.indexOf('\n')
  while (nl !== -1) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    feedProgressLine(line, bar)
    nl = buf.indexOf('\n')
  }
}

const child: ChildProcess = spawn(process.execPath, bunCli, {
  cwd: root,
  env,
  shell: false,
  stdio: ['inherit', 'inherit', 'pipe'],
})

child.stderr?.on('data', onStderrChunk)

child.on('close', (code, signal) => {
  if (signal) {
    bar.stop()
    process.exit(1)
  }
  if (code !== 0 && code !== null) {
    bar.stop()
  }
  process.exit(code ?? 1)
})

child.on('error', err => {
  bar.stop()
  console.error(err.message)
  process.exit(1)
})
