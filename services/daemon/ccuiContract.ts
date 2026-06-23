/**
 * 行为合同（contract）—— pack 从「装了什么(has)」升级到「装完会怎样(behaves)」。
 *
 * 合同是一组**可验证条款**：装载后用真实 binding/router 对照断言，
 * 把「像不像」变成「合同遵没遵守」（绿/红）。这是可信/可测的地基。
 *
 * v0 验证「合同 ↔ binding 自洽」：声明的条款必须被 binding 真实满足，
 * 否则 pack 自相矛盾（声明要审 Bash 却没把 Bash 放进 forceAsk）。
 * 运行时级断言（真拦截/真回滚）见 P3 真门禁。
 */
import { ModelRouter, type TaskType } from './modelRouter.js'
import type { CcuiBinding } from './ccuiBinding.js'

export type CcuiContract = {
  contractVersion?: string
  /** 这些工具必须强制审查（即使引擎判 allow） */
  mustReview?: string[]
  /** 这些工具必须标记高风险（禁批量、强模型复核） */
  highRisk?: string[]
  /** 这些工具允许放行 */
  autoAllow?: string[]
  /** taskType → 必须走的 tier（strong/weak） */
  routing?: Partial<Record<TaskType, 'strong' | 'weak'>>
  /** 完成前必须有 verify 命令 */
  verifyOnDone?: boolean
  /** loop 轮数上限 */
  maxTurns?: number
}

export type ContractClause = { clause: string; ok: boolean; detail?: string }
export type ContractResult = { ok: boolean; passed: ContractClause[]; failed: ContractClause[] }

/** 从 binding 自动派生隐式合同（没显式写 contract 时，binding 即承诺） */
export function deriveContract(binding: CcuiBinding | undefined): CcuiContract {
  const c: CcuiContract = { contractVersion: '0' }
  if (binding?.review?.forceAsk?.length) c.mustReview = binding.review.forceAsk
  if (binding?.review?.highRisk?.length) c.highRisk = binding.review.highRisk
  if (binding?.review?.autoAllow?.length) c.autoAllow = binding.review.autoAllow
  if (binding?.verify?.onDone?.length) c.verifyOnDone = true
  if (binding?.loop?.maxTurns) c.maxTurns = binding.loop.maxTurns
  return c
}

export function normalizeContract(raw: unknown): CcuiContract | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: CcuiContract = {}
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : undefined)
  if (typeof r.contractVersion === 'string') out.contractVersion = r.contractVersion
  const mr = strArr(r.mustReview); if (mr) out.mustReview = mr
  const hr = strArr(r.highRisk); if (hr) out.highRisk = hr
  const aa = strArr(r.autoAllow); if (aa) out.autoAllow = aa
  if (typeof r.verifyOnDone === 'boolean') out.verifyOnDone = r.verifyOnDone
  if (typeof r.maxTurns === 'number') out.maxTurns = r.maxTurns
  if (r.routing && typeof r.routing === 'object') {
    const ro: Partial<Record<TaskType, 'strong' | 'weak'>> = {}
    for (const [k, v] of Object.entries(r.routing as Record<string, unknown>)) {
      if (v === 'strong' || v === 'weak') ro[k as TaskType] = v
    }
    if (Object.keys(ro).length) out.routing = ro
  }
  return Object.keys(out).length ? out : undefined
}

/** 验证合同条款是否被 binding/router 真实满足 */
export function verifyContract(contract: CcuiContract, binding: CcuiBinding | undefined): ContractResult {
  const passed: ContractClause[] = []
  const failed: ContractClause[] = []
  const add = (clause: string, ok: boolean, detail?: string) => (ok ? passed : failed).push({ clause, ok, detail })

  const forceAsk = new Set(binding?.review?.forceAsk ?? [])
  for (const t of contract.mustReview ?? []) {
    add(`mustReview:${t}`, forceAsk.has(t), forceAsk.has(t) ? undefined : `${t} 不在 binding.review.forceAsk`)
  }
  const highRisk = new Set(binding?.review?.highRisk ?? [])
  for (const t of contract.highRisk ?? []) {
    add(`highRisk:${t}`, highRisk.has(t), highRisk.has(t) ? undefined : `${t} 不在 binding.review.highRisk`)
  }
  const autoAllow = new Set(binding?.review?.autoAllow ?? [])
  for (const t of contract.autoAllow ?? []) {
    add(`autoAllow:${t}`, autoAllow.has(t), autoAllow.has(t) ? undefined : `${t} 不在 binding.review.autoAllow`)
  }
  if (contract.verifyOnDone) {
    const has = !!binding?.verify?.onDone?.length
    add('verifyOnDone', has, has ? undefined : 'binding.verify.onDone 为空')
  }
  if (typeof contract.maxTurns === 'number') {
    const v = binding?.loop?.maxTurns
    const ok = typeof v === 'number' && v <= contract.maxTurns
    add(`maxTurns<=${contract.maxTurns}`, ok, ok ? undefined : `binding.loop.maxTurns=${v}`)
  }
  if (contract.routing) {
    const router = new ModelRouter()
    if (binding?.router) router.setConfig(binding.router)
    for (const [taskType, tier] of Object.entries(contract.routing)) {
      const decision = router.route({ taskType: taskType as TaskType })
      add(`routing:${taskType}→${tier}`, decision.tier === tier, decision.tier === tier ? undefined : `实际 tier=${decision.tier}`)
    }
  }
  return { ok: failed.length === 0, passed, failed }
}
