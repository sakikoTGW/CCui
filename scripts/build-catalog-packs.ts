#!/usr/bin/env bun
/** 生成 .ccui/catalog 内置便携整合包（装别人的包 / 离线 starter） */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { embedPortableFiles } from '../services/daemon/packPortable.ts'
import type { PackDoc } from '../services/daemon/packApply.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogDir = join(root, '.ccui', 'catalog')

async function buildAgentsStarter(): Promise<void> {
  const skills = ['brainstorming', 'verification-before-completion']
  const pack: PackDoc = {
    schema: 'ccui-pack/v0.1',
    name: 'agents-starter',
    version: '0.1.0',
    runtime: { id: 'codex', label: 'OpenAI Codex / Agents', verified: true },
    knowledge: {
      skills: skills.map(name => ({
        name,
        source: 'bundled',
        ref: join(root, '.agents', 'skills', name, 'SKILL.md').replace(/\\/g, '/'),
      })),
    },
    tools: { mcp: [] },
    meta: { fidelity: 'L1', source: 'bundled', portable: true },
  }
  const portable = await embedPortableFiles(pack, root)
  await fs.writeFile(join(catalogDir, 'agents-starter.pack.json'), JSON.stringify(portable, null, 2), 'utf8')
  console.log('OK agents-starter', portable.bundle?.files?.length, 'files')
}

async function buildClaudeStarter(): Promise<void> {
  const name = 'systematic-debugging'
  const pack: PackDoc = {
    schema: 'ccui-pack/v0.1',
    name: 'claude-starter',
    version: '0.1.0',
    runtime: { id: 'claude-code', label: 'Claude Code', verified: true },
    knowledge: {
      skills: [{
        name,
        source: 'bundled',
        ref: join(root, '.agents', 'skills', name, 'SKILL.md').replace(/\\/g, '/'),
      }],
    },
    tools: { mcp: [] },
    meta: { fidelity: 'L1', source: 'bundled', portable: true },
  }
  const portable = await embedPortableFiles(pack, root)
  await fs.writeFile(join(catalogDir, 'claude-starter.pack.json'), JSON.stringify(portable, null, 2), 'utf8')
  console.log('OK claude-starter', portable.bundle?.files?.length, 'files')
}

async function buildCcuiNativeDemo(): Promise<void> {
  // 带 CCui 行为契约的「原生」整合包 —— 装进 CCui 立刻让审查/路由/loop 生效，
  // 搬到 OpenClaw/Codex 则这段是死字段。这是 ccui-pack 难迁移的护城河样例。
  const skills = ['systematic-debugging', 'verification-before-completion']
  const pack: PackDoc = {
    schema: 'ccui-pack/v0.1',
    name: 'ccui-native-guarded',
    version: '0.1.0',
    runtime: { id: 'ccui', label: 'CCui 原生', verified: true },
    knowledge: {
      skills: skills.map(name => ({
        name,
        source: 'bundled',
        ref: join(root, '.agents', 'skills', name, 'SKILL.md').replace(/\\/g, '/'),
      })),
    },
    tools: { mcp: [] },
    ccui: {
      bindingVersion: '1',
      router: { mode: 'auto' },
      review: {
        forceAsk: ['Bash', 'Write', 'Edit', 'MultiEdit'],
        highRisk: ['Bash'],
        autoAllow: ['Read', 'Glob', 'Grep', 'LS'],
      },
      loop: { maxTurns: 24 },
      harness: {
        systemPrompt: '遵循 systematic-debugging：先复现再定位，禁止未验证就声称修复。完成前跑 verify。',
      },
      verify: { onDone: ['bun run smoke'], smoke: ['bun run test:unit'] },
    },
    meta: { fidelity: 'L1', source: 'bundled', portable: true, binding: 'ccui-native' },
  }
  const portable = await embedPortableFiles(pack, root)
  await fs.writeFile(join(catalogDir, 'ccui-native-guarded.pack.json'), JSON.stringify(portable, null, 2), 'utf8')
  console.log('OK ccui-native-guarded', portable.bundle?.files?.length, 'files')
}

await fs.mkdir(catalogDir, { recursive: true })
await buildAgentsStarter()
await buildClaudeStarter()
await buildCcuiNativeDemo()
console.log('catalog packs built')
