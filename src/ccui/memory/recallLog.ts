export type RecallCandidate = {
  path: string
  score: number
  reasons: string[]
  mtimeMs: number
}

export type RecallEvent = {
  query: string
  at: string
  method: 'hybrid' | 'hybrid+llm'
  candidates: RecallCandidate[]
  selected: string[]
  graphHits: string[]
  sessionBytesBefore: number
}

let lastRecall: RecallEvent | null = null
const history: RecallEvent[] = []
const MAX_HISTORY = 20

export function recordRecall(event: RecallEvent): void {
  lastRecall = event
  history.unshift(event)
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY
  }
}

export function getLastRecallEvent(): RecallEvent | null {
  return lastRecall
}

export function getRecallHistory(): readonly RecallEvent[] {
  return history
}

export function formatRecallSummary(): string | null {
  if (!lastRecall) return null
  const lines = [
    `Last recall (${lastRecall.method}) @ ${lastRecall.at}`,
    `Query: ${lastRecall.query.slice(0, 120)}`,
  ]
  if (lastRecall.graphHits.length > 0) {
    lines.push(`Graph hits: ${lastRecall.graphHits.join(', ')}`)
  }
  for (const c of lastRecall.candidates.slice(0, 8)) {
    const picked = lastRecall.selected.includes(c.path) ? '*' : ' '
    lines.push(
      `${picked} ${c.score.toFixed(3)} ${c.path.replace(/\\/g, '/')} — ${c.reasons.join('; ')}`,
    )
  }
  return lines.join('\n')
}
