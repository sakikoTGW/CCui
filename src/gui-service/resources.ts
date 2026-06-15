/**
 * GUI 控制台资源扫描 + 文件树/预览 —— 纯 fs，不触发引擎重载，headless 安全。
 *
 * 列举 skills / agents / rules / mcp（来源标注），并提供目录树与文件读取。
 * 开关语义：MCP 走引擎真开关（best-effort）；skill/agent/rule 由前端做"软禁用"
 * （注入系统提示），此处仅负责"发现 + 展示"。
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep, dirname, basename } from 'node:path'

export type ResKind = 'skill' | 'agent' | 'rule' | 'mcp'
export type ResItem = {
  id: string
  kind: ResKind
  name: string
  description: string
  path: string
  source: string
}

function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) {
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      if (k) out[k] = v
    }
  }
  return out
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}
async function readSafe(p: string): Promise<string> {
  try { return await fs.readFile(p, 'utf8') } catch { return '' }
}
function firstLine(s: string, n = 120): string {
  const t = s.replace(/^---[\s\S]*?---/, '').trim().split(/\r?\n/).find(l => l.trim())
  return (t || '').slice(0, n)
}

async function scanSkills(cwd: string): Promise<ResItem[]> {
  const roots = [
    { dir: join(cwd, '.claude', 'skills'), source: 'project' },
    { dir: join(homedir(), '.claude', 'skills'), source: 'user' },
  ]
  const items: ResItem[] = []
  for (const { dir, source } of roots) {
    let entries: import('node:fs').Dirent[] = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const skillFile = join(dir, e.name, 'SKILL.md')
      if (!(await exists(skillFile))) continue
      const text = await readSafe(skillFile)
      const fm = parseFrontmatter(text)
      items.push({
        id: `skill:${source}:${e.name}`, kind: 'skill',
        name: fm.name || e.name, description: fm.description || firstLine(text),
        path: skillFile, source,
      })
    }
  }
  return items
}

async function scanAgents(cwd: string): Promise<ResItem[]> {
  const roots = [
    { dir: join(cwd, '.claude', 'agents'), source: 'project' },
    { dir: join(homedir(), '.claude', 'agents'), source: 'user' },
  ]
  const items: ResItem[] = []
  for (const { dir, source } of roots) {
    let entries: import('node:fs').Dirent[] = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue
      const p = join(dir, e.name)
      const text = await readSafe(p)
      const fm = parseFrontmatter(text)
      items.push({
        id: `agent:${source}:${e.name}`, kind: 'agent',
        name: fm.name || e.name.replace(/\.md$/, ''), description: fm.description || firstLine(text),
        path: p, source,
      })
    }
  }
  return items
}

async function walkMd(dir: string, source: string, kind: ResKind, exts: string[]): Promise<ResItem[]> {
  const items: ResItem[] = []
  let entries: import('node:fs').Dirent[] = []
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return items }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { items.push(...(await walkMd(p, source, kind, exts))) }
    else if (exts.some(x => e.name.endsWith(x))) {
      const text = await readSafe(p)
      const fm = parseFrontmatter(text)
      items.push({
        id: `${kind}:${source}:${p}`, kind,
        name: fm.name || e.name, description: fm.description || firstLine(text),
        path: p, source,
      })
    }
  }
  return items
}

async function scanRules(cwd: string): Promise<ResItem[]> {
  const items: ResItem[] = []
  // 顶层记忆文件
  for (const f of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md']) {
    const p = join(cwd, f)
    if (await exists(p)) items.push({ id: `rule:project:${p}`, kind: 'rule', name: f, description: firstLine(await readSafe(p)), path: p, source: 'project' })
  }
  // 规则目录（含 cursor）
  items.push(...(await walkMd(join(cwd, '.claude', 'rules'), 'project', 'rule', ['.md'])))
  items.push(...(await walkMd(join(cwd, '.cursor', 'rules'), 'cursor', 'rule', ['.mdc', '.md'])))
  const userClaude = join(homedir(), '.claude', 'CLAUDE.md')
  if (await exists(userClaude)) items.push({ id: `rule:user:${userClaude}`, kind: 'rule', name: 'CLAUDE.md (user)', description: firstLine(await readSafe(userClaude)), path: userClaude, source: 'user' })
  return items
}

async function scanMcp(cwd: string): Promise<ResItem[]> {
  const items: ResItem[] = []
  const sources: Array<{ file: string; field: string[]; source: string }> = [
    { file: join(cwd, '.mcp.json'), field: ['mcpServers'], source: 'project' },
    { file: join(homedir(), '.claude.json'), field: ['mcpServers'], source: 'user' },
  ]
  for (const { file, source } of sources) {
    const raw = await readSafe(file)
    if (!raw) continue
    let json: Record<string, unknown>
    try { json = JSON.parse(raw) } catch { continue }
    const servers = (json.mcpServers || {}) as Record<string, { command?: string; url?: string; type?: string }>
    for (const [name, cfg] of Object.entries(servers)) {
      items.push({
        id: `mcp:${name}`, kind: 'mcp', name,
        description: cfg.url || cfg.command || cfg.type || '',
        path: file, source,
      })
    }
  }
  return items
}

export async function listResources(cwd: string): Promise<ResItem[]> {
  const [a, b, c, d] = await Promise.all([
    scanSkills(cwd).catch(() => []),
    scanAgents(cwd).catch(() => []),
    scanRules(cwd).catch(() => []),
    scanMcp(cwd).catch(() => []),
  ])
  return [...a, ...b, ...c, ...d]
}

// ---------- MCP 真开关（best-effort） ----------
export async function toggleMcp(name: string, enabled: boolean): Promise<boolean> {
  try {
    const mod = await import('../services/mcp/config.js')
    const fn = (mod as Record<string, unknown>).setMcpServerEnabled as
      | ((n: string, e: boolean) => void)
      | undefined
    if (fn) { fn(name, enabled); return true }
  } catch { /* ignore */ }
  return false
}

