import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getAutoMemPath } from '../../memdir/paths.js'
import { logForDebugging } from '../../utils/debug.js'

export type MemoryRelation = {
  target: string
  relation: string
}

export type MemoryGraphNode = {
  id: string
  entity: string
  type: 'fact' | 'preference' | 'decision' | 'reference' | 'correction'
  content: string
  confidence: number
  createdAt: string
  updatedAt: string
  source?: string
  relations: MemoryRelation[]
}

export type MemoryGraphFile = {
  version: 1
  nodes: MemoryGraphNode[]
}

const GRAPH_NAME = 'graph.json'

function graphPath(): string {
  return `${getAutoMemPath()}/${GRAPH_NAME}`
}

export async function loadMemoryGraph(): Promise<MemoryGraphFile> {
  try {
    const raw = await readFile(graphPath(), 'utf8')
    const parsed = JSON.parse(raw) as MemoryGraphFile
    if (parsed?.version === 1 && Array.isArray(parsed.nodes)) {
      return parsed
    }
  } catch {
    // fresh graph
  }
  return { version: 1, nodes: [] }
}

export async function saveMemoryGraph(graph: MemoryGraphFile): Promise<void> {
  const path = graphPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
}

function slugId(entity: string): string {
  return entity
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function upsertGraphNode(
  graph: MemoryGraphFile,
  input: {
    entity: string
    type: MemoryGraphNode['type']
    content: string
    confidence: number
    source?: string
    relations?: MemoryRelation[]
  },
): MemoryGraphNode {
  const now = new Date().toISOString()
  const id = slugId(input.entity) || `node-${Date.now()}`
  const existing = graph.nodes.find(n => n.id === id)
  if (existing) {
    existing.content = input.content
    existing.type = input.type
    existing.confidence = Math.max(existing.confidence, input.confidence)
    existing.updatedAt = now
    if (input.source) existing.source = input.source
    if (input.relations?.length) {
      const seen = new Set(existing.relations.map(r => `${r.target}:${r.relation}`))
      for (const rel of input.relations) {
        const key = `${rel.target}:${rel.relation}`
        if (!seen.has(key)) existing.relations.push(rel)
      }
    }
    return existing
  }
  const node: MemoryGraphNode = {
    id,
    entity: input.entity,
    type: input.type,
    content: input.content,
    confidence: input.confidence,
    createdAt: now,
    updatedAt: now,
    source: input.source,
    relations: input.relations ?? [],
  }
  graph.nodes.push(node)
  if (graph.nodes.length > 500) {
    graph.nodes.sort((a, b) => b.confidence - a.confidence)
    graph.nodes.length = 500
  }
  return node
}

/** 从查询文本匹配图谱实体，返回加权关键词 */
export function graphEntityBoosts(
  query: string,
  graph: MemoryGraphFile,
): Map<string, number> {
  const q = query.toLowerCase()
  const boosts = new Map<string, number>()
  for (const node of graph.nodes) {
    const entity = node.entity.toLowerCase()
    const content = node.content.toLowerCase()
    let score = 0
    if (entity.length >= 2 && q.includes(entity)) {
      score += 0.35 * node.confidence
    }
    const tokens = content.split(/\s+/).filter(t => t.length >= 4)
    for (const t of tokens.slice(0, 12)) {
      if (q.includes(t)) score += 0.04 * node.confidence
    }
    if (score > 0) {
      boosts.set(node.entity, score)
    }
  }
  return boosts
}

export function graphHitsForQuery(
  query: string,
  graph: MemoryGraphFile,
): string[] {
  const boosts = graphEntityBoosts(query, graph)
  return [...boosts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([entity]) => entity)
}

/**
 * 从用户/助手文本抽取简单结构化事实（轻量规则，不额外调模型）。
 */
export function extractGraphCandidatesFromText(
  text: string,
  source: string,
): Array<Omit<Parameters<typeof upsertGraphNode>[1], 'relations'>> {
  const trimmed = text.trim()
  if (trimmed.length < 8) return []

  const out: Array<Omit<Parameters<typeof upsertGraphNode>[1], 'relations'>> = []

  const preferPatterns: Array<{
    re: RegExp
    type: MemoryGraphNode['type']
    confidence: number
  }> = [
    { re: /(?:我偏好|我喜欢|我习惯|prefer|I prefer)\s*[：:]\s*(.+)/i, type: 'preference', confidence: 0.82 },
    { re: /(?:请记住|记得|remember)\s*[：:]\s*(.+)/i, type: 'fact', confidence: 0.9 },
    { re: /(?:不要|禁止|别|never|do not)\s+(.+)/i, type: 'correction', confidence: 0.88 },
    { re: /(?:决定|采用|就用|use)\s+(.+)/i, type: 'decision', confidence: 0.75 },
  ]

  for (const line of trimmed.split('\n').slice(0, 20)) {
    const l = line.trim()
    if (l.length < 6) continue
    for (const p of preferPatterns) {
      const m = l.match(p.re)
      if (m?.[1]) {
        const content = m[1].trim().slice(0, 400)
        out.push({
          entity: content.slice(0, 48),
          type: p.type,
          content,
          confidence: p.confidence,
          source,
        })
        break
      }
    }
  }

  if (out.length === 0 && trimmed.length >= 24 && trimmed.length <= 280) {
    out.push({
      entity: trimmed.slice(0, 48),
      type: 'reference',
      content: trimmed.slice(0, 400),
      confidence: 0.55,
      source,
    })
  }

  return out.slice(0, 4)
}

export async function persistGraphCandidates(
  candidates: Array<Omit<Parameters<typeof upsertGraphNode>[1], 'relations'>>,
): Promise<number> {
  if (candidates.length === 0) return 0
  const graph = await loadMemoryGraph()
  for (const c of candidates) {
    upsertGraphNode(graph, c)
  }
  await saveMemoryGraph(graph)
  logForDebugging(`[ccui] graph upsert ${candidates.length} node(s)`, {
    level: 'debug',
  })
  return candidates.length
}
