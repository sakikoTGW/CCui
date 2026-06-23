/**
 * CcuiBinding —— 整合包的「CCui 行为契约」段。
 *
 * 这是 ccui-pack 区别于「一堆开放格式文件」的护城河：
 * router 分级 / 审查门禁 / 原生 loop / harness 预设 / Compare lanes 这些字段，
 * 只有 CCui 引擎有消费者。把它搬到 OpenClaw / Codex / Hermes —— 它们没有
 * 「审查队列」「强弱模型 tier」「Compare lane」的概念，这段就是死字段。
 *
 * 因此：
 *   - 纯 L1（skills/MCP/rules）= 可迁移，但谁都能抄。
 *   - 带 ccui 段 = 难迁移，且只有装进 CCui 才「好用」。
 */

export type CcuiReviewPolicy = {
  /** 即使引擎判定 allow，这些工具也强制走 CCui 审查（包级安全契约） */
  forceAsk?: string[]
  /** 高风险工具：审查面禁批量、路由强制升级强模型复核 */
  highRisk?: string[]
  /** 安全工具：直接放行，不打断 */
  autoAllow?: string[]
}

export type CcuiHarnessPreset = {
  systemPrompt?: string
  params?: Record<string, unknown>
}

export type CcuiCompareLane = {
  id: string
  label?: string
  model?: string
  systemPrompt?: string
}

export type CcuiBinding = {
  /** 契约版本，向后兼容用 */
  bindingVersion?: string
  router?: { mode?: 'auto' | 'strong-only' | 'weak-only'; strongModel?: string; weakModel?: string }
  review?: CcuiReviewPolicy
  loop?: { maxTurns?: number }
  harness?: CcuiHarnessPreset
  verify?: { onDone?: string[]; smoke?: string[] }
  compareLanes?: CcuiCompareLane[]
}

export type PortabilityReport = {
  /** 已绑定的 CCui 独有能力（人类可读） */
  bound: string[]
  /** 若搬到别的运行时会丢失的能力 */
  losesOnMigration: string[]
  /** native 程度：none = 纯 L1 可被随意套用；ccui-native = 强绑 CCui */
  binding: 'portable-L1' | 'ccui-native'
}

function hasContent(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (v && typeof v === 'object') return Object.keys(v).length > 0
  return v != null && v !== ''
}

/** 分析 binding 绑了哪些 CCui 能力、迁移会丢什么 */
export function analyzePortability(binding: CcuiBinding | undefined): PortabilityReport {
  const bound: string[] = []
  if (binding?.router && hasContent(binding.router)) bound.push('模型分级路由（强/弱 tier）')
  if (binding?.review && hasContent(binding.review)) {
    const r = binding.review
    const parts: string[] = []
    if (r.forceAsk?.length) parts.push(`强制审查 ${r.forceAsk.length} 类工具`)
    if (r.highRisk?.length) parts.push(`高风险禁批量 ${r.highRisk.length} 类`)
    if (r.autoAllow?.length) parts.push(`放行 ${r.autoAllow.length} 类`)
    bound.push(`审查门禁（${parts.join('、') || '策略'}）`)
  }
  if (binding?.loop?.maxTurns) bound.push(`原生 loop 上限 ${binding.loop.maxTurns} 轮`)
  if (binding?.harness && hasContent(binding.harness)) bound.push('harness 预设（systemPrompt/参数）')
  if (binding?.verify && hasContent(binding.verify)) bound.push('Verify Profile（完成即验证）')
  if (binding?.compareLanes?.length) bound.push(`Compare 预置 ${binding.compareLanes.length} 条变异路线`)

  return {
    bound,
    losesOnMigration: bound.slice(),
    binding: bound.length ? 'ccui-native' : 'portable-L1',
  }
}

/** 规范化外部 pack 里的 ccui 段（去掉非法字段，保证 apply 安全） */
export function normalizeBinding(raw: unknown): CcuiBinding | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: CcuiBinding = {}
  if (typeof r.bindingVersion === 'string') out.bindingVersion = r.bindingVersion

  if (r.router && typeof r.router === 'object') {
    const ro = r.router as Record<string, unknown>
    out.router = {}
    if (ro.mode === 'auto' || ro.mode === 'strong-only' || ro.mode === 'weak-only') out.router.mode = ro.mode
    if (typeof ro.strongModel === 'string') out.router.strongModel = ro.strongModel
    if (typeof ro.weakModel === 'string') out.router.weakModel = ro.weakModel
  }

  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter(x => typeof x === 'string') : undefined

  if (r.review && typeof r.review === 'object') {
    const rv = r.review as Record<string, unknown>
    out.review = {}
    const fa = strArr(rv.forceAsk)
    const hr = strArr(rv.highRisk)
    const aa = strArr(rv.autoAllow)
    if (fa) out.review.forceAsk = fa
    if (hr) out.review.highRisk = hr
    if (aa) out.review.autoAllow = aa
  }

  if (r.loop && typeof r.loop === 'object') {
    const lp = r.loop as Record<string, unknown>
    if (typeof lp.maxTurns === 'number' && lp.maxTurns > 0) out.loop = { maxTurns: Math.min(lp.maxTurns, 128) }
  }

  if (r.harness && typeof r.harness === 'object') {
    const h = r.harness as Record<string, unknown>
    out.harness = {}
    if (typeof h.systemPrompt === 'string') out.harness.systemPrompt = h.systemPrompt
    if (h.params && typeof h.params === 'object') out.harness.params = h.params as Record<string, unknown>
  }

  if (r.verify && typeof r.verify === 'object') {
    const v = r.verify as Record<string, unknown>
    out.verify = {}
    const od = strArr(v.onDone)
    const sm = strArr(v.smoke)
    if (od) out.verify.onDone = od
    if (sm) out.verify.smoke = sm
  }

  if (Array.isArray(r.compareLanes)) {
    out.compareLanes = r.compareLanes
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object' && typeof (l as Record<string, unknown>).id === 'string')
      .map(l => ({
        id: String(l.id),
        label: typeof l.label === 'string' ? l.label : undefined,
        model: typeof l.model === 'string' ? l.model : undefined,
        systemPrompt: typeof l.systemPrompt === 'string' ? l.systemPrompt : undefined,
      }))
  }

  return Object.keys(out).length ? out : undefined
}
