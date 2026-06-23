/**
 * 热切换项目根目录 — 不重启 daemon 进程。
 */
import { setOriginalCwd, setProjectRoot, clearCommandsCache, clearMemoryFileCaches, clearAgentDefinitionsCache } from '@ccui/engine-api'
import { applyProjectRoot } from './bootstrap.js'
import { reloadMcpPool } from './mcpPool.js'
import type { AgentSession } from './agentSession.js'

export async function switchDaemonProject(
  cwd: string,
  sessions: Iterable<AgentSession>,
): Promise<void> {
  await applyProjectRoot(cwd)
  clearCommandsCache()
  clearMemoryFileCaches()
  clearAgentDefinitionsCache()
  await reloadMcpPool()
  for (const s of sessions) {
    await s.switchProject(cwd)
  }
}
