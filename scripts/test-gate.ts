#!/usr/bin/env bun
/** P3 真门禁补齐 golden：审计日志落盘（决策可追溯）+ schema */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CommandSchema } from '../packages/protocol/index.ts'
import { recordDecision, readAudit } from '../services/daemon/auditLog.ts'

const r = CommandSchema.safeParse({ cmd: 'auditList', reqId: 't', limit: 50 })
if (!r.success) { console.error('FAIL schema auditList', r.error.message); process.exit(1) }
console.log('OK: auditList schema')

const cwd = await fs.mkdtemp(join(tmpdir(), 'ccui-gate-'))

// 模拟一串决策：自动放行 Read、人审拒绝 Bash（高风险+强制）、policy 放行 Glob
await recordDecision(cwd, { sessionId: 'main', tool: 'Read', behavior: 'allow', source: 'auto', forced: false, highRisk: false })
await recordDecision(cwd, { sessionId: 'thread_1', tool: 'Bash', behavior: 'deny', source: 'user', forced: true, highRisk: true })
await recordDecision(cwd, { sessionId: 'main', tool: 'Glob', behavior: 'allow', source: 'policy', forced: false, highRisk: false })

const file = join(cwd, '.ccui', 'audit', 'decisions.jsonl')
if (!(await fs.access(file).then(() => true).catch(() => false))) { console.error('FAIL: 审计文件未落盘'); process.exit(1) }
const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean)
if (lines.length !== 3) { console.error('FAIL: append-only 行数', lines.length); process.exit(1) }
console.log('OK: 决策 append-only 落盘 .ccui/audit/decisions.jsonl（3 行）')

const audit = await readAudit(cwd, 50)
if (audit.length !== 3) { console.error('FAIL: readAudit 条数', audit.length); process.exit(1) }
// 最新在前
if (audit[0].tool !== 'Glob') { console.error('FAIL: 顺序（最新在前）', audit.map(a => a.tool)); process.exit(1) }
const bashDeny = audit.find(a => a.tool === 'Bash')
if (!bashDeny || bashDeny.behavior !== 'deny' || !bashDeny.forced || !bashDeny.highRisk || bashDeny.source !== 'user') {
  console.error('FAIL: 高风险拒绝决策字段', bashDeny); process.exit(1)
}
if (!bashDeny.ts) { console.error('FAIL: 缺时间戳'); process.exit(1) }
console.log('OK: 高风险/强制/人审拒绝 决策完整可追溯（tool/behavior/forced/highRisk/source/ts）')

await fs.rm(cwd, { recursive: true, force: true })
console.log('gate(audit) smoke passed')
