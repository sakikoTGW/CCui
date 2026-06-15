import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { logForDebugging } from '../../utils/debug.js'

const MAX_RULE_FILES = 32
const MAX_TOTAL_CHARS = 48_000
const MAX_FILE_CHARS = 12_000

async function collectRuleFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  try {
    const entries = await readdir(dir, { recursive: true })
    for (const entry of entries) {
      const rel = typeof entry === 'string' ? entry : entry.name
      const lower = rel.toLowerCase()
      if (lower.endsWith('.mdc') || lower.endsWith('.md')) {
        out.push(join(dir, rel))
      }
      if (out.length >= MAX_RULE_FILES) break
    }
  } catch {
    return []
  }
  return out
}

function stripMdcFrontmatter(raw: string): string {
  if (!raw.startsWith('---\n')) return raw.trim()
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) return raw.trim()
  return raw.slice(end + 5).trim()
}

/**
 * 加载项目 .cursor/rules 与根目录 .cursorrules，注入 userContext。
 */
export async function loadCursorRulesContext(): Promise<string | null> {
  const cwd = getOriginalCwd()
  const parts: string[] = []
  let total = 0

  const rootRules = join(cwd, '.cursorrules')
  try {
    const raw = await readFile(rootRules, 'utf8')
    const body = raw.trim().slice(0, MAX_FILE_CHARS)
    if (body) {
      parts.push(`### .cursorrules\n${body}`)
      total += body.length
    }
  } catch {
    // optional
  }

  const rulesDir = join(cwd, '.cursor', 'rules')
  const files = await collectRuleFiles(rulesDir)
  for (const filePath of files) {
    if (total >= MAX_TOTAL_CHARS) break
    try {
      const raw = await readFile(filePath, 'utf8')
      const body = stripMdcFrontmatter(raw).slice(0, MAX_FILE_CHARS)
      if (!body) continue
      const rel = filePath.replace(cwd, '').replace(/^[/\\]/, '')
      parts.push(`### ${rel}\n${body}`)
      total += body.length
    } catch {
      continue
    }
  }

  if (parts.length === 0) {
    return null
  }

  logForDebugging(
    `[ccui] loaded ${parts.length} cursor rule section(s), ~${total} chars`,
    { level: 'debug' },
  )

  return [
    '# Cursor project rules (auto-injected by CCui)',
    '',
    parts.join('\n\n'),
  ].join('\n')
}