// ---------- 文件树 / 预览 ----------
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '.cache', 'coverage', '.turbo'])

export type DirEntry = { name: string; type: 'dir' | 'file'; path: string }

export async function listDir(cwd: string, target?: string): Promise<{ path: string; entries: DirEntry[] }> {
  const dir = target && target.length ? target : cwd
  let raw: import('node:fs').Dirent[] = []
  try { raw = await fs.readdir(dir, { withFileTypes: true }) } catch { return { path: dir, entries: [] } }
  const entries: DirEntry[] = raw
    .filter(e => !(e.isDirectory() && IGNORE.has(e.name)) && !e.name.startsWith('.git'))
    .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' as const : 'file' as const, path: join(dir, e.name) }))
    .sort((x, y) => (x.type === y.type ? x.name.localeCompare(y.name) : x.type === 'dir' ? -1 : 1))
  return { path: dir, entries }
}

export async function readFilePreview(path: string, maxBytes = 200_000): Promise<{ path: string; content: string; truncated: boolean; tooLarge: boolean }> {
  try {
    const stat = await fs.stat(path)
    if (stat.size > maxBytes) {
      const fh = await fs.open(path, 'r')
      const buf = Buffer.alloc(maxBytes)
      await fh.read(buf, 0, maxBytes, 0)
      await fh.close()
      return { path, content: buf.toString('utf8'), truncated: true, tooLarge: stat.size > 2_000_000 }
    }
    const content = await fs.readFile(path, 'utf8')
    return { path, content, truncated: false, tooLarge: false }
  } catch (e) {
    return { path, content: `读取失败：${(e as Error).message}`, truncated: false, tooLarge: false }
  }
}

export function relPath(cwd: string, p: string): string {
  const r = relative(cwd, p)
  return r.startsWith('..') ? p : r.split(sep).join('/')
}

// ---------- 项目结构 Graph（粉色龙 #2/#6 — 轻量 repomap，供 Agent 记忆 + UI） ----------
export type GraphNode = {
  id: string
  path: string
  label: string
  kind: 'dir' | 'file' | 'area'
  tokens?: number
}
export type GraphEdge = { from: string; to: string; kind: 'contains' | 'imports' }
export type ProjectGraph = {
  root: string
  scannedAt: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  summary: string
  stats: { dirs: number; files: number; importEdges: number }
}

const GRAPH_IGNORE = new Set([
  ...IGNORE,
  'vendor',
  'target',
  '.claude',
  '.cursor',
  'package-lock.json',
])
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.md', '.json', '.css', '.html'])
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const TOP_AREAS = ['src', 'gui', 'docs', 'scripts', 'packages', 'apps']

function nodeId(path: string): string {
  return path.replace(/\\/g, '/')
}

async function resolveImportSync(fromFile: string, spec: string): Promise<string | null> {
  if (!spec || spec.startsWith('node:')) return null
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null
  const base = spec.startsWith('/') ? spec : join(dirname(fromFile), spec)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]
  for (const c of candidates) {
    if (c.includes('node_modules')) continue
    try {
      await fs.access(c)
      return nodeId(c)
    } catch { /* next */ }
  }
  return null
}

function extractImports(text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(text))) {
    const s = m[1] || m[2]
    if (s) out.push(s)
  }
  return out
}

function buildSummary(nodes: GraphNode[], edges: GraphEdge[], _root: string): string {
  const areas = nodes.filter(n => n.kind === 'area')
  const topFiles = nodes.filter(n => n.kind === 'file').slice(0, 24)
  const lines = [
    `# Project graph`,
    '',
    '## Areas',
    ...areas.map(a => `- **${a.label}** — ${a.path}`),
    '',
    '## Key files',
    ...topFiles.map(f => `- \`${f.label}\``),
    '',
    '## Import edges (sample)',
    ...edges.filter(e => e.kind === 'imports').slice(0, 20).map(e => `- ${e.from.split('/').pop()} → ${e.to.split('/').pop()}`),
  ]
  return lines.join('\n')
}

