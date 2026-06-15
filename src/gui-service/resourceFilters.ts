/**
 * GUI 控制台硬过滤 — skill 命令池 / rule 记忆 / agent 定义
 */
import { getCommands, clearCommandsCache } from '../commands/registry.js'
import { clearMemoryFileCaches } from '../utils/claudemd.js'
import { clearAgentDefinitionsCache } from '../tools/AgentTool/loadAgentsDir.js'
import type { Command } from '../types/command.js'

export type ResourceMap = Record<string, { kind: string; name: string; path?: string }>

let disabledIds = new Set<string>()
let resourceMap: ResourceMap = {}

export function setDisabledResources(ids: string[], map?: ResourceMap): void {
  disabledIds = new Set(ids || [])
  if (map) resourceMap = map
  clearCommandsCache()
  clearMemoryFileCaches()
  clearAgentDefinitionsCache()
  void applyDisabledToEngine()
}

function disabledNames(kind: string): Set<string> {
  const names = new Set<string>()
  for (const id of disabledIds) {
    const m = resourceMap[id]
    if (m && m.kind === kind) names.add(m.name.toLowerCase())
    else if (id.startsWith(`${kind}:`)) {
      const parts = id.split(':')
      if (parts.length >= 3) names.add(parts.slice(2).join(':').toLowerCase())
    }
  }
  return names
}

/** 写入引擎：rule → claudeMdExcludes；agent → global hook；skill → getFilteredCommands */
export async function applyDisabledToEngine(): Promise<void> {
  const agents = new Set<string>()
  const excludePatterns: string[] = []
  for (const id of disabledIds) {
    const m = resourceMap[id]
    if (!m) continue
    if (m.kind === 'agent') agents.add(m.name.toLowerCase())
    if (m.kind === 'rule') {
      const p = (m.path || m.name).replace(/\\/g, '/')
      if (p) excludePatterns.push(p)
    }
  }
  ;(globalThis as Record<string, unknown>).__CCUI_DISABLED_AGENTS = agents
  try {
    const { enableConfigs } = await import('../utils/config.js')
    enableConfigs()
    const { updateSettingsForSource } = await import('../utils/settings/settings.js')
    updateSettingsForSource('local', { claudeMdExcludes: excludePatterns })
  } catch { /* settings 不可写时 rule 过滤降级 */ }
}

export async function getFilteredCommands(cwd: string): Promise<Command[]> {
  const all = await getCommands(cwd)
  const off = disabledNames('skill')
  if (!off.size) return all
  return all.filter(c => {
    if (c.type !== 'prompt') return true
    const loaded = (c as { loadedFrom?: string }).loadedFrom
    if (loaded && !['skills', 'plugin', 'bundled', 'mcp', 'commands_DEPRECATED', 'managed'].includes(loaded)) return true
    return !off.has(c.name.toLowerCase())
  })
}

/** loadAgentsDir 内 hook 调用 */
export function filterAgentsForGui<T extends { agentType: string }>(list: T[]): T[] {
  const disabled = (globalThis as Record<string, unknown>).__CCUI_DISABLED_AGENTS as Set<string> | undefined
  if (!disabled?.size) return list
  return list.filter(a => !disabled.has(a.agentType.toLowerCase()))
}
