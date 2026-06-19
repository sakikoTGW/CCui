#!/usr/bin/env bun
/**
 * 构建 Rust 原生项目索引器（crates/ccui-indexer）。
 *
 * 非致命：cargo 缺失或构建失败时仅警告并 exit 0——daemon 的 projectIndexer
 * 门面会自动回退到 TS 慢路径，"双击即用"不受影响。装了 Rust 的用户跑一次
 * `bun run build:indexer` 即获全树并行索引（解除 350 文件封顶）。
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const crateDir = join(root, 'crates', 'ccui-indexer')

const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: true })
if (probe.status !== 0) {
  console.warn('[build:indexer] cargo 未安装，跳过原生索引器构建（daemon 用 TS 慢路径兜底）。')
  console.warn('[build:indexer] 安装 Rust 后重跑 `bun run build:indexer` 可获全树并行索引。')
  process.exit(0)
}

console.log('[build:indexer] cargo build --release ...')
const build = spawnSync('cargo', ['build', '--release'], {
  cwd: crateDir,
  stdio: 'inherit',
  shell: true,
})

if (build.status !== 0) {
  console.warn('[build:indexer] 构建失败（非致命）：daemon 将回退 TS 慢路径。')
  process.exit(0)
}

const exe = process.platform === 'win32' ? 'ccui-indexer.exe' : 'ccui-indexer'
console.log(`[build:indexer] OK → ${join(crateDir, 'target', 'release', exe)}`)
