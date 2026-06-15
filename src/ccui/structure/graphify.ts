import { readFile } from 'fs/promises'
import { join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { logForDebugging } from '../../utils/debug.js'
import { isCcuiSubsystemEnabled, CCUI_SUBSYSTEM } from '../config.js'

const OUT_DIR = 'graphify-out'
const REPORT = 'GRAPH_REPORT.md'
const MAX_REPORT_CHARS = 10_000

let cached: string | null | undefined

export function initCcuiStructure(): void {
  cached = undefined
  logForDebugging('[ccui/structure] graphify layer ready', { level: 'debug' })
}

/**
 * L1 项目结构层：注入 graphify 图谱摘要 + 查询优先策略。
 * 不写入 memory 图谱（那是用户偏好层）。
 */
export async function getGraphifyContext(): Promise<string | null> {
  if (!isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.structure)) return null
  if (cached !== undefined) return cached

  const cwd = getOriginalCwd()
  const reportPath = join(cwd, OUT_DIR, REPORT)
  try {
    const raw = await readFile(reportPath, 'utf8')
    const excerpt = raw.trim().slice(0, MAX_REPORT_CHARS)
    cached = [
      '# Project structure (Graphify)',
      '',
      'Before broad Glob/Grep on source files, prefer structural reasoning from this report.',
      'If `graphify-out/graph.json` exists, use `graphify query` CLI when installed.',
      '',
      excerpt,
      raw.length > MAX_REPORT_CHARS
        ? `\n\n> Graphify report truncated. Full: ${reportPath}`
        : '',
    ].join('\n')
    return cached
  } catch {
    cached = [
      '# Project structure (Graphify)',
      '',
      'No graphify-out/GRAPH_REPORT.md yet. Run: pip install graphifyy && graphify .',
      'Until then, use Glob/Grep/FileRead as usual.',
    ].join('\n')
    return cached
  }
}

export function getGraphifySearchGuidance(): string {
  return [
    '## Code navigation (Graphify)',
    '- Architecture / dependency questions: consult graphify-out/GRAPH_REPORT.md first.',
    '- Prefer `graphify query "<question>"` over grepping the whole tree when the graph exists.',
    '- Do not confuse this with user memory files under ~/.claude/projects/.../memory/.',
  ].join('\n')
}
