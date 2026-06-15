import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import type { RelevantMemory } from '../../memdir/findRelevantMemories.js'
import {
  formatMemoryManifest,
  type MemoryHeader,
  scanMemoryFiles,
} from '../../memdir/memoryScan.js'
import { getDefaultSonnetModel } from '../../utils/model/model.js'
import { sideQuery } from '../../utils/sideQuery.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { CCUI_MEMORY_LIMITS, isCcuiMemoryEnabled } from './config.js'
import { graphHitsForQuery, loadMemoryGraph } from './memoryGraph.js'
import { recordRecall } from './recallLog.js'
import { hybridRankMemories } from './vectorIndex.js'

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories useful for the current user query.
Return up to 8 filenames from the candidate list. Prefer precision over recall.
Return JSON: {"selected_memories": ["file.md", ...]}`

async function llmRerank(
  query: string,
  candidates: MemoryHeader[],
  signal: AbortSignal,
): Promise<string[]> {
  if (candidates.length === 0) return []
  const valid = new Set(candidates.map(c => c.filename))
  const manifest = formatMemoryManifest(candidates)
  try {
    const result = await sideQuery({
      model: getDefaultSonnetModel(),
      system: SELECT_MEMORIES_SYSTEM_PROMPT,
      skipSystemPromptPrefix: true,
      messages: [
        {
          role: 'user',
          content: `Query: ${query}\n\nCandidates:\n${manifest}`,
        },
      ],
      max_tokens: 256,
      output_format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            selected_memories: { type: 'array', items: { type: 'string' } },
          },
          required: ['selected_memories'],
          additionalProperties: false,
        },
      },
      signal,
      querySource: 'ccui_memdir_relevance',
    })
    const textBlock = result.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return []
    const parsed: { selected_memories: string[] } = jsonParse(textBlock.text)
    return parsed.selected_memories.filter(f => valid.has(f))
  } catch (e) {
    if (signal.aborted) return []
    logForDebugging(`[ccui] llm rerank failed: ${errorMessage(e)}`, {
      level: 'warn',
    })
    return []
  }
}

export async function ccuiFindRelevantMemories(
  query: string,
  memoryDir: string,
  signal: AbortSignal,
  recentTools: readonly string[] = [],
  alreadySurfaced: ReadonlySet<string> = new Set(),
  sessionBytesBefore = 0,
): Promise<RelevantMemory[]> {
  if (!isCcuiMemoryEnabled()) {
    return []
  }

  const memories = (await scanMemoryFiles(memoryDir, signal)).filter(
    m => !alreadySurfaced.has(m.filePath),
  )
  if (memories.length === 0) return []

  const ranked = await hybridRankMemories(query, memoryDir, memories)
  const byFilename = new Map(memories.map(m => [m.filename, m]))
  const byPath = new Map(memories.map(m => [m.filePath, m]))

  let method: 'hybrid' | 'hybrid+llm' = 'hybrid'
  let selected: MemoryHeader[] = []

  const useLlm =
    !process.env.CCUI_HYBRID_ONLY &&
    memories.length > CCUI_MEMORY_LIMITS.MAX_RECALL_FILES

  if (useLlm) {
    const topHeaders = ranked
      .slice(0, 15)
      .map(r => byPath.get(r.path))
      .filter((m): m is MemoryHeader => m !== undefined)
    const filenames = await llmRerank(query, topHeaders, signal)
    method = 'hybrid+llm'
    selected = filenames
      .map(f => byFilename.get(f))
      .filter((m): m is MemoryHeader => m !== undefined)
  }

  if (selected.length === 0) {
    selected = ranked
      .slice(0, CCUI_MEMORY_LIMITS.MAX_RECALL_FILES)
      .map(r => byPath.get(r.path))
      .filter((m): m is MemoryHeader => m !== undefined)
  }

  const graph = await loadMemoryGraph()
  const graphHits = graphHitsForQuery(query, graph)

  recordRecall({
    query,
    at: new Date().toISOString(),
    method,
    candidates: ranked.map(r => ({
      path: r.path,
      score: r.score,
      reasons: r.reasons,
      mtimeMs: r.mtimeMs,
    })),
    selected: selected.map(s => s.filePath),
    graphHits,
    sessionBytesBefore,
  })

  void recentTools

  return selected.map(m => ({ path: m.filePath, mtimeMs: m.mtimeMs }))
}
