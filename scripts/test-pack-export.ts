#!/usr/bin/env bun
/**
 * 自验万能打包器：
 *  A) 在本仓库 auto 检测 → 应命中 ccui/cursor 等，扫出 skills/rules/mcp。
 *  B) 造一个临时 opencode 项目（AGENTS.md + opencode.json 的 json-mcp shape）→ 适配器正确解析。
 *  C) 造一个临时 codex 项目（.codex/config.toml 的 TOML [mcp_servers]）→ TOML 解析正确。
 */
import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPack } from './pack-export.js'
import { detectRuntimes, scanUniversal } from '../services/proxy/runtimeAdapters.js'

function fail(msg: string): never {
  console.error(`[FAIL] ${msg}`)
  process.exit(1)
}
const checks: Array<[string, boolean]> = []
function check(label: string, pass: boolean) {
  checks.push([label, pass])
  console.error(`${pass ? '  ok ' : 'FAIL'}  ${label}`)
}

// —— A) 本仓库 auto —— （不写盘，--no-harness 保证只验 L1）
const repoRoot = join(import.meta.dir, '..')
const a = await buildPack(repoRoot, { runtime: 'auto', noHarness: true })
check('repo auto 命中运行时', (a.stats.detected as string[]).length > 0)
check('repo 扫出 skills>0', (a.stats.skills as number) > 0)
check('repo 扫出 rules>0', (a.stats.rules as number) > 0)
check('repo pack 带 runtime 字段', !!(a.pack as { runtime?: unknown }).runtime)

// —— B) opencode 临时项目 ——
const ocDir = mkdtempSync(join(tmpdir(), 'ccui-oc-'))
await writeFile(join(ocDir, 'AGENTS.md'), '# rules\nbe concise', 'utf8')
await writeFile(
  join(ocDir, 'opencode.json'),
  JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      brightData: { type: 'local', enabled: true, command: ['npx', '-y', '@brightdata/mcp'] },
      composio: { type: 'remote', url: 'https://connect.composio.dev/mcp', enabled: true },
    },
  }),
  'utf8',
)
const ocDetect = await detectRuntimes(ocDir)
check('opencode 被检测到', ocDetect.includes('opencode'))
const oc = await buildPack(ocDir, { runtime: 'opencode', noHarness: true })
const ocMcp = oc.scan.mcp
check('opencode 解析出项目 2 个 MCP', !!ocMcp.find(m => m.name === 'brightData') && !!ocMcp.find(m => m.name === 'composio'))
check('opencode local command 解析', ocMcp.find(m => m.name === 'brightData')?.command === 'npx')
check('opencode remote url 解析', ocMcp.find(m => m.name === 'composio')?.url === 'https://connect.composio.dev/mcp')
check('opencode rules=AGENTS.md', oc.scan.rules.some(r => r.format === 'agents-md'))

// —— C) codex 临时项目（TOML）——
const cxDir = mkdtempSync(join(tmpdir(), 'ccui-cx-'))
await mkdir(join(cxDir, '.codex'), { recursive: true })
await writeFile(join(cxDir, 'AGENTS.md'), '# codex rules', 'utf8')
await writeFile(
  join(cxDir, '.codex', 'config.toml'),
  [
    'model = "o4-mini"',
    '',
    '[mcp_servers.filesystem]',
    'command = "npx"',
    'args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]',
    '',
    '[mcp_servers.filesystem.env]',
    'FOO = "bar"',
    '',
    '[mcp_servers.figma]',
    'url = "https://mcp.figma.com/mcp"',
  ].join('\n'),
  'utf8',
)
const cxDetect = await detectRuntimes(cxDir)
check('codex 被检测到', cxDetect.includes('codex'))
const cx = await buildPack(cxDir, { runtime: 'codex', noHarness: true })
const cxMcp = cx.scan.mcp
check('codex TOML 解析出项目 MCP', !!cxMcp.find(m => m.name === 'filesystem') && !!cxMcp.find(m => m.name === 'figma'))
check('codex stdio command/args', cxMcp.find(m => m.name === 'filesystem')?.command === 'npx' && (cxMcp.find(m => m.name === 'filesystem')?.args?.length ?? 0) === 3)
check('codex env 子表未污染服务计数', !cxMcp.some(m => m.name === 'env'))
check('codex http url 解析', cxMcp.find(m => m.name === 'figma')?.url === 'https://mcp.figma.com/mcp')

