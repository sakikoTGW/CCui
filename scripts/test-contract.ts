#!/usr/bin/env bun
/** P2 行为合同 v0 golden：合同条款可验证（自洽=绿，矛盾=红），routing 断言 */
import { deriveContract, verifyContract, normalizeContract } from '../services/daemon/ccuiContract.ts'
import type { CcuiBinding } from '../services/daemon/ccuiBinding.ts'

const binding: CcuiBinding = {
  bindingVersion: '1',
  router: { mode: 'auto' },
  review: { forceAsk: ['Bash', 'Write'], highRisk: ['Bash'], autoAllow: ['Read'] },
  loop: { maxTurns: 24 },
  verify: { onDone: ['bun run smoke'] },
}

// 1) 派生合同：从 binding 自动生成，自洽 → 全绿
const derived = deriveContract(binding)
let res = verifyContract(derived, binding)
if (!res.ok || res.failed.length) { console.error('FAIL: derived contract should pass', res.failed); process.exit(1) }
console.log('OK: 派生合同自洽全绿（passed', res.passed.length, '）')

// 2) 显式合同 + routing 断言（plan 必走 strong、search 必走 weak）
const explicit = normalizeContract({
  mustReview: ['Bash', 'Write'],
  highRisk: ['Bash'],
  verifyOnDone: true,
  maxTurns: 32,
  routing: { plan: 'strong', search: 'weak' },
})!
res = verifyContract(explicit, binding)
if (!res.ok) { console.error('FAIL: explicit contract should pass', res.failed); process.exit(1) }
if (!res.passed.some(c => c.clause === 'routing:plan→strong') || !res.passed.some(c => c.clause === 'routing:search→weak')) {
  console.error('FAIL: routing clauses missing', res.passed.map(c => c.clause)); process.exit(1)
}
console.log('OK: 显式合同 + routing 断言全绿（plan→strong, search→weak）')

// 3) 矛盾合同 → 红（声明要审 Edit，但 binding 没把 Edit 放进 forceAsk）
const contradictory = normalizeContract({ mustReview: ['Bash', 'Edit'], routing: { search: 'strong' } })!
res = verifyContract(contradictory, binding)
if (res.ok) { console.error('FAIL: contradictory contract should fail'); process.exit(1) }
if (!res.failed.some(c => c.clause === 'mustReview:Edit')) { console.error('FAIL: should flag mustReview:Edit', res.failed); process.exit(1) }
if (!res.failed.some(c => c.clause === 'routing:search→strong')) { console.error('FAIL: should flag routing mismatch', res.failed); process.exit(1) }
console.log('OK: 矛盾合同正确标红（mustReview:Edit, routing:search→strong）')

// 4) verifyOnDone 红：binding 没 verify
const noVerify: CcuiBinding = { review: { forceAsk: ['Bash'] } }
res = verifyContract(normalizeContract({ verifyOnDone: true })!, noVerify)
if (res.ok) { console.error('FAIL: verifyOnDone should fail when no verify'); process.exit(1) }
console.log('OK: verifyOnDone 缺失正确标红')

console.log('contract smoke passed')
