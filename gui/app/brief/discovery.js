// Brief Discovery — 探询分支：说不清时，用多条假设路径帮用户把要求述清
import { normalizeBrief, domainLabels } from './schema.js'

export const DISCOVERY_MARKER = '<<CCUI_BRIEF_DISCOVERY>>'
export const DISCOVERY_MAX_ROUNDS = 6

/** @typedef {{ id: string; label: string; hypothesis: string; question: string }} DiscoveryBranch */

export function emptyDiscovery(seed = '') {
  return {
    active: false,
    round: 0,
    seed: seed || '',
    branches: [],
    synthesisQuestion: '',
    selectedId: null,
    log: [],
  }
}

export function ensureDiscovery(brief) {
  const n = normalizeBrief(brief)
  if (!n.discovery || typeof n.discovery !== 'object') n.discovery = emptyDiscovery()
  return n
}

/** 是否应进入探询（Brief 未就绪 + 有模糊输入或用户主动探询） */
export function shouldDiscover(brief, supplement = '') {
  const seed = (supplement || brief.problem || brief.outcome || '').trim()
  if (!seed) return false
  const d = brief.discovery
  if (d?.active && d.round >= DISCOVERY_MAX_ROUNDS) return false
  return true
}

/** 发给 Agent 的探询契约 */
export function buildDiscoveryPrompt(brief, seed, { round = 1, priorBranches = [] } = {}) {
  const n = ensureDiscovery(brief)
  const ctx = []
  if (n.domains?.length) ctx.push(`Domain hints: ${domainLabels(n.domains).join(', ')}`)
  if (n.constraints?.length) ctx.push(`Known constraints: ${n.constraints.join('; ')}`)
  if (priorBranches.length) {
    ctx.push('Previous branches user did not confirm:')
    priorBranches.forEach(b => ctx.push(`- ${b.label}: ${b.hypothesis}`))
  }

  return `${DISCOVERY_MARKER}
# Brief Discovery (round ${round})

You are a **requirements facilitator**, not a coder. The user cannot fully articulate what they want yet.

**User seed (their words, preserve respect):**
"""
${seed.trim()}
"""

${ctx.length ? `**Context:**\n${ctx.join('\n')}\n` : ''}

**Your task:**
1. Propose **exactly 3 branches** (A/B/C) — each is a *plausible reading* of their intent, not generic advice.
2. Each branch: short label + one-sentence hypothesis + one sharp question to validate it.
3. End with **one synthesis question** that helps them choose or merge branches.

**Rules:** No code, no tools, no implementation. Chinese unless they wrote English. Be empathetic — they feel the problem but lack words.

**Output format (strict):**
${DISCOVERY_MARKER}
## Branch A: [label]
Hypothesis: ...
Question: ?

## Branch B: [label]
Hypothesis: ...
Question: ?

## Branch C: [label]
Hypothesis: ...
Question: ?

**Synthesis question:** ...
${DISCOVERY_MARKER}
`.trim()
}

/** 从 Agent 回复解析探询分支 */
export function parseDiscoveryResponse(text) {
  if (!text) return null
  let body = text
  const re = new RegExp(`${DISCOVERY_MARKER}([\\s\\S]*?)${DISCOVERY_MARKER}`, 'g')
  let m
  const blocks = []
  while ((m = re.exec(text))) blocks.push(m[1])
  if (blocks.length) body = blocks[blocks.length - 1]
  else if (!text.includes('Branch A') && !text.includes('Branch B')) return null

  const branches = []
  const branchRe = /##\s*Branch\s+([A-Ca-c])[：:]\s*(.+?)\nHypothesis:\s*(.+?)\nQuestion:\s*(.+?)(?=\n##|\n\*\*Synthesis|\n${DISCOVERY_MARKER}|$)/gs
  let bm
  while ((bm = branchRe.exec(body))) {
    branches.push({
      id: bm[1].toUpperCase(),
      label: bm[2].trim(),
      hypothesis: bm[3].trim(),
      question: bm[4].trim().replace(/\?$/, '') + '?',
    })
  }
  if (!branches.length) return null

  const synM = body.match(/\*\*Synthesis question:\*\*\s*(.+?)(?=\n<<|$)/s)
    || body.match(/Synthesis question[：:]\s*(.+?)(?=\n<<|$)/s)
  const synthesisQuestion = synM ? synM[1].trim() : ''

  return { branches, synthesisQuestion, raw: body.trim() }
}

/** 用户选中某条探询分支 → 写入 Brief 字段 */
export function mergeBranchIntoBrief(brief, branch, userNote = '') {
  const n = ensureDiscovery(brief)
  const problem = [branch.hypothesis, userNote].filter(Boolean).join('\n')
  const acceptance = branch.question
    ? [`用户需能回答：${branch.question.replace(/\?$/, '')}`]
    : [...(n.acceptance || [])]

  return normalizeBrief({
    ...n,
    problem: n.problem ? `${n.problem}\n${problem}` : problem,
    outcome: n.outcome || branch.label,
    acceptance: [...new Set([...(n.acceptance || []), ...acceptance])],
    domains: n.domains?.length ? n.domains : ['unknown'],
    discovery: {
      ...n.discovery,
      active: true,
      selectedId: branch.id,
      branches: n.discovery.branches?.length ? n.discovery.branches : [branch],
      log: [
        ...(n.discovery.log || []),
        { at: Date.now(), type: 'select', branchId: branch.id, note: userNote },
      ],
    },
    updatedAt: Date.now(),
  })
}

export function attachDiscoveryResult(brief, parsed, seed, round) {
  const n = ensureDiscovery(brief)
  const nextRound = round ?? (n.discovery.round || 0) + 1
  return normalizeBrief({
    ...n,
    discovery: {
      ...n.discovery,
      active: true,
      round: nextRound,
      seed: seed || n.discovery.seed,
      branches: parsed.branches,
      synthesisQuestion: parsed.synthesisQuestion,
      log: [
        ...(n.discovery.log || []),
        { at: Date.now(), type: 'agent', branches: parsed.branches.length, round: nextRound },
      ],
    },
    updatedAt: Date.now(),
  })
}

/** 对话区展示用 — 不暴露 raw marker */
export function formatDiscoveryDisplay(parsed) {
  if (!parsed?.branches?.length) return ''
  const lines = [
    '## 三种理解',
    '',
    '以下为三种可能的理解。**点最接近你心意的一条。**',
    '',
  ]
  for (const b of parsed.branches) {
    lines.push(`### 路径 ${b.id}：${b.label}`)
    lines.push(`> ${b.hypothesis}`)
    lines.push(`**验证问题：** ${b.question}`)
    lines.push('')
  }
  if (parsed.synthesisQuestion) lines.push(`**综合问题：** ${parsed.synthesisQuestion}`)
  return lines.join('\n').trim()
}

export function discoverySummary(d) {
  if (!d?.active) return ''
  return `理清楚 R${d.round || 0}`
}
