/**
 * 项目图索引门面 —— 单一索引入口（P7）。
 *
 * 优先路径：Rust 二进制 `crates/ccui-indexer`（gitignore-aware 并行 walk，
 * 解除 350 文件封顶，全树索引）。子进程隔离：索引器崩溃只是非零退出，
 * 由本门面捕获并回退到 TS 慢路径，绝不波及 daemon（故障隔离）。
 *
 * 缓存（.claude/ccui-project-graph.json）统一在此写入，无论走 native 还是 ts。
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { scanProjectGraphTs, type ProjectGraph } from './resources.js'

const execFileAsync = promisify(execFile)

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function nativeBinPath(): string {
  const exe = process.platform === 'win32' ? 'ccui-indexer.exe' : 'ccui-indexer'
  return join(repoRoot, 'crates', 'ccui-indexer', 'target', 'release', exe)
}

function isValidGraph(g: unknown): g is ProjectGraph {
  if (!g || typeof g !== 'object') return false
  const o = g as Record<string, unknown>
  return (
    Array.isArray(o.nodes) &&
    Array.isArray(o.edges) &&
    typeof o.summary === 'string' &&
    !!o.stats &&
    typeof o.stats === 'object'
  )
}

async function runNative(cwd: string): Promise<ProjectGraph | null> {
  const bin = nativeBinPath()
  try {
    await fs.access(bin)
  } catch {
    return null // 二进制未构建 → 静默回退
  }
  try {
    const { stdout } = await execFileAsync(
      bin,
      ['--root', cwd, '--max-files', '0'],
      { maxBuffer: 128 * 1024 * 1024, timeout: 60_000, windowsHide: true },
    )
    const graph = JSON.parse(stdout) as unknown
    if (!isValidGraph(graph)) {
      console.error('[ccui-indexer] native output invalid shape → fallback ts')
      return null
    }
    console.error(
      `[ccui-indexer] native ok files=${graph.stats.files} importEdges=${graph.stats.importEdges}`,
    )
    return graph
  } catch (e) {
    console.error(`[ccui-indexer] native failed → fallback ts: ${(e as Error).message}`)
    return null
  }
}

async function writeCache(cwd: string, graph: ProjectGraph): Promise<void> {
  try {
    await fs.mkdir(join(cwd, '.claude'), { recursive: true })
    await fs.writeFile(
      join(cwd, '.claude', 'ccui-project-graph.json'),
      JSON.stringify(graph, null, 2),
      'utf8',
    )
  } catch {
    /* optional cache */
  }
}

/**
 * 单一索引入口。native 优先，失败回退 TS 慢路径；产图后统一落缓存。
 */
export async function scanProjectGraph(cwd: string): Promise<ProjectGraph> {
  const graph = (await runNative(cwd)) ?? (await scanProjectGraphTs(cwd))
  await writeCache(cwd, graph)
  return graph
}
