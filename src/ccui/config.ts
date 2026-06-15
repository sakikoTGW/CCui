import { isEnvTruthy } from '../utils/envUtils.js'

/** CCui 增强栈总开关 */
export function isCcuiStackEnabled(): boolean {
  if (isEnvTruthy(process.env.CCUI_STACK_DISABLE)) return false
  if (isEnvTruthy(process.env.CCUI_STACK)) return true
  return isEnvTruthy(process.env.CLAUDE_CODE_DEV)
}

export function isCcuiSubsystemEnabled(name: string): boolean {
  if (!isCcuiStackEnabled()) return false
  const off = process.env.CCUI_SUBSYSTEMS_OFF
  if (off?.split(',').map(s => s.trim()).includes(name)) return false
  const on = process.env.CCUI_SUBSYSTEMS
  if (on) return on.split(',').map(s => s.trim()).includes(name)
  return true
}

export const CCUI_SUBSYSTEM = {
  memory: 'memory',
  structure: 'structure',
  headroom: 'headroom',
  ingest: 'ingest',
  vault: 'vault',
  skills: 'skills',
} as const
