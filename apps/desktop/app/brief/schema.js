// Task Brief — 任务简报规格层（结构化意图 → Agent 可执行契约）
export const BRIEF_VERSION = 1
export const BRIEF_MARKER = '<<CCUI_TASK_BRIEF>>'

/** 任务域 — 多选 */
export const BRIEF_DOMAINS = [
  { id: 'product', label: '产品 / 体验' },
  { id: 'feature', label: '功能 / 逻辑' },
  { id: 'defect', label: '缺陷修复' },
  { id: 'perf', label: '性能' },
  { id: 'refactor', label: '重构' },
  { id: 'infra', label: '架构 / 基建' },
  { id: 'unknown', label: '待定义（需 Agent 协助收敛）' },
]

export function emptyBrief(conversationId = null) {
  return {
    id: `br_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    version: BRIEF_VERSION,
    conversationId,
    domains: [],
    outcome: '',
    problem: '',
    constraints: [],
    acceptance: [],
    discovery: null,
    updatedAt: Date.now(),
  }
}

function emptyDiscoveryFields() {
  return { active: false, round: 0, seed: '', branches: [], synthesisQuestion: '', selectedId: null, log: [] }
}

export function normalizeBrief(raw) {
  if (!raw) return emptyBrief()
  return {
    ...emptyBrief(raw.conversationId),
    ...raw,
    domains: [...(raw.domains || [])],
    constraints: linesToList(raw.constraints),
    acceptance: linesToList(raw.acceptance),
    discovery: raw.discovery ? { ...emptyDiscoveryFields(), ...raw.discovery } : emptyDiscoveryFields(),
    version: BRIEF_VERSION,
  }
}

function linesToList(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String)
  if (typeof v === 'string' && v.trim()) return v.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  return []
}

/** 完备度 — 引导流程：有目标或问题即视为可发送 */
export function assessBrief(b) {
  const hasGoal = !!(b.outcome && b.outcome.trim())
  const hasFuzz = !!(b.problem && b.problem.trim())
  const hasAccept = !!(b.acceptance && b.acceptance.length)
  const ready = hasGoal || (hasFuzz && hasAccept) || (hasGoal && hasFuzz)
  const score = [hasGoal, hasFuzz, hasAccept, !!(b.domains && b.domains.length)].filter(Boolean).length
  return {
    checks: { outcome: hasGoal, problem: hasFuzz, acceptance: hasAccept, domain: !!(b.domains?.length) },
    score,
    total: 4,
    pct: ready ? 100 : (hasFuzz ? 50 : 0),
    ready: ready || (hasFuzz && b.discovery?.selectedId),
  }
}

export function domainLabels(ids) {
  return (ids || []).map(id => BRIEF_DOMAINS.find(d => d.id === id)?.label || id)
}

/** 渲染为 Agent 契约文本（含机器可读标记） */
export function renderBriefContract(b) {
  const n = normalizeBrief(b)
  const a = assessBrief(n)
  if (!a.ready) return null

  const lines = [
    BRIEF_MARKER,
    '# Task Brief',
    '',
  ]
  if (n.domains.length) lines.push(`**Domain:** ${domainLabels(n.domains).join(' · ')}`)
  if (n.outcome) lines.push(`**Outcome:** ${n.outcome.trim()}`)
  if (n.problem) lines.push(`**Problem:** ${n.problem.trim()}`)
  if (n.constraints.length) {
    lines.push('**Constraints:**')
    n.constraints.forEach(c => lines.push(`- ${c}`))
  }
  if (n.acceptance.length) {
    lines.push('**Acceptance:**')
    n.acceptance.forEach(c => lines.push(`- ${c}`))
  }
  lines.push(
    '',
    'Execute against this brief. If ambiguous, ask one blocking question before edits.',
    BRIEF_MARKER,
  )
  return lines.join('\n')
}

/** 用户气泡旁展示的摘要 */
export function briefSummary(b) {
  if (!b) return ''
  const n = normalizeBrief(b)
  const parts = []
  if (n.outcome) parts.push(n.outcome.slice(0, 48))
  else if (n.problem) parts.push(n.problem.slice(0, 48))
  if (n.domains.length) parts.push(domainLabels(n.domains).slice(0, 2).join('/'))
  return parts.join(' · ') || '已理清'
}

export function stripBriefMarker(text) {
  if (!text) return text
  const re = new RegExp(`${BRIEF_MARKER}[\\s\\S]*?${BRIEF_MARKER}\\s*`, 'g')
  return text.replace(re, '').trim()
}
