import { getSessionId } from '../../bootstrap/state.js'
import { registerPostSamplingHook } from '../../utils/hooks/postSamplingHooks.js'
import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import { logForDebugging } from '../../utils/debug.js'
import { isCcuiMemoryEnabled } from './config.js'
import { runIncrementalMemoryPass } from './incrementalExtract.js'

let initialized = false

async function incrementalHook(context: REPLHookContext): Promise<void> {
  if (context.querySource !== 'repl_main_thread') return
  const sessionId = getSessionId() ?? 'local'
  await runIncrementalMemoryPass(context.messages, sessionId)
}

export function initCcuiMemory(): void {
  if (initialized || !isCcuiMemoryEnabled()) return
  initialized = true
  registerPostSamplingHook(incrementalHook)
  logForDebugging('[ccui] memory subsystem initialized', { level: 'info' })
}
