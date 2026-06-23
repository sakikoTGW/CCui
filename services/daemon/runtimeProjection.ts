/**
 * 按 runtime 的真实投射策略（驾驭外部 harness 的 MCP 端口 + Hermes external_dirs）。
 *
 * 各家 MCP 注册位置完全不同（见 docs/HARNESS_RESEARCH.md §7）：
 *   - claude-code/ccui/cursor : <cwd>/.mcp.json            （JSON, 顶层 mcpServers）
 *   - openclaw                : ~/.openclaw/openclaw.json   （JSON5, mcp.servers 嵌套）
 *   - hermes                  : ~/.hermes/config.yaml       （YAML, mcp_servers）
 *   - astrbot                 : <cwd>/data/mcp_server.json  （JSON, 顶层 mcpServers）
 *   - codex                   : ~/.codex/config.toml        （TOML, [mcp_servers.NAME]）—— 暂不自动写
 *
 * 纪律（PACK_SPEC §4）：写 ~/.hermes、~/.openclaw 等**全局配置**属侵入式——
 *   - 仅当目标配置**已存在**才合并（不凭空造一个残缺全局配置把引擎搞坏）；
 *   - 全部记安装清单，停用/切实例一键回滚（按 format 反向删除我们加的键）。
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import JSON5 from 'json5'

export type McpFormat =
  | 'json-mcpServers'   // <cwd>/.mcp.json, data/mcp_server.json
  | 'json5-openclaw'    // ~/.openclaw/openclaw.json -> mcp.servers
  | 'yaml-mcp_servers'  // ~/.hermes/config.yaml -> mcp_servers
  | 'toml-mcp_servers'  // ~/.codex/config.toml （暂不自动写）

export type McpTarget = {
  absFile: string
  /** 是否项目内（true=可创建；false=全局，仅当已存在才写） */
  projectLocal: boolean
  format: McpFormat
}

export type SkillStrategy =
  | { kind: 'copy-dir'; skillsDir: string; ruleDir: string }   // 拷进项目内目录
  | { kind: 'astrbot-plugin' }                                  // 生成插件
  | { kind: 'hermes-external'; configAbs: string }              // 注册 config.yaml skills.external_dirs

function home(): string {
  return homedir()
}

