import { isCcuiMemoryEnabled } from './config.js'

const DEEPSEEK_DEFAULT_CONTEXT = 64_000
const DEEPSEEK_AUTOCOMPACT_BUFFER = 8_000

export function getCcuiMaxContextTokens(model: string): number | undefined {
  if (!isCcuiMemoryEnabled()) return undefined
  const env = process.env.CCUI_MAX_CONTEXT_TOKENS
  if (env) {
    const n = parseInt(env, 10)
    if (!isNaN(n) && n > 0) return n
  }
  const lower = model.toLowerCase()
  if (lower.includes('deepseek')) {
    return DEEPSEEK_DEFAULT_CONTEXT
  }
  return undefined
}

export function getCcuiAutocompactBuffer(): number | undefined {
  if (!isCcuiMemoryEnabled()) return undefined
  const env = process.env.CCUI_AUTOCOMPACT_BUFFER
  if (env) {
    const n = parseInt(env, 10)
    if (!isNaN(n) && n > 0) return n
  }
  return DEEPSEEK_AUTOCOMPACT_BUFFER
}
