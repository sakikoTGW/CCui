import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join, relative } from 'path'
import Fuse from 'fuse.js'
import type { MemoryHeader } from '../../memdir/memoryScan.js'
import { CCUI_MEMORY_LIMITS } from './config.js'
import { loadMemoryGraph, graphEntityBoosts } from './memoryGraph.js'

export type IndexedChunk = {
  filePath: string
  relativePath: string
  chunkIndex: number
  text: string
  mtimeMs: number
}

type VectorIndexFile = {
  version: 1
  builtAt: string
  chunks: IndexedChunk[]
  idf: Record<string, number>
  docCount: number
}

const INDEX_PATH_SUFFIX = '.ccui-vector-index.json'

function indexPath(memoryDir: string): string {
  return join(memoryDir, INDEX_PATH_SUFFIX)
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const words = lower.match(/[a-z0-9\u4e00-\u9fff]{2,}/g) ?? []
  return [...new Set(words)]
}

function chunkText(text: string): string[] {
  const { CHUNK_SIZE, CHUNK_OVERLAP } = CCUI_MEMORY_LIMITS
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + CHUNK_SIZE))
    if (i + CHUNK_SIZE >= text.length) break
    i += CHUNK_SIZE - CHUNK_OVERLAP
  }
  return chunks
}

async function readMemoryBody(filePath: string, maxChars = 24_000): Promise<string> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return raw.slice(0, maxChars)
  } catch {
    return ''
  }
}

async function buildIndex(memoryDir: string, headers: MemoryHeader[]): Promise<VectorIndexFile> {
  const chunks: IndexedChunk[] = []
  const df = new Map<string, number>()

  for (const h of headers) {
    const body = await readMemoryBody(h.filePath)
    if (!body) continue
    const rel = relative(memoryDir, h.filePath).replace(/\\/g, '/')
    const parts = chunkText(body)
    const seenTokens = new Set<string>()
    for (let i = 0; i < parts.length; i++) {
      chunks.push({
        filePath: h.filePath,
        relativePath: rel,
        chunkIndex: i,
        text: parts[i]!,
        mtimeMs: h.mtimeMs,
      })
      for (const tok of tokenize(parts[i]!)) {
        if (!seenTokens.has(tok)) {
          seenTokens.add(tok)
          df.set(tok, (df.get(tok) ?? 0) + 1)
        }
      }
    }
  }

  const docCount = Math.max(chunks.length, 1)
  const idf: Record<string, number> = {}
  for (const [tok, count] of df) {
    idf[tok] = Math.log(1 + docCount / count)
  }

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    chunks,
    idf,
    docCount,
  }
}

async function loadOrBuildIndex(
  memoryDir: string,
  headers: MemoryHeader[],
): Promise<VectorIndexFile> {
  const path = indexPath(memoryDir)
  const newest = headers.reduce((m, h) => Math.max(m, h.mtimeMs), 0)
  try {
    const raw = await readFile(path, 'utf8')
    const cached = JSON.parse(raw) as VectorIndexFile
    const built = Date.parse(cached.builtAt)
    if (
      cached.version === 1 &&
      Array.isArray(cached.chunks) &&
      built >= newest - 1000
    ) {
      return cached
    }
  } catch {
    // rebuild
  }
  const built = await buildIndex(memoryDir, headers)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(built), 'utf8')
  return built
}

function cosineScore(
  queryTokens: string[],
  chunkText: string,
  idf: Record<string, number>,
): number {
  if (queryTokens.length === 0) return 0
  const chunkTokens = tokenize(chunkText)
  const chunkTf = new Map<string, number>()
  for (const t of chunkTokens) {
    chunkTf.set(t, (chunkTf.get(t) ?? 0) + 1)
  }
  let dot = 0
  let qNorm = 0
  let cNorm = 0
  for (const qt of queryTokens) {
    const qw = idf[qt] ?? 0.5
    qNorm += qw * qw
    const cf = chunkTf.get(qt) ?? 0
    if (cf > 0) {
      const cw = (1 + Math.log(cf)) * (idf[qt] ?? 0.5)
      dot += qw * cw
    }
  }
  for (const [, cf] of chunkTf) {
    const cw = 1 + Math.log(cf)
    cNorm += cw * cw
  }
  if (qNorm === 0 || cNorm === 0) return 0
  return dot / (Math.sqrt(qNorm) * Math.sqrt(cNorm))
}

export type HybridRankResult = {
  path: string
  mtimeMs: number
  score: number
  reasons: string[]
}

export async function hybridRankMemories(
  query: string,
  memoryDir: string,
  headers: MemoryHeader[],
): Promise<HybridRankResult[]> {
  if (headers.length === 0) return []

  const index = await loadOrBuildIndex(memoryDir, headers)
  const graph = await loadMemoryGraph()
  const entityBoosts = graphEntityBoosts(query, graph)
  const queryTokens = tokenize(query)

  const byFile = new Map<string, HybridRankResult>()

  for (const chunk of index.chunks) {
    const tfidf = cosineScore(queryTokens, chunk.text, index.idf)
    let score = tfidf
    const reasons: string[] = []
    if (tfidf > 0.05) reasons.push(`tfidf=${tfidf.toFixed(3)}`)

    for (const [entity, boost] of entityBoosts) {
      if (chunk.text.toLowerCase().includes(entity.toLowerCase())) {
        score += boost
        reasons.push(`graph:${entity}`)
      }
    }

    const header = headers.find(h => h.filePath === chunk.filePath)
    if (header?.description) {
      const desc = header.description.toLowerCase()
      const q = query.toLowerCase()
      if (desc && q.split(/\s+/).some(w => w.length >= 3 && desc.includes(w))) {
        score += 0.08
        reasons.push('desc-match')
      }
    }

    const ageDays = (Date.now() - chunk.mtimeMs) / 86_400_000
    if (ageDays < 7) {
      score += 0.03
      reasons.push('recent')
    }

    const prev = byFile.get(chunk.filePath)
    if (!prev || score > prev.score) {
      byFile.set(chunk.filePath, {
        path: chunk.filePath,
        mtimeMs: chunk.mtimeMs,
        score,
        reasons,
      })
    }
  }

  const fuse = new Fuse(headers, {
    keys: ['filename', 'description'],
    threshold: 0.45,
    includeScore: true,
  })
  const fuseHits = fuse.search(query, { limit: 12 })
  for (const hit of fuseHits) {
    const h = hit.item
    const fuzzy = 1 - (hit.score ?? 1)
    const existing = byFile.get(h.filePath)
    if (existing) {
      existing.score += fuzzy * 0.25
      existing.reasons.push(`fuse=${fuzzy.toFixed(3)}`)
    } else {
      byFile.set(h.filePath, {
        path: h.filePath,
        mtimeMs: h.mtimeMs,
        score: fuzzy * 0.25,
        reasons: [`fuse=${fuzzy.toFixed(3)}`],
      })
    }
  }

  return [...byFile.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, CCUI_MEMORY_LIMITS.HYBRID_CANDIDATES)
}
