import { isEnvTruthy } from '../../utils/envUtils.js'

/** CCui 增强记忆总开关：开发模式默认开，可用 CCUI_MEMORY=0 关闭 */
export function isCcuiMemoryEnabled(): boolean {
  if (isEnvTruthy(process.env.CCUI_MEMORY_DISABLE)) {
    return false
  }
  if (isEnvTruthy(process.env.CCUI_MEMORY)) {
    return true
  }
  return isEnvTruthy(process.env.CLAUDE_CODE_DEV)
}

/** GrowthBook / Statsig 特性在 CCui 本地的强制覆盖 */
export const CCUI_DEFAULT_FEATURE_OVERRIDES: Record<string, unknown> = {
  tengu_moth_copse: true,
  tengu_passport_quail: true,
  tengu_slate_thimble: true,
  tengu_onyx_plover: { minHours: 12, minSessions: 3 },
}

export const CCUI_MEMORY_LIMITS = {
  MAX_RECALL_FILES: 8,
  MAX_MEMORY_LINES: 300,
  MAX_MEMORY_BYTES: 12_000,
  MAX_SESSION_BYTES: 120 * 1024,
  CHUNK_SIZE: 480,
  CHUNK_OVERLAP: 80,
  HYBRID_CANDIDATES: 20,
} as const
