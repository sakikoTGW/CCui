/**
 * 源码 TF-IDF 索引 — 供 @ 补全 / 语义搜文件（B2）。
 * 缓存于 `.ccui/code-index.json`；构建时扫描 projectGraph 文件节点。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { scanProjectGraph } from './projectIndexer.js'

export type CodeChunk = {
  rel: string
  path: string
  text: string
}

export type CodeIndex = {
  version: 1
  builtAt: string
  cwd: string
  chunks: CodeChunk[]
  idf: Record<string, number>
  docCount: number
}

export type CodeSearchHit = {
  rel: string
  path: string
  snippet: string
  score: number
}

const INDEX_REL = join('.ccui', 'code-index.json')
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.md', '.json', '.yaml', '.yml'])
const MAX_FILES = 4000
const MAX_CHARS = 12_000

function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const words = lower.match(/[a-z0-9_\u4e00-\u9fff]{2,}/g) ?? []
  return [...new Set(words)]
}

function indexPath(cwd: string): string {
  return join(cwd, INDEX_REL)
}

async function readFileSafe(p: string): Promise<string> {
  try {
    const raw = await fs.readFile(p, 'utf8')
    return raw.slice(0, MAX_CHARS)
  } catch {
    return ''
  }
}

function relPath(cwd: string, p: string): string {
  const n = p.replace(/\\/g, '/')
  const root = cwd.replace(/\\/g, '/').replace(/\/$/, '')
  return n.startsWith(root + '/') ? n.slice(root.length + 1) : n
}

export async function loadCodeIndex(cwd: string): Promise<CodeIndex | null> {
  try {
    const raw = await fs.readFile(indexPath(cwd), 'utf8')
    const j = JSON.parse(raw) as CodeIndex
    if (j?.version === 1 && j.cwd === cwd.replace(/\\/g, '/')) return j
  } catch { /* miss */ }
  return null
}

export async function buildCodeIndex(cwd: string): Promise<CodeIndex> {
  const graph = await scanProjectGraph(cwd)
  const files = graph.nodes
    .filter(n => n.kind === 'file')
    .slice(0, MAX_FILES)

  const chunks: CodeChunk[] = []
  const df = new Map<string, number>()

  for (const f of files) {
    const norm = f.path.replace(/\\/g, '/')
    const absPath = /^[a-zA-Z]:/.test(norm) || norm.startsWith('/') ? norm : join(cwd, norm)
    const text = await readFileSafe(absPath)
    if (!text.trim()) continue
    const rel = f.label || relPath(cwd, absPath)
    const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.')) : ''
    if (!CODE_EXT.has(ext) && !/\.(ts|tsx|js|jsx|md)$/.test(rel)) continue
    chunks.push({ rel, path: absPath, text })
    const seen = new Set<string>()
    for (const tok of tokenize(text)) {
      if (!seen.has(tok)) {
        seen.add(tok)
        df.set(tok, (df.get(tok) ?? 0) + 1)
      }
    }
  }

  const docCount = Math.max(chunks.length, 1)
  const idf: Record<string, number> = {}
  for (const [tok, d] of df) {
    idf[tok] = Math.log((docCount + 1) / (d + 1)) + 1
  }

  const index: CodeIndex = {
    version: 1,
    builtAt: new Date().toISOString(),
    cwd: cwd.replace(/\\/g, '/'),
    chunks,
    idf,
    docCount,
  }

  try {
    await fs.mkdir(join(cwd, '.ccui'), { recursive: true })
    await fs.writeFile(indexPath(cwd), JSON.stringify(index), 'utf8')
  } catch { /* optional cache */ }

  process.stderr.write(`[codeIndexer] built ${chunks.length} chunks\n`)
  return index
}

function scoreChunk(chunk: CodeChunk, query: string, idf: Record<string, number>): number {
  const qToks = tokenize(query)
  if (!qToks.length) return 0
  const docToks = tokenize(chunk.text)
  const tf = new Map<string, number>()
  for (const t of docToks) tf.set(t, (tf.get(t) ?? 0) + 1)
  let s = 0
  for (const qt of qToks) {
    const c = tf.get(qt) ?? 0
    if (!c) continue
    s += (1 + Math.log(c)) * (idf[qt] ?? 1)
    if (chunk.rel.toLowerCase().includes(qt)) s += 2
  }
  return s
}

export async function searchCode(cwd: string, query: string, limit = 12): Promise<CodeSearchHit[]> {
  let index = await loadCodeIndex(cwd)
  if (!index || index.chunks.length < 10) {
    index = await buildCodeIndex(cwd)
  }
  const q = query.trim()
  if (!q) {
    return index.chunks.slice(0, limit).map(c => ({
      rel: c.rel,
      path: c.path,
      snippet: c.text.slice(0, 120).replace(/\s+/g, ' '),
      score: 0,
    }))
  }
  const ranked = index.chunks
    .map(c => ({ c, score: scoreChunk(c, q, index!.idf) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  return ranked.map(({ c, score }) => ({
    rel: c.rel,
    path: c.path,
    snippet: c.text.slice(0, 160).replace(/\s+/g, ' '),
    score,
  }))
}
