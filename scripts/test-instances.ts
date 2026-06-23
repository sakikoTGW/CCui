#!/usr/bin/env bun
/** 实例（PCL 启动器）闭环冒烟：建实例 → 装包 → 激活投射 → 卸包 → 删实例 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CommandSchema } from '../packages/protocol/index.ts'
import {
  createInstance, listInstances, installPackToInstance, activateInstance,
  removePackFromInstance, deleteInstance, mergeInstanceBinding, loadInstance,
  setInstanceIntercept,
} from '../services/daemon/instanceStore.ts'
import type { PackDoc } from '../services/daemon/packApply.ts'

// 协议 schema 覆盖
for (const cmd of ['instanceList', 'instanceCreate', 'instanceDelete', 'instanceActivate', 'instanceInstallCatalog', 'instanceInstallFile', 'instanceInstallInline', 'instanceImportRuntime', 'instanceRemovePack', 'instanceSetIntercept'] as const) {
  const base: Record<string, unknown> = { cmd, reqId: 't' }
  if (cmd !== 'instanceList') base.id = 'x'
  if (cmd === 'instanceCreate') { base.name = 'n'; base.runtime = 'ccui' }
  if (cmd === 'instanceActivate' || cmd === 'instanceDelete') base.id = 'x'
  if (cmd === 'instanceInstallCatalog') base.entryId = 'e'
  if (cmd === 'instanceInstallFile') base.path = 'p'
  if (cmd === 'instanceInstallInline') base.pack = {}
  if (cmd === 'instanceImportRuntime') base.runtime = 'ccui'
  if (cmd === 'instanceRemovePack') base.packName = 'p'
  if (cmd === 'instanceSetIntercept') base.enabled = true
  const r = CommandSchema.safeParse(base)
  if (!r.success) { console.error('FAIL schema', cmd, r.error.message); process.exit(1) }
}
console.log('OK: instance command schemas')

const cwd = await fs.mkdtemp(join(tmpdir(), 'ccui-inst-'))

const inst = await createInstance(cwd, { name: '调试专家', runtime: 'ccui' })
console.log('OK: createInstance', inst.id)

const pack: PackDoc = {
  schema: 'ccui-pack/v0.1',
  name: 'guarded',
  knowledge: {},
  tools: { mcp: [{ name: 'demo', command: 'echo' }] },
  ccui: { bindingVersion: '1', review: { forceAsk: ['Bash'], highRisk: ['Bash'] }, loop: { maxTurns: 20 } },
  bundle: { portable: true, files: [{ path: 'skills/dbg/SKILL.md', content: '# dbg' }] },
}
await installPackToInstance(cwd, inst.id, pack)
const after = await loadInstance(cwd, inst.id)
if (after?.packs.length !== 1) { console.error('FAIL: pack not recorded'); process.exit(1) }
if (after.packs[0].skills[0] !== 'dbg') { console.error('FAIL: skill not materialized', after.packs[0].skills); process.exit(1) }
console.log('OK: installPackToInstance skills', after.packs[0].skills, 'mcp', after.packs[0].mcp)

// 实例目录隔离：技能在实例目录，不在项目 .claude
const inSkill = await fs.readFile(join(cwd, '.ccui', 'instances', inst.id, 'skills', 'dbg', 'SKILL.md'), 'utf8')
console.log('OK: instance-owned skill exists', inSkill.trim())

const merged = mergeInstanceBinding(after!)
if (!merged?.review?.forceAsk?.includes('Bash')) { console.error('FAIL: merged binding missing forceAsk'); process.exit(1) }
console.log('OK: mergeInstanceBinding forceAsk', merged.review?.forceAsk)

const { binding } = await activateInstance(cwd, inst.id)
const projected = await fs.readFile(join(cwd, '.claude', 'skills', 'dbg', 'SKILL.md'), 'utf8').catch(() => '')
if (!projected) { console.error('FAIL: activation did not project skill'); process.exit(1) }
if (!binding?.review?.forceAsk?.length) { console.error('FAIL: activation binding empty'); process.exit(1) }
console.log('OK: activateInstance(ccui) projected → .claude/skills + binding')

// 第一把刀：codex 实例应投射到 .agents/skills（codex 认的目录），而非 .claude
const codexInst = await createInstance(cwd, { name: 'codex专家', runtime: 'codex' })
await installPackToInstance(cwd, codexInst.id, pack)
await activateInstance(cwd, codexInst.id)
const codexProjected = await fs.readFile(join(cwd, '.agents', 'skills', 'dbg', 'SKILL.md'), 'utf8').catch(() => '')
if (!codexProjected) { console.error('FAIL: codex instance did not project to .agents/skills'); process.exit(1) }
// 切到 codex 实例后，上一个 ccui 实例投射的 .claude/skills/dbg 应被清掉
const oldGone = !(await fs.access(join(cwd, '.claude', 'skills', 'dbg')).then(() => true).catch(() => false))
if (!oldGone) { console.error('FAIL: switching instance did not clean previous projection'); process.exit(1) }
console.log('OK: codex instance → .agents/skills, 切换清理上一个实例投射')

// 卸包 → 投射清理
await removePackFromInstance(cwd, codexInst.id, 'guarded')
await activateInstance(cwd, codexInst.id)
const stillThere = await fs.access(join(cwd, '.agents', 'skills', 'dbg')).then(() => true).catch(() => false)
if (stillThere) { console.error('FAIL: skill not cleaned after removePack+reactivate'); process.exit(1) }
console.log('OK: removePack cleaned projection')

// 瓶口接管闭环：claude-code 实例开 intercept → activate 传 proxyUrl → 改道 .claude/settings.json；切换回滚
const cwd3 = await fs.mkdtemp(join(tmpdir(), 'ccui-icpt-'))
const icpt = await createInstance(cwd3, { name: '受控claude', runtime: 'claude-code' })
await setInstanceIntercept(cwd3, icpt.id, true, 'https://api.deepseek.com/anthropic')
const act = await activateInstance(cwd3, icpt.id, { proxyUrl: 'http://127.0.0.1:4178' })
if (act.baseUrl?.runtime !== 'claude-code') { console.error('FAIL intercept: baseUrl not applied', act.baseUrl); process.exit(1) }
const icSettings = JSON.parse(await fs.readFile(join(cwd3, '.claude', 'settings.json'), 'utf8'))
if (icSettings.env?.ANTHROPIC_BASE_URL !== 'http://127.0.0.1:4178') { console.error('FAIL intercept: base_url not in settings', icSettings); process.exit(1) }
console.log('OK: 瓶口接管 activate → .claude/settings.json ANTHROPIC_BASE_URL = 代理')
// 再建一个普通实例并激活 → 应回滚上一个 intercept 的 base_url
const plain = await createInstance(cwd3, { name: 'plain', runtime: 'claude-code' })
await activateInstance(cwd3, plain.id, {})
const reverted = !(await fs.access(join(cwd3, '.claude', 'settings.json')).then(() => true).catch(() => false))
if (!reverted) { console.error('FAIL intercept: base_url not reverted on switch'); process.exit(1) }
console.log('OK: 瓶口接管 切换实例 → base_url 自动回滚')
await fs.rm(cwd3, { recursive: true, force: true })

await deleteInstance(cwd, codexInst.id)
await deleteInstance(cwd, inst.id)
const { instances } = await listInstances(cwd)
if (instances.length !== 0) { console.error('FAIL: instance not deleted'); process.exit(1) }
console.log('OK: deleteInstance')

await fs.rm(cwd, { recursive: true, force: true })
console.log('instances smoke passed')
