#!/usr/bin/env bun
/**
 * ModelRouter 分级逻辑自测（纯逻辑，无需 API）
 * 运行: bun run scripts/test-model-router.ts
 */
import {
  ModelRouter,
  type RoutingRequest,
  type UsageRecord,
} from '../src/gui-service/modelRouter.js'

let pass = 0
let fail = 0

function expect(name: string, got: string, want: string) {
  if (got === want) {
    pass++
    console.log(`  ✓ ${name} → ${got}`)
  } else {
    fail++
    console.error(`  ✗ ${name} → got "${got}", want "${want}"`)
  }
}

const router = new ModelRouter()
const cases: Array<{ name: string; req: RoutingRequest; want: 'strong' | 'weak' }> = [
  { name: '规划任务', req: { taskType: 'plan' }, want: 'strong' },
  { name: '编排任务', req: { taskType: 'orchestrate' }, want: 'strong' },
  { name: '格式整理', req: { taskType: 'format' }, want: 'weak' },
  { name: '摘要', req: { taskType: 'summarize' }, want: 'weak' },
  { name: '简单分类', req: { taskType: 'classify' }, want: 'weak' },
  { name: '高风险升级', req: { taskType: 'format', isHighRisk: true }, want: 'strong' },
  { name: '大上下文升级', req: { taskType: 'summarize', contextTokens: 80_000 }, want: 'strong' },
  { name: '高复杂度升级', req: { estimatedComplexity: 0.9 }, want: 'strong' },
  { name: '低复杂度无类型→保守强', req: { estimatedComplexity: 0.2 }, want: 'strong' },
  { name: '显式指定弱', req: { pinnedModel: 'deepseek-v4-flash' }, want: 'weak' },
]

console.log('ModelRouter auto 分级:')
for (const c of cases) {
  const d = router.route(c.req)
  expect(c.name, d.tier, c.want)
}

console.log('\n强制模式:')
const weakOnly = new ModelRouter({ config: { mode: 'weak-only' } })
expect('weak-only 普通任务', weakOnly.route({ taskType: 'plan' }).tier, 'weak')
expect('weak-only 高风险仍升级', weakOnly.route({ isHighRisk: true }).tier, 'strong')

console.log('\n用量与成本:')
const records: UsageRecord[] = []
const metered = new ModelRouter({ sink: { record: r => records.push(r) } })
const r = metered.recordUsage({
  model: 'deepseek-v4-flash',
  tier: 'weak',
  taskType: 'summarize',
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
})
expect('成本计算非零', String(r.costUsd > 0), 'true')
expect('sink 收到记录', String(records.length), '1')
console.log(`  弱模型 1M+1M token 成本 ≈ $${r.costUsd.toFixed(3)}`)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
