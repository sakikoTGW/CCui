#!/usr/bin/env bun
/** P1 存档（project-profile）golden：导出含全 project-scope 料 + 导入还原 + 回滚干净 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CommandSchema } from '../packages/protocol/index.ts'
import { exportProfile, importProfile, revertImportedProfile, listProfiles } from '../services/daemon/profileService.ts'

for (const cmd of ['profileList', 'profileExport', 'profileImport'] as const) {
  const base: Record<string, unknown> = { cmd, reqId: 't' }
  const r = CommandSchema.safeParse(base)
  if (!r.success) { console.error('FAIL schema', cmd, r.error.message); process.exit(1) }
}
console.log('OK: profile command schemas')

// —— 造一个有"项目心智"的项目 ——
const src = await fs.mkdtemp(join(tmpdir(), 'ccui-prof-src-'))
await fs.mkdir(join(src, '.claude'), { recursive: true })
await fs.writeFile(join(src, '.claude', 'ccui-project-graph.json'), JSON.stringify({ summary: 'arch graph', areas: ['src'] }), 'utf8')
await fs.writeFile(join(src, 'CLAUDE.md'), '# 约定\n- 用中文\n- 完成前跑 verify', 'utf8')
await fs.mkdir(join(src, '.ccui', 'briefs'), { recursive: true })
await fs.writeFile(join(src, '.ccui', 'briefs', 'goal-1.md'), '目标：重构 daemon', 'utf8')
await fs.mkdir(join(src, '.claude', 'agent-memory', 'main'), { recursive: true })
await fs.writeFile(join(src, '.claude', 'agent-memory', 'main', 'MEMORY.md'), '这个项目 X 意味着 Y；踩过的坑：Z', 'utf8')
await fs.writeFile(join(src, '.ccui', 'project.yaml'), 'router:\n  mode: auto\n', 'utf8')

const { path: profPath, profile } = await exportProfile(src, 'demo')
if (!profile.stats.graph || profile.stats.briefs < 1 || profile.stats.memory < 1) { console.error('FAIL: export missing project-scope 料', profile.stats); process.exit(1) }
const hasGraph = profile.files.some(f => f.path === '.claude/ccui-project-graph.json')
const hasMem = profile.files.some(f => f.path === '.claude/agent-memory/main/MEMORY.md')
const hasBrief = profile.files.some(f => f.path === '.ccui/briefs/goal-1.md')
const hasClaude = profile.files.some(f => f.path === 'CLAUDE.md')
if (!hasGraph || !hasMem || !hasBrief || !hasClaude) { console.error('FAIL: export 缺文件', profile.files.map(f => f.path)); process.exit(1) }
console.log('OK: exportProfile 收齐 图谱+记忆+briefs+CLAUDE.md（files', profile.files.length, '）→', profPath)

const lst = await listProfiles(src)
if (!lst.find(p => p.name === 'demo')) { console.error('FAIL: listProfiles', lst); process.exit(1) }
console.log('OK: listProfiles')

// —— 导入到空目录：agent 立刻"懂这个项目" ——
const dst = await fs.mkdtemp(join(tmpdir(), 'ccui-prof-dst-'))
const rep = await importProfile(dst, profile)
const restoredMem = await fs.readFile(join(dst, '.claude', 'agent-memory', 'main', 'MEMORY.md'), 'utf8').catch(() => '')
const restoredGraph = await fs.access(join(dst, '.claude', 'ccui-project-graph.json')).then(() => true).catch(() => false)
if (!restoredMem.includes('踩过的坑') || !restoredGraph) { console.error('FAIL: import 未还原', rep); process.exit(1) }
console.log('OK: importProfile 还原 记忆+图谱（restored', rep.restored.length, '）')

// —— 回滚：只删我们新建的，不动用户原有 ——
await fs.writeFile(join(dst, 'CLAUDE.md.userown'), 'mine', 'utf8') // 用户自有文件
await revertImportedProfile(dst, rep.manifestPath)
const memGone = !(await fs.access(join(dst, '.claude', 'agent-memory', 'main', 'MEMORY.md')).then(() => true).catch(() => false))
const userKept = await fs.access(join(dst, 'CLAUDE.md.userown')).then(() => true).catch(() => false)
if (!memGone) { console.error('FAIL: 回滚未删导入文件'); process.exit(1) }
if (!userKept) { console.error('FAIL: 回滚误删用户文件'); process.exit(1) }
console.log('OK: 回滚只删导入物，保留用户文件')

// —— 已存在不覆盖（保护现场）——
await importProfile(dst, profile) // 重新导入
await fs.writeFile(join(dst, 'CLAUDE.md'), '用户改过的', 'utf8')
const rep2 = await importProfile(dst, profile, { overwrite: false })
const claudeNow = await fs.readFile(join(dst, 'CLAUDE.md'), 'utf8')
if (claudeNow !== '用户改过的' || !rep2.skipped.some(s => s.startsWith('CLAUDE.md'))) { console.error('FAIL: overwrite=false 未保护现场', rep2.skipped); process.exit(1) }
console.log('OK: overwrite=false 保护已存在文件')

await fs.rm(src, { recursive: true, force: true })
await fs.rm(dst, { recursive: true, force: true })
console.log('project-profile smoke passed')