export async function scanProjectGraph(cwd: string, maxFiles = 350): Promise<ProjectGraph> {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const filePaths: string[] = []

  nodes.push({ id: nodeId(cwd), path: nodeId(cwd), label: 'root', kind: 'area' })

  for (const area of TOP_AREAS) {
    const p = join(cwd, area)
    if (!(await exists(p))) continue
    const id = nodeId(p)
    nodes.push({ id, path: id, label: area, kind: 'area' })
    edges.push({ from: nodeId(cwd), to: id, kind: 'contains' })
    seen.add(id)
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5 || filePaths.length >= maxFiles) return
    let raw: import('node:fs').Dirent[] = []
    try { raw = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of raw) {
      if (GRAPH_IGNORE.has(e.name) || e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      const id = nodeId(p)
      if (e.isDirectory()) {
        if (!seen.has(id)) {
          seen.add(id)
          nodes.push({ id, path: id, label: e.name, kind: 'dir' })
          edges.push({ from: nodeId(dir), to: id, kind: 'contains' })
        }
        await walk(p, depth + 1)
      } else {
        const ext = e.name.includes('.') ? e.name.slice(e.name.lastIndexOf('.')) : ''
        if (!CODE_EXT.has(ext)) continue
        if (filePaths.length >= maxFiles) break
        filePaths.push(id)
        if (!seen.has(id)) {
          seen.add(id)
          nodes.push({ id, path: id, label: relPath(cwd, id), kind: 'file' })
          edges.push({ from: nodeId(dir), to: id, kind: 'contains' })
        }
      }
    }
  }

  await walk(cwd, 0)

  for (const fp of filePaths) {
    if (!/\.(ts|tsx|js|jsx)$/.test(fp)) continue
    const text = await readSafe(fp)
    if (!text || text.length > 120_000) continue
    for (const spec of extractImports(text)) {
      const target = await resolveImportSync(fp, spec)
      if (target && seen.has(target)) {
        edges.push({ from: fp, to: target, kind: 'imports' })
      }
    }
  }

  const summary = buildSummary(nodes, edges, cwd)
  const graph: ProjectGraph = {
    root: cwd,
    scannedAt: Date.now(),
    nodes,
    edges,
    summary,
    stats: {
      dirs: nodes.filter(n => n.kind === 'dir' || n.kind === 'area').length,
      files: nodes.filter(n => n.kind === 'file').length,
      importEdges: edges.filter(e => e.kind === 'imports').length,
    },
  }

  try {
    const cachePath = join(cwd, '.claude', 'ccui-project-graph.json')
    await fs.mkdir(join(cwd, '.claude'), { recursive: true })
    await fs.writeFile(cachePath, JSON.stringify(graph, null, 2), 'utf8')
  } catch { /* optional cache */ }

  return graph
}

export async function loadCachedProjectGraph(cwd: string): Promise<ProjectGraph | null> {
  try {
    const p = join(cwd, '.claude', 'ccui-project-graph.json')
    const raw = await fs.readFile(p, 'utf8')
    return JSON.parse(raw) as ProjectGraph
  } catch {
    return null
  }
}

/** 项目管理页：当前工作区概览 */
export async function getProjectInfo(cwd: string): Promise<{
  root: string
  name: string
  graphStats: ProjectGraph['stats'] | null
  skills: number
  agents: number
  rules: number
  mcp: number
  gitBranch: string | null
  hasClaudeMd: boolean
  hasEnv: boolean
  scannedAt: number | null
}> {
  const graph = await loadCachedProjectGraph(cwd)
  const resources = await listResources(cwd)
  let gitBranch: string | null = null
  try {
    const head = await fs.readFile(join(cwd, '.git', 'HEAD'), 'utf8')
    const m = head.match(/ref: refs\/heads\/(.+)/)
    gitBranch = m ? m[1].trim() : head.trim().slice(0, 7)
  } catch { /* not a git repo */ }
  const exists = async (p: string) => {
    try { await fs.access(p); return true } catch { return false }
  }
  return {
    root: cwd,
    name: basename(cwd) || cwd,
    graphStats: graph?.stats ?? null,
    skills: resources.filter(r => r.kind === 'skill').length,
    agents: resources.filter(r => r.kind === 'agent').length,
    rules: resources.filter(r => r.kind === 'rule').length,
    mcp: resources.filter(r => r.kind === 'mcp').length,
    gitBranch,
    hasClaudeMd: await exists(join(cwd, 'CLAUDE.md')),
    hasEnv: await exists(join(cwd, '.env')),
    scannedAt: graph?.scannedAt ?? null,
  }
}