// —— D) openclaw 临时项目（openclaw.json，真实 JSON5 + mcp.servers 嵌套，见 HARNESS_RESEARCH.md §3）——
const owDir = mkdtempSync(join(tmpdir(), 'ccui-ow-'))
await mkdir(join(owDir, '.agents', 'skills', 'my-skill'), { recursive: true })
await writeFile(join(owDir, '.agents', 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\nbody', 'utf8')
await writeFile(join(owDir, 'AGENTS.md'), '# rules', 'utf8')
await writeFile(
  join(owDir, 'openclaw.json'),
  // JSON5：含注释 + 尾逗号，验证 parseJsonLoose 兜底
  '{\n  // openclaw config\n  mcp: { servers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], transport: "stdio" }, }, },\n}',
  'utf8',
)
const owDetect = await detectRuntimes(owDir)
check('openclaw 被检测到', owDetect.includes('openclaw'))
const ow = await buildPack(owDir, { runtime: 'openclaw', noHarness: true })
check('openclaw 扫到 .agents/skills', ow.scan.skills.some(s => s.name === 'my-skill'))
check('openclaw mcp.servers(JSON5) 解析', ow.scan.mcp.find(m => m.name === 'github')?.command === 'npx')

// —— E) hermes 临时项目（config.yaml，YAML mcp_servers）——
const hmDir = mkdtempSync(join(tmpdir(), 'ccui-hm-'))
await writeFile(join(hmDir, 'AGENTS.md'), '# hermes rules', 'utf8')
await writeFile(
  join(hmDir, 'hermes-config.yaml'),
  [
    'model: hermes-4',
    'mcp_servers:',
    '  filesystem:',
    '    command: "npx"',
    '    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]',
    '  figma:',
    '    url: "https://mcp.figma.com/mcp"',
    'other_key: 1',
  ].join('\n'),
  'utf8',
)
// 直接验 YAML 解析（hermes 真路径在 ~/.hermes，CI 里用 universal 深扫覆盖该文件）
const hmUni = await scanUniversal(hmDir)
check('hermes YAML 解析出 filesystem', hmUni.mcp.some(m => m.name === 'filesystem' && m.command === 'npx'))
check('hermes YAML args 块解析', (hmUni.mcp.find(m => m.name === 'filesystem')?.args?.length ?? 0) === 3)
check('hermes YAML url 解析', hmUni.mcp.some(m => m.name === 'figma' && m.url === 'https://mcp.figma.com/mcp'))
check('hermes YAML 未把 other_key 当 server', !hmUni.mcp.some(m => m.name === 'other_key'))

// —— F) universal 深扫：混合布局，未知 harness 也能拿下 ——
const uniDir = mkdtempSync(join(tmpdir(), 'ccui-uni-'))
await mkdir(join(uniDir, 'weird', 'nested', 'cool-skill'), { recursive: true })
await writeFile(join(uniDir, 'weird', 'nested', 'cool-skill', 'SKILL.md'), '---\nname: cool\n---\nx', 'utf8')
await mkdir(join(uniDir, 'node_modules', 'junk'), { recursive: true })
await writeFile(join(uniDir, 'node_modules', 'junk', 'SKILL.md'), 'should be ignored', 'utf8')
await writeFile(join(uniDir, 'CLAUDE.md'), '# rules', 'utf8')
await writeFile(join(uniDir, 'random.json'), JSON.stringify({ mcpServers: { x: { command: 'foo' } } }), 'utf8')
const uni = await buildPack(uniDir, { runtime: 'universal', noHarness: true })
check('universal 深扫到嵌套 skill', uni.scan.skills.some(s => s.name === 'cool-skill'))
check('universal 跳过 node_modules', !uni.scan.skills.some(s => s.ref.includes('node_modules')))
check('universal 发现任意 json 的 mcpServers', uni.scan.mcp.some(m => m.name === 'x'))
check('universal 发现 CLAUDE.md', uni.scan.rules.some(r => r.name === 'CLAUDE.md'))

const allOk = checks.every(([, p]) => p)
if (!allOk) fail('部分校验未通过')
console.error('\n[PASS] 万能打包器：多运行时 L1 适配 + TOML/JSON-mcp 解析 全部成立')
console.error(`\n本仓库 auto 检测到：${(a.stats.detected as string[]).join(', ')}`)
process.exit(0)
