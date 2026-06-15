import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { getAutoMemPath } from '../../memdir/paths.js'
import type { Message } from '../../types/message.js'
import { getUserMessageText } from '../../utils/messages.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  extractGraphCandidatesFromText,
  persistGraphCandidates,
  type MemoryGraphNode,
} from './memoryGraph.js'
import { isCcuiMemoryEnabled } from './config.js'

let lastUserUuid: string | undefined
let lastAssistantUuid: string | undefined
let turnsSinceFlush = 0

const INCREMENTAL_DIR = 'incremental'

function incrementalDir(): string {
  return join(getAutoMemPath(), INCREMENTAL_DIR)
}

async function appendIncrementalNote(
  title: string,
  body: string,
  source: string,
): Promise<void> {
  const dir = incrementalDir()
  await mkdir(dir, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  const file = join(dir, `${day}.md`)
  const block = `\n\n## ${title}\n- source: ${source}\n- at: ${new Date().toISOString()}\n\n${body}\n`
  await writeFile(file, block, { flag: 'a' })
}

function latestUserText(messages: Message[]): string | null {
  const m = messages.findLast(
    msg => msg.type === 'user' && !('isMeta' in msg && msg.isMeta),
  )
  if (!m || m.type !== 'user') return null
  return getUserMessageText(m)
}

function latestAssistantText(messages: Message[]): string | null {
  const m = messages.findLast(msg => msg.type === 'assistant')
  if (!m || m.type !== 'assistant') return null
  const content = m.message.content
  if (typeof content === 'string') return content
  const parts = content
    .filter(b => b.type === 'text')
    .map(b => (b.type === 'text' ? b.text : ''))
    .join('\n')
  return parts || null
}

/**
 * 回合内增量记忆：用户消息与助手总结写入图谱 + incremental/*.md
 */
export async function runIncrementalMemoryPass(
  messages: Message[],
  sessionId: string,
): Promise<void> {
  if (!isCcuiMemoryEnabled()) return

  const userMsg = messages.findLast(
    m => m.type === 'user' && !('isMeta' in m && m.isMeta),
  )
  const assistantMsg = messages.findLast(m => m.type === 'assistant')

  const userUuid = userMsg?.uuid
  const assistantUuid = assistantMsg?.uuid
  if (userUuid === lastUserUuid && assistantUuid === lastAssistantUuid) {
    return
  }
  lastUserUuid = userUuid
  lastAssistantUuid = assistantUuid
  turnsSinceFlush++

  const userText = latestUserText(messages)
  const assistantText = latestAssistantText(messages)
  const candidates = [
    ...(userText
      ? extractGraphCandidatesFromText(userText, `user:${sessionId}`)
      : []),
    ...(assistantText
      ? extractGraphCandidatesFromText(assistantText, `assistant:${sessionId}`)
      : []),
  ]

  if (candidates.length === 0) return

  await persistGraphCandidates(candidates)

  if (turnsSinceFlush >= 2 || candidates.some(c => c.confidence >= 0.85)) {
    turnsSinceFlush = 0
    const summary = candidates.map(c => `- **${c.type}** ${c.content}`).join('\n')
    await appendIncrementalNote('turn capture', summary, sessionId)
    for (const c of candidates.filter(x => x.confidence >= 0.85)) {
      await writeDurableTopicFile(c)
    }
    logForDebugging(
      `[ccui] incremental memory ${candidates.length} fact(s)`,
      { level: 'debug' },
    )
  }
}

async function writeDurableTopicFile(
  candidate: Pick<MemoryGraphNode, 'type' | 'content' | 'entity' | 'confidence'>,
): Promise<void> {
  const dir = join(getAutoMemPath(), 'topics')
  await mkdir(dir, { recursive: true })
  const slug = candidate.entity
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  if (!slug) return
  const path = join(dir, `${slug}.md`)
  const body = `---
description: ${candidate.content.slice(0, 120)}
type: ${candidate.type}
confidence: ${candidate.confidence}
---

# ${candidate.entity}

${candidate.content}
`
  await writeFile(path, body, 'utf8')
}
