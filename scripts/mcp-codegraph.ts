#!/usr/bin/env bun
/** Portable codegraph MCP — repo root from this file, no hardcoded paths. */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, CODEGRAPH_NO_DAEMON: process.env.CODEGRAPH_NO_DAEMON ?? '1' }
const r = spawnSync('codegraph', ['serve', '--mcp', '--path', root], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
})
process.exit(r.status ?? (r.signal ? 1 : 0))
