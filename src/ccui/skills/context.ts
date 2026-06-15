import { logForDebugging } from '../../utils/debug.js'
import { CCUI_SUBSYSTEM, isCcuiSubsystemEnabled } from '../config.js'

let ready = false

/** L4 专长层：技能走既有 loadSkillsDir，不塞进 system prompt */
export function initCcuiSkills(): void {
  ready = true
  logForDebugging(
    '[ccui/skills] on-demand skills via .claude/skills/ (pm/taste/agent/markitdown/graphify)',
    { level: 'info' },
  )
}

export function getCcuiSkillsGuidance(): string | null {
  if (!ready || !isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.skills)) {
    return null
  }
  return [
    '## CCui skills (on-demand)',
    '- Skills live in `.claude/skills/` — invoke via Skill tool when relevant, not preloaded into every turn.',
    '- `pm-*`: product workflows (pm-skills). `taste-*`: frontend aesthetics. `agent-*`: coroboros utilities.',
    '- `graphify`: codebase structure queries. `md-*`: markitdown document conversion.',
    '- Refresh links after vendor update: `bun run seed-skills`.',
  ].join('\n')
}
