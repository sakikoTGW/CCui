/**
 * project-profile（项目心智 / 存档）—— 第三轴：agent 对**这个项目**的理解与目标。
 *
 * 三轴正交：能力(pack) × 项目(workspace) × 项目心智(profile)。
 * profile 绑定项目、默认不分发，是 PCL 意义上的「存档」：
 *   导出 → 换机器/换人/重建环境 → 导入 → agent 立刻「已经懂这个项目」。
 *
 * 仅采集 cwd 内、project-scope 的料（见 docs/TRUST_LOOP_PLAN.md §3）：
 *   结构图谱 / 约定(CLAUDE.md, project.yaml) / 历史目标(briefs) /
 *   项目记忆(.claude/agent-memory) / 代码索引元信息。
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

export type ProfileFile = { path: string; content: string }

export type ProjectProfile = {
  schema: 'ccui-profile/v1'
  name: string
  project: string
  exportedAt: string
  /** 采集到的 project-scope 文件（相对 cwd 的 posix 路径 + 内容） */
  files: ProfileFile[]
  stats: { graph: boolean; conventions: number; briefs: number; memory: number; codeIndex: boolean }
}

export type ProfileListItem = { path: string; name: string; mtimeMs: number; files: number }

/** project-scope 心智的采集面（相对 cwd）。目录递归，文件单收。 */
const PROFILE_DIRS = [
  '.ccui/briefs',
  '.claude/agent-memory',
  '.claude/rules',
]
const PROFILE_FILES = [
  '.claude/ccui-project-graph.json',
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  '.ccui/project.yaml',
  '.ccui/code-index.json',
]

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

async function walk(root: string, base: string): Promise<ProfileFile[]> {
  const out: ProfileFile[] = []
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const abs = join(root, e.name)
    if (e.isDirectory()) out.push(...(await walk(abs, base)))
    else {
      try {
        out.push({ path: relative(base, abs).replace(/\\/g, '/'), content: await fs.readFile(abs, 'utf8') })
      } catch { /* 跳过二进制/读失败 */ }
    }
  }
  return out
}

export async function exportProfile(cwd: string, name?: string): Promise<{ path: string; profile: ProjectProfile }> {
  const files: ProfileFile[] = []
  const seen = new Set<string>()
  const push = (f: ProfileFile) => { if (!seen.has(f.path)) { seen.add(f.path); files.push(f) } }

  let briefs = 0
  let memory = 0
  let conventions = 0
  for (const d of PROFILE_DIRS) {
    const abs = join(cwd, d)
    if (!(await exists(abs))) continue
    const fl = await walk(abs, cwd)
    for (const f of fl) {
      push(f)
      if (f.path.startsWith('.ccui/briefs/')) briefs++
      else if (f.path.startsWith('.claude/agent-memory/')) memory++
      else if (f.path.startsWith('.claude/rules/')) conventions++
    }
  }
  let graph = false
  let codeIndex = false
  for (const rel of PROFILE_FILES) {
    const abs = join(cwd, rel)
    if (!(await exists(abs))) continue
    try {
      const content = await fs.readFile(abs, 'utf8')
      push({ path: rel, content })
      if (rel.endsWith('ccui-project-graph.json')) graph = true
      else if (rel.endsWith('code-index.json')) codeIndex = true
      else conventions++
    } catch { /* skip */ }
  }

  const profileName = name || `${basename(cwd) || 'project'}-profile`
  const profile: ProjectProfile = {
    schema: 'ccui-profile/v1',
    name: profileName,
    project: cwd.replace(/\\/g, '/'),
    exportedAt: new Date().toISOString(),
    files,
    stats: { graph, conventions, briefs, memory, codeIndex },
  }
  const dir = join(cwd, '.ccui', 'profiles')
  await fs.mkdir(dir, { recursive: true })
  const outPath = join(dir, `${profileName.replace(/[^\w.-]+/g, '_')}.profile.json`)
  await fs.writeFile(outPath, JSON.stringify(profile, null, 2), 'utf8')
  return { path: outPath, profile }
}

export type ImportReport = { restored: string[]; skipped: string[]; manifestPath: string }

/**
 * 导入存档到目标项目，带安装清单（仅记录"我们新建的文件"，回滚只删这些，不动用户已有文件）。
 * overwrite=false：已存在的文件跳过（保护现场）；true：覆盖（不进清单回滚，避免误删用户原文件）。
 */
export async function importProfile(
  cwd: string,
  profile: ProjectProfile,
  opts: { overwrite?: boolean } = {},
): Promise<ImportReport> {
  const restored: string[] = []
  const skipped: string[] = []
  const created: string[] = []
  for (const f of profile.files ?? []) {
    const rel = f.path.replace(/\\/g, '/')
    // 安全：拒绝越界路径
    if (rel.includes('..') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) { skipped.push(`${rel} (非法路径)`); continue }
    const abs = join(cwd, rel)
    const had = await exists(abs)
    if (had && !opts.overwrite) { skipped.push(`${rel} (已存在，未覆盖)`); continue }
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, f.content, 'utf8')
    restored.push(rel)
    if (!had) created.push(rel)
  }
  const manifestDir = join(cwd, '.ccui', 'profiles')
  await fs.mkdir(manifestDir, { recursive: true })
  const manifestPath = join(manifestDir, `.imported-${(profile.name || 'profile').replace(/[^\w.-]+/g, '_')}.json`)
  await fs.writeFile(manifestPath, JSON.stringify({ importedAt: new Date().toISOString(), name: profile.name, created }, null, 2), 'utf8')
  return { restored, skipped, manifestPath }
}

/** 按导入清单回滚（只删我们新建的文件，不动用户原有的） */
export async function revertImportedProfile(cwd: string, manifestPath: string): Promise<{ removed: string[] }> {
  const removed: string[] = []
  try {
    const man = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { created?: string[] }
    for (const rel of man.created ?? []) {
      await fs.rm(join(cwd, rel), { force: true }).catch(() => {})
      removed.push(rel)
    }
    await fs.rm(manifestPath, { force: true }).catch(() => {})
  } catch { /* ignore */ }
  return { removed }
}

export async function listProfiles(cwd: string): Promise<ProfileListItem[]> {
  const dir = join(cwd, '.ccui', 'profiles')
  let names: string[] = []
  try {
    names = (await fs.readdir(dir)).filter(n => n.endsWith('.profile.json'))
  } catch {
    return []
  }
  const out: ProfileListItem[] = []
  for (const n of names) {
    const path = join(dir, n)
    let files = 0
    let mtimeMs = 0
    try {
      mtimeMs = (await fs.stat(path)).mtimeMs
      const p = JSON.parse(await fs.readFile(path, 'utf8')) as ProjectProfile
      files = p.files?.length ?? 0
    } catch { /* ignore */ }
    out.push({ path, name: n.replace(/\.profile\.json$/, ''), mtimeMs, files })
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}
