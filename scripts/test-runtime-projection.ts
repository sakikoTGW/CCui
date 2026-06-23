#!/usr/bin/env bun
/** 按 runtime 的 MCP 端口写入：hermes(YAML) / openclaw(JSON5) / json 合并 + 回滚 + 护栏 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as yamlParse } from 'yaml'
import JSON5 from 'json5'
import { mergeMcp, unmergeMcp, applyBaseUrl, revertBaseUrl, type McpTarget } from '../services/daemon/runtimeProjection.ts'

const servers = { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GH: 'x' } } }
const dir = await fs.mkdtemp(join(tmpdir(), 'ccui-rp-'))

// —— Hermes: YAML mcp_servers，保留用户原有 model: 块 ——
const hermesCfg = join(dir, 'config.yaml')
await fs.writeFile(hermesCfg, 'model:\n  default: anthropic/claude\n  base_url: https://x/v1\nmcp_servers:\n  existing:\n    command: foo\n', 'utf8')
const hTarget: McpTarget = { absFile: hermesCfg, projectLocal: false, format: 'yaml-mcp_servers' }
const hRes = await mergeMcp(hTarget, servers)
if (!hRes.added.includes('github')) { console.error('FAIL hermes merge', hRes); process.exit(1) }
let hDoc = yamlParse(await fs.readFile(hermesCfg, 'utf8'))
if (hDoc.mcp_servers?.github?.command !== 'npx' || hDoc.mcp_servers?.github?.enabled !== true) { console.error('FAIL hermes yaml shape', hDoc.mcp_servers); process.exit(1) }
if (hDoc.model?.default !== 'anthropic/claude' || hDoc.mcp_servers?.existing?.command !== 'foo') { console.error('FAIL hermes preserved user keys'); process.exit(1) }
console.log('OK: hermes YAML mcp_servers merged + 保留 model/existing')
await unmergeMcp(hermesCfg, 'yaml-mcp_servers', ['github'])
hDoc = yamlParse(await fs.readFile(hermesCfg, 'utf8'))
if (hDoc.mcp_servers?.github) { console.error('FAIL hermes rollback'); process.exit(1) }
if (hDoc.mcp_servers?.existing?.command !== 'foo' || hDoc.model?.base_url !== 'https://x/v1') { console.error('FAIL hermes rollback clobbered'); process.exit(1) }
console.log('OK: hermes 回滚干净（保留原配置）')

// —— OpenClaw: JSON5 mcp.servers（含注释/尾逗号），保留 models 块 ——
const owCfg = join(dir, 'openclaw.json')
await fs.writeFile(owCfg, '{\n  // openclaw\n  models: { providers: { x: { baseUrl: "http://l/v1" } } },\n  mcp: { servers: {} },\n}', 'utf8')
const oTarget: McpTarget = { absFile: owCfg, projectLocal: false, format: 'json5-openclaw' }
const oRes = await mergeMcp(oTarget, servers)
if (!oRes.added.includes('github')) { console.error('FAIL openclaw merge', oRes); process.exit(1) }
let oDoc = JSON5.parse(await fs.readFile(owCfg, 'utf8'))
if (oDoc.mcp?.servers?.github?.command !== 'npx' || oDoc.mcp?.servers?.github?.transport !== 'stdio') { console.error('FAIL openclaw shape', oDoc.mcp); process.exit(1) }
if (oDoc.models?.providers?.x?.baseUrl !== 'http://l/v1') { console.error('FAIL openclaw preserved models'); process.exit(1) }
console.log('OK: openclaw JSON5 mcp.servers merged + 保留 models')
await unmergeMcp(owCfg, 'json5-openclaw', ['github'])
oDoc = JSON5.parse(await fs.readFile(owCfg, 'utf8'))
if (oDoc.mcp?.servers?.github) { console.error('FAIL openclaw rollback'); process.exit(1) }
if (oDoc.models?.providers?.x?.baseUrl !== 'http://l/v1') { console.error('FAIL openclaw rollback clobbered'); process.exit(1) }
console.log('OK: openclaw 回滚干净（保留 models）')

// —— 护栏：全局配置不存在 → 不凭空造，跳过 ——
const missing: McpTarget = { absFile: join(dir, 'nope', 'config.yaml'), projectLocal: false, format: 'yaml-mcp_servers' }
const mRes = await mergeMcp(missing, servers)
if (mRes.added.length !== 0 || mRes.skipped.length === 0) { console.error('FAIL guard: should skip missing global', mRes); process.exit(1) }
if (await fs.access(missing.absFile).then(() => true).catch(() => false)) { console.error('FAIL guard: created phantom global config'); process.exit(1) }
console.log('OK: 护栏 —— 全局配置不存在则跳过，不凭空造')

// —— Codex: TOML [mcp_servers.NAME] 标记块追加，保留用户注释，可回滚 ——
const codexCfg = join(dir, 'config.toml')
await fs.writeFile(codexCfg, '# my codex config\nmodel = "gpt-5"\n\n[tui]\ntheme = "dark"\n', 'utf8')
const cTarget: McpTarget = { absFile: codexCfg, projectLocal: false, format: 'toml-mcp_servers' }
const cRes = await mergeMcp(cTarget, servers)
if (!cRes.added.includes('github')) { console.error('FAIL codex toml merge', cRes); process.exit(1) }
let cText = await fs.readFile(codexCfg, 'utf8')
if (!cText.includes('[mcp_servers.github]') || !cText.includes('command = "npx"') || !cText.includes('[mcp_servers.github.env]')) { console.error('FAIL codex toml shape', cText); process.exit(1) }
if (!cText.includes('# my codex config') || !cText.includes('theme = "dark"')) { console.error('FAIL codex preserved user content+comments'); process.exit(1) }
console.log('OK: codex TOML [mcp_servers.github] 追加 + 保留注释')
await unmergeMcp(codexCfg, 'toml-mcp_servers', ['github'])
cText = await fs.readFile(codexCfg, 'utf8')
if (cText.includes('[mcp_servers.github]') || cText.includes('ccui-mcp:github')) { console.error('FAIL codex toml rollback'); process.exit(1) }
if (!cText.includes('# my codex config') || !cText.includes('theme = "dark"')) { console.error('FAIL codex rollback clobbered'); process.exit(1) }
console.log('OK: codex TOML 回滚干净（保留原文+注释）')

// —— 瓶口 base_url：claude(settings.json env) ——
const cwd = dir
await applyBaseUrl('claude-code', cwd, 'http://127.0.0.1:8899/v1')
const settings = JSON.parse(await fs.readFile(join(cwd, '.claude', 'settings.json'), 'utf8'))
if (settings.env?.ANTHROPIC_BASE_URL !== 'http://127.0.0.1:8899/v1' || settings.env?.ENABLE_TOOL_SEARCH !== 'true') { console.error('FAIL claude base_url', settings); process.exit(1) }
console.log('OK: claude base_url → .claude/settings.json env (ANTHROPIC_BASE_URL + ENABLE_TOOL_SEARCH)')
await revertBaseUrl('claude-code', cwd)
const settingsGone = await fs.access(join(cwd, '.claude', 'settings.json')).then(() => true).catch(() => false)
if (settingsGone) { console.error('FAIL claude base_url revert (should delete created file)'); process.exit(1) }
console.log('OK: claude base_url 回滚（删除我们创建的 settings.json）')

// —— 瓶口 base_url：astrbot(data/cmd_config.json provider 列表 + default_provider_id) ——
const abData = join(cwd, 'data')
await fs.mkdir(abData, { recursive: true })
const abCfg = join(abData, 'cmd_config.json')
await fs.writeFile(abCfg, JSON.stringify({
  provider: [{ id: 'existing-openai', type: 'openai_chat_completion', api_base: 'https://api.openai.com/v1' }],
  provider_settings: { default_provider_id: 'existing-openai' },
}, null, 2), 'utf8')
const abRes = await applyBaseUrl('astrbot', cwd, 'http://127.0.0.1:8899/v1', { providerId: 'ccui-proxy' })
if (!abRes.ok) { console.error('FAIL astrbot base_url', abRes); process.exit(1) }
let abJson = JSON.parse(await fs.readFile(abCfg, 'utf8'))
const ccuiProv = abJson.provider.find((p: { id: string }) => p.id === 'ccui-proxy')
if (ccuiProv?.api_base !== 'http://127.0.0.1:8899/v1' || abJson.provider_settings?.default_provider_id !== 'ccui-proxy') { console.error('FAIL astrbot provider/default', abJson); process.exit(1) }
if (!abJson.provider.find((p: { id: string }) => p.id === 'existing-openai')) { console.error('FAIL astrbot clobbered existing provider'); process.exit(1) }
console.log('OK: astrbot base_url → provider 列表新增 ccui-proxy + default_provider_id（保留原 provider）')
await revertBaseUrl('astrbot', cwd)
abJson = JSON.parse(await fs.readFile(abCfg, 'utf8'))
if (abJson.provider.find((p: { id: string }) => p.id === 'ccui-proxy') || abJson.provider_settings?.default_provider_id !== 'existing-openai') { console.error('FAIL astrbot base_url revert'); process.exit(1) }
console.log('OK: astrbot base_url 回滚（移除 ccui-proxy，恢复原 default_provider_id）')
// 注：codex base_url 目标在 ~/.codex/config.toml（全局，marker prepend openai_base_url），受“不存在则跳过”护栏，不在测试触碰真实 home。

await fs.rm(dir, { recursive: true, force: true })
console.log('runtime-projection smoke passed')
