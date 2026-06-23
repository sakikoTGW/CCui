/**
 * 资源管理（增删 + 可用性验证）—— 让「设置 > 能力」能真正添加并确认 MCP / Skills / Rules，
 * 而不只是开关。所有写操作落到项目目录；验证 best-effort 但诚实标注。
 */
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'

type McpConfig = {
  type?: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

const MCP_FILE = (cwd: string) => join(cwd, '.mcp.json')

async function readMcpJson(cwd: string): Promise<{ mcpServers: Record<string, McpConfig> }> {
  try {
    const raw = await fs.readFile(MCP_FILE(cwd), 'utf8')
    const json = JSON.parse(raw)
    if (!json.mcpServers || typeof json.mcpServers !== 'object') json.mcpServers = {}
    return json
  } catch {
    return { mcpServers: {} }
  }
}

async function writeMcpJson(cwd: string, json: { mcpServers: Record<string, McpConfig> }): Promise<void> {
  await fs.writeFile(MCP_FILE(cwd), `${JSON.stringify(json, null, 2)}\n`, 'utf8')
}

export async function addMcpServer(cwd: string, name: string, config: McpConfig): Promise<{ ok: boolean; file: string }> {
  const clean = String(name || '').trim()
  if (!clean) throw new Error('MCP 名称不能为空')
  const json = await readMcpJson(cwd)
  const cfg: McpConfig = {}
  if (config.url) {
    cfg.type = config.type === 'sse' ? 'sse' : 'http'
    cfg.url = config.url
  } else {
    cfg.type = 'stdio'
    cfg.command = config.command || ''
    if (config.args?.length) cfg.args = config.args
    if (!cfg.command) throw new Error('stdio 类型需要 command')
  }
  if (config.env && Object.keys(config.env).length) cfg.env = config.env
  json.mcpServers[clean] = cfg
  await writeMcpJson(cwd, json)
  return { ok: true, file: MCP_FILE(cwd) }
}

export async function removeMcpServer(cwd: string, name: string): Promise<{ ok: boolean }> {
  const json = await readMcpJson(cwd)
  if (json.mcpServers[name]) {
    delete json.mcpServers[name]
    await writeMcpJson(cwd, json)
    return { ok: true }
  }
  return { ok: false }
}

/** 验证 MCP 可用性：stdio→命令是否在 PATH；http/sse→URL 是否可达。诚实标注 level。 */
export async function verifyMcp(
  cwd: string,
  name: string,
): Promise<{ ok: boolean; reachable: boolean; level: string; detail: string }> {
  const json = await readMcpJson(cwd)
  const cfg = json.mcpServers[name]
  if (!cfg) return { ok: false, reachable: false, level: 'none', detail: '未找到该 MCP 配置' }

  if (cfg.url) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const resp = await fetch(cfg.url, { method: 'GET', signal: ctrl.signal }).catch(e => {
        throw e
      })
      clearTimeout(timer)
      return {
        ok: true,
        reachable: resp.status < 500,
        level: 'url',
        detail: `HTTP ${resp.status}（URL 可达，未做完整 MCP 握手）`,
      }
    } catch (e) {
      return { ok: true, reachable: false, level: 'url', detail: `URL 不可达：${(e as Error).message}` }
    }
  }

  const cmd = cfg.command || ''
  if (!cmd) return { ok: false, reachable: false, level: 'none', detail: '配置缺少 command/url' }
  const resolved = typeof Bun !== 'undefined' && typeof Bun.which === 'function' ? Bun.which(cmd) : null
  if (resolved) {
    return { ok: true, reachable: true, level: 'command', detail: `命令可达：${resolved}（未做完整 MCP 握手）` }
  }
  // npx/uvx 这类包启动器即使在 PATH，包本身仍需联网拉取；命令不在 PATH 则明确不可达
  return { ok: true, reachable: false, level: 'command', detail: `命令不在 PATH：${cmd}` }
}

/** 从本机路径添加 skill（含 SKILL.md 的目录）→ 拷进 .claude/skills/<名>。 */
export async function addSkillFromPath(cwd: string, srcDir: string): Promise<{ ok: boolean; name: string }> {
  const src = String(srcDir || '').trim()
  if (!src) throw new Error('请提供 skill 目录路径')
  const skillMd = join(src, 'SKILL.md')
  try {
    await fs.access(skillMd)
  } catch {
    throw new Error('该目录下没有 SKILL.md')
  }
  const name = basename(src)
  const dest = join(cwd, '.claude', 'skills', name)
  await fs.mkdir(join(cwd, '.claude', 'skills'), { recursive: true })
  await fs.cp(src, dest, { recursive: true })
  return { ok: true, name }
}

/** 从本机路径添加 rule 文件 → 拷进 .claude/rules/<文件名>。 */
export async function addRuleFromPath(cwd: string, srcFile: string): Promise<{ ok: boolean; name: string }> {
  const src = String(srcFile || '').trim()
  if (!src) throw new Error('请提供 rule 文件路径')
  const name = basename(src)
  const destDir = join(cwd, '.claude', 'rules')
  await fs.mkdir(destDir, { recursive: true })
  await fs.copyFile(src, join(destDir, name))
  return { ok: true, name }
}
