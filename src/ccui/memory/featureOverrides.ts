import {
  CCUI_DEFAULT_FEATURE_OVERRIDES,
  isCcuiMemoryEnabled,
} from './config.js'

let parsedEnvOverrides: Record<string, unknown> | null | undefined

function getEnvJsonOverrides(): Record<string, unknown> | null {
  if (parsedEnvOverrides !== undefined) {
    return parsedEnvOverrides
  }
  parsedEnvOverrides = null
  const raw = process.env.CCUI_FEATURE_OVERRIDES
  if (!raw) {
    return null
  }
  try {
    parsedEnvOverrides = JSON.parse(raw) as Record<string, unknown>
  } catch {
    parsedEnvOverrides = null
  }
  return parsedEnvOverrides
}

/** CCui 本地特性覆盖：在 GrowthBook 默认值之前生效 */
export function getCcuiFeatureOverride<T>(feature: string, defaultValue: T): T | undefined {
  if (!isCcuiMemoryEnabled()) {
    return undefined
  }
  const env = getEnvJsonOverrides()
  if (env && feature in env) {
    return env[feature] as T
  }
  if (feature in CCUI_DEFAULT_FEATURE_OVERRIDES) {
    return CCUI_DEFAULT_FEATURE_OVERRIDES[feature] as T
  }
  return undefined
}

export function resolveCcuiFeatureValue<T>(
  feature: string,
  upstreamValue: T,
  defaultValue: T,
): T {
  const override = getCcuiFeatureOverride(feature, defaultValue)
  return override !== undefined ? override : upstreamValue
}