export function mcpTargetFor(runtime: string, cwd: string): McpTarget {
  switch (runtime) {
    case 'openclaw':
      return { absFile: join(home(), '.openclaw', 'openclaw.json'), projectLocal: false, format: 'json5-openclaw' }
    case 'hermes':
      return { absFile: join(home(), '.hermes', 'config.yaml'), projectLocal: false, format: 'yaml-mcp_servers' }
    case 'astrbot':
      return { absFile: join(cwd, 'data', 'mcp_server.json'), projectLocal: true, format: 'json-mcpServers' }
    case 'codex':
      return { absFile: join(home(), '.codex', 'config.toml'), projectLocal: false, format: 'toml-mcp_servers' }
    case 'ccui':
    case 'claude-code':
    case 'cursor':
    default:
      return { absFile: join(cwd, '.mcp.json'), projectLocal: true, format: 'json-mcpServers' }
  }
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

/** Codex TOML 的 [mcp_servers.NAME] 标记块（marker 包裹便于精确回滚） */
function tomlMcpBlock(name: string, cfg: Record<string, unknown>): string {
  const q = (v: unknown) => JSON.stringify(v) // TOML 字符串/数组语法与 JSON 兼容
  const lines = [`# >>> ccui-mcp:${name} >>>`, `[mcp_servers.${name}]`]
  if (cfg.url) lines.push(`url = ${q(cfg.url)}`)
  else {
    if (cfg.command) lines.push(`command = ${q(cfg.command)}`)
    if (Array.isArray(cfg.args)) lines.push(`args = ${q(cfg.args)}`)
  }
  if (cfg.env && typeof cfg.env === 'object') {
    lines.push(`[mcp_servers.${name}.env]`)
    for (const [k, v] of Object.entries(cfg.env as Record<string, unknown>)) lines.push(`${k} = ${q(v)}`)
  }
  lines.push(`# <<< ccui-mcp:${name} <<<`)
  return lines.join('\n')
}

/** 删除 Codex base_url 的 marker 块 */
function stripBaseUrlMarker(text: string): string {
  return text.replace(/# >>> ccui-baseurl >>>[\s\S]*?# <<< ccui-baseurl <<<\n?/g, '')
}

/** 删除 Codex TOML 中我们用 marker 包裹的块 */
function stripTomlMarkerBlocks(text: string, names: string[]): string {
  let out = text
  for (const n of names) {
    const re = new RegExp(`\\n?# >>> ccui-mcp:${n} >>>[\\s\\S]*?# <<< ccui-mcp:${n} <<<\\n?`, 'g')
    out = out.replace(re, '\n')
  }
  return out
}

export type McpServers = Record<string, Record<string, unknown>>

export type MergeResult = { added: string[]; skipped: string[]; file: string; format: McpFormat }

/** 把 servers 合并进目标（按格式），返回加入的名字。带 active:true。 */
export async function mergeMcp(target: McpTarget, servers: McpServers): Promise<MergeResult> {
  const names = Object.keys(servers)
  const out: MergeResult = { added: [], skipped: [], file: target.absFile, format: target.format }
  if (!names.length) return out

  if (target.format === 'toml-mcp_servers') {
    // Codex TOML：用标记块**追加**（[mcp_servers.NAME] 可定义在文件任意位置），
    // 零改写用户原有内容/注释；同名表已存在则跳过（避免 TOML 重复表报错）。
    if (!(await exists(target.absFile))) {
      out.skipped.push(...names.map(n => `${n} (${target.absFile} 不存在；请先安装 Codex)`))
      return out
    }
    let text = await fs.readFile(target.absFile, 'utf8')
    for (const n of names) {
      if (new RegExp(`(^|\\n)\\s*\\[mcp_servers\\.${n}\\]`).test(text)) {
        out.skipped.push(`${n} (config.toml 已有同名 [mcp_servers.${n}]，跳过)`)
        continue
      }
      text += `\n${tomlMcpBlock(n, servers[n])}\n`
      out.added.push(n)
    }
    if (out.added.length) await fs.writeFile(target.absFile, text, 'utf8')
    return out
  }

  const fileExists = await exists(target.absFile)
  if (!target.projectLocal && !fileExists) {
    // 全局配置不存在 → 不凭空造，跳过（该引擎大概率未安装）
    out.skipped.push(...names.map(n => `${n} (${target.absFile} 不存在；请先安装该引擎)`))
    return out
  }

  const withActive = (cfg: Record<string, unknown>) => ({ ...cfg, active: true })

  if (target.format === 'json-mcpServers') {
    const json = fileExists
      ? (JSON.parse(await fs.readFile(target.absFile, 'utf8')) as { mcpServers?: McpServers })
      : { mcpServers: {} }
    if (!json.mcpServers || typeof json.mcpServers !== 'object') json.mcpServers = {}
    for (const n of names) { json.mcpServers[n] = withActive(servers[n]); out.added.push(n) }
    await fs.mkdir(dirname(target.absFile), { recursive: true })
    await fs.writeFile(target.absFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
    return out
  }

  if (target.format === 'json5-openclaw') {
    const raw = await fs.readFile(target.absFile, 'utf8')
    const json = (JSON5.parse(raw) || {}) as { mcp?: { servers?: McpServers } }
    if (!json.mcp || typeof json.mcp !== 'object') json.mcp = {}
    if (!json.mcp.servers || typeof json.mcp.servers !== 'object') json.mcp.servers = {}
    for (const n of names) {
      // OpenClaw 用 transport 字段；stdio 默认
      const cfg = { ...servers[n] }
      if (!cfg.url && !cfg.transport) cfg.transport = 'stdio'
      json.mcp.servers[n] = cfg
      out.added.push(n)
    }
    // 写回标准 JSON（OpenClaw JSON5 能读 JSON 子集）；保留其余键
    await fs.writeFile(target.absFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
    return out
  }

  if (target.format === 'yaml-mcp_servers') {
    const raw = await fs.readFile(target.absFile, 'utf8')
    const doc = (yamlParse(raw) || {}) as { mcp_servers?: McpServers }
    if (!doc.mcp_servers || typeof doc.mcp_servers !== 'object') doc.mcp_servers = {}
    for (const n of names) {
      // Hermes mcp_servers：command/args/env 或 url/headers；enabled 控制启用
      const src = servers[n]
      const cfg: Record<string, unknown> = {}
      if (src.url) { cfg.url = src.url; if (src.headers) cfg.headers = src.headers }
      else { if (src.command) cfg.command = src.command; if (src.args) cfg.args = src.args; if (src.env) cfg.env = src.env }
      cfg.enabled = true
      doc.mcp_servers[n] = cfg
      out.added.push(n)
    }
    await fs.writeFile(target.absFile, yamlStringify(doc), 'utf8')
    return out
  }

  return out
}

/** 按 format 反向移除我们加入的键（回滚） */
export async function unmergeMcp(absFile: string, format: McpFormat, names: string[]): Promise<void> {
  if (!names.length || !(await exists(absFile))) return
  if (format === 'toml-mcp_servers') {
    const text = await fs.readFile(absFile, 'utf8')
    await fs.writeFile(absFile, stripTomlMarkerBlocks(text, names), 'utf8')
    return
  }
  if (format === 'json-mcpServers') {
    const json = JSON.parse(await fs.readFile(absFile, 'utf8')) as { mcpServers?: McpServers }
    if (json.mcpServers) for (const n of names) delete json.mcpServers[n]
    await fs.writeFile(absFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  } else if (format === 'json5-openclaw') {
    const json = JSON5.parse(await fs.readFile(absFile, 'utf8')) as { mcp?: { servers?: McpServers } }
    if (json.mcp?.servers) for (const n of names) delete json.mcp.servers[n]
    await fs.writeFile(absFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  } else if (format === 'yaml-mcp_servers') {
    const doc = (yamlParse(await fs.readFile(absFile, 'utf8')) || {}) as { mcp_servers?: McpServers }
    if (doc.mcp_servers) for (const n of names) delete doc.mcp_servers[n]
    await fs.writeFile(absFile, yamlStringify(doc), 'utf8')
  }
}

/** Hermes：把外部 skills 目录登记进 ~/.hermes/config.yaml 的 skills.external_dirs（非侵入挂载） */
export async function addHermesExternalDir(configAbs: string, skillsAbs: string): Promise<boolean> {
  if (!(await exists(configAbs))) return false
  const doc = (yamlParse(await fs.readFile(configAbs, 'utf8')) || {}) as {
    skills?: { external_dirs?: string[] }
  }
  if (!doc.skills || typeof doc.skills !== 'object') doc.skills = {}
  const list = Array.isArray(doc.skills.external_dirs) ? doc.skills.external_dirs : []
  if (!list.includes(skillsAbs)) list.push(skillsAbs)
  doc.skills.external_dirs = list
  await fs.writeFile(configAbs, yamlStringify(doc), 'utf8')
  return true
}

// ========== 瓶口：base_url 改道（把引擎请求指向 CCui 代理） ==========

export type BaseUrlFormat = 'claude-settings' | 'hermes-yaml' | 'openclaw-json5' | 'codex-toml' | 'astrbot-json'
export type BaseUrlTarget = { absFile: string; projectLocal: boolean; format: BaseUrlFormat } | null

export function baseUrlTargetFor(runtime: string, cwd: string): BaseUrlTarget {
  switch (runtime) {
    case 'ccui':
    case 'claude-code':
      return { absFile: join(cwd, '.claude', 'settings.json'), projectLocal: true, format: 'claude-settings' }
    case 'hermes':
      return { absFile: join(home(), '.hermes', 'config.yaml'), projectLocal: false, format: 'hermes-yaml' }
    case 'openclaw':
      return { absFile: join(home(), '.openclaw', 'openclaw.json'), projectLocal: false, format: 'openclaw-json5' }
    case 'codex':
      // 顶层标量 openai_base_url 把内置 openai provider 指向代理（无需新表，规避顶层 key 位置约束）
      return { absFile: join(home(), '.codex', 'config.toml'), projectLocal: false, format: 'codex-toml' }
    case 'astrbot':
      // provider 列表新增一个 OpenAI 兼容 provider 指向代理，并设为默认
      return { absFile: join(cwd, 'data', 'cmd_config.json'), projectLocal: true, format: 'astrbot-json' }
    default:
      return null
  }
}

function baseUrlBackupPath(cwd: string, runtime: string): string {
  return join(cwd, '.ccui', 'baseurl', `${runtime}.bak.json`)
}

export type BaseUrlResult = { ok: boolean; file?: string; skipped?: string }

/** 把某 runtime 的模型端点改道到 baseUrl（整文件备份以便精确回滚） */
export async function applyBaseUrl(
  runtime: string,
  cwd: string,
  baseUrl: string,
  opts: { providerId?: string } = {},
): Promise<BaseUrlResult> {
  const target = baseUrlTargetFor(runtime, cwd)
  if (!target) return { ok: false, skipped: `${runtime} 的 base_url 改道暂不支持自动写（codex 顶层约束/astrbot 形态特殊）` }
  const existed = await exists(target.absFile)
  if (!target.projectLocal && !existed) {
    return { ok: false, skipped: `${target.absFile} 不存在；请先安装该引擎` }
  }

  // 整文件备份（精确回滚）
  const backup = baseUrlBackupPath(cwd, runtime)
  await fs.mkdir(dirname(backup), { recursive: true })
  await fs.writeFile(backup, JSON.stringify({ file: target.absFile, existed, raw: existed ? await fs.readFile(target.absFile, 'utf8') : null }), 'utf8')

  const pid = opts.providerId || 'ccui'
  if (target.format === 'claude-settings') {
    const json = existed ? (JSON.parse(await fs.readFile(target.absFile, 'utf8')) as Record<string, unknown>) : {}
    const env = (json.env && typeof json.env === 'object' ? json.env : {}) as Record<string, unknown>
    env.ANTHROPIC_BASE_URL = baseUrl
    env.ENABLE_TOOL_SEARCH = 'true' // 非一方域名默认禁 tool search，显式开启（HARNESS_RESEARCH.md §2）
    json.env = env
    await fs.mkdir(dirname(target.absFile), { recursive: true })
    await fs.writeFile(target.absFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  } else if (target.format === 'hermes-yaml') {
    const doc = (yamlParse(await fs.readFile(target.absFile, 'utf8')) || {}) as { model?: Record<string, unknown> }
    doc.model = { ...(doc.model || {}), provider: 'custom', base_url: baseUrl }
    await fs.writeFile(target.absFile, yamlStringify(doc), 'utf8')
  } else if (target.format === 'openclaw-json5') {
    const json = (JSON5.parse(await fs.readFile(target.absFile, 'utf8')) || {}) as { models?: { providers?: Record<string, unknown> } }
    if (!json.models || typeof json.models !== 'object') json.models = {}
    if (!json.models.providers || typeof json.models.providers !== 'object') json.models.providers = {}
    json.models.providers[pid] = { baseUrl }
    await fs.writeFile(target.absFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  } else if (target.format === 'codex-toml') {
    // 顶层标量 openai_base_url（marker 包裹，prepend 到文件顶部，保留原文+注释）
    let text = await fs.readFile(target.absFile, 'utf8')
    text = stripBaseUrlMarker(text) // 幂等：先去掉我们之前注入的块
    if (/^\s*openai_base_url\s*=/m.test(text)) {
      // 还原备份并跳过：用户已手动设了 openai_base_url，不覆盖
      await fs.rm(backup, { force: true }).catch(() => {})
      return { ok: false, skipped: 'codex 已手动设置 openai_base_url，未覆盖' }
    }
    const block = `# >>> ccui-baseurl >>>\nopenai_base_url = ${JSON.stringify(baseUrl)}\n# <<< ccui-baseurl <<<\n`
    await fs.writeFile(target.absFile, block + text, 'utf8')
  } else if (target.format === 'astrbot-json') {
    if (!existed) {
      await fs.rm(backup, { force: true }).catch(() => {})
      return { ok: false, skipped: `${target.absFile} 不存在；请先初始化 AstrBot（data/cmd_config.json）` }
    }
    const json = JSON.parse(await fs.readFile(target.absFile, 'utf8')) as Record<string, unknown>
    const list = Array.isArray(json.provider) ? (json.provider as Array<Record<string, unknown>>) : []
    const filtered = list.filter(p => p?.id !== pid)
    filtered.push({
      id: pid, provider: 'openai', type: 'openai_chat_completion', provider_type: 'chat_completion',
      enable: true, key: [], api_base: baseUrl, timeout: 120,
    })
    json.provider = filtered
    const ps = (json.provider_settings && typeof json.provider_settings === 'object' ? json.provider_settings : {}) as Record<string, unknown>
    ps.default_provider_id = pid
    json.provider_settings = ps
    await fs.writeFile(target.absFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  }
  return { ok: true, file: target.absFile }
}

export async function revertBaseUrl(runtime: string, cwd: string): Promise<void> {
  const backup = baseUrlBackupPath(cwd, runtime)
  if (!(await exists(backup))) return
  const { file, existed, raw } = JSON.parse(await fs.readFile(backup, 'utf8')) as { file: string; existed: boolean; raw: string | null }
  if (existed && raw != null) await fs.writeFile(file, raw, 'utf8')
  else await fs.rm(file, { force: true }).catch(() => {})
  await fs.rm(backup, { force: true }).catch(() => {})
}

export async function removeHermesExternalDir(configAbs: string, skillsAbs: string): Promise<void> {
  if (!(await exists(configAbs))) return
  const doc = (yamlParse(await fs.readFile(configAbs, 'utf8')) || {}) as {
    skills?: { external_dirs?: string[] }
  }
  if (doc.skills?.external_dirs) {
    doc.skills.external_dirs = doc.skills.external_dirs.filter(d => d !== skillsAbs)
    await fs.writeFile(configAbs, yamlStringify(doc), 'utf8')
  }
}
