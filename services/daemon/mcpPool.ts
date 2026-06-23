/**
 * GUI daemon 共享 MCP 连接池 — 与 CLI print 模式同路径：getClaudeCodeMcpConfigs + connect。
 * 所有 AgentSession 共用已连接客户端，避免 mcpClients: [] 导致 MCP 工具不可用。
 */
import type { Store, AppState } from '@ccui/engine-api'
import type { Command } from 'src/types/command.js'
import type { Tool } from 'src/core/tools.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import { getClaudeCodeMcpConfigs } from 'src/services/mcp/config.js'
import { getMcpToolsCommandsAndResources } from 'src/services/mcp/client.js'

function uniqByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    if (seen.has(it.name)) continue
    seen.add(it.name)
    out.push(it)
  }
  return out
}

let poolClients: MCPServerConnection[] = []
let poolTools: Tool[] = []
let poolCommands: Command[] = []
let connectPromise: Promise<void> | null = null
let lastError: string | null = null

export function getMcpPoolError(): string | null {
  return lastError
}

export function getConnectedMcpClients(): MCPServerConnection[] {
  return poolClients.filter(c => c.type === 'connected')
}

/** 将池内 MCP 状态同步进会话 store（assembleToolPool / ask 依赖 store.mcp） */
export function syncMcpToStore(store: Store<AppState>): void {
  store.setState(prev => ({
    ...prev,
    mcp: {
      ...prev.mcp,
      clients: poolClients.length ? poolClients : prev.mcp.clients,
      tools: poolTools.length
        ? uniqByName([...prev.mcp.tools, ...poolTools])
        : prev.mcp.tools,
      commands: poolCommands.length
        ? uniqByName([...prev.mcp.commands, ...poolCommands])
        : prev.mcp.commands,
    },
  }))
}

/** 首次连接；失败不抛（会话仍可走内置工具），错误写入 lastError */
export async function ensureMcpPool(): Promise<MCPServerConnection[]> {
  if (poolClients.some(c => c.type === 'connected')) {
    return getConnectedMcpClients()
  }
  if (!connectPromise) {
    connectPromise = (async () => {
      lastError = null
      try {
        const { servers } = await getClaudeCodeMcpConfigs()
        const names = Object.keys(servers)
        if (!names.length) return

        poolClients = names.map(name => ({
          name,
          type: 'pending' as const,
          config: servers[name]!,
        }))

        await getMcpToolsCommandsAndResources(({ client, tools, commands }) => {
          if (poolClients.some(c => c.name === client.name)) {
            poolClients = poolClients.map(c => (c.name === client.name ? client : c))
          } else {
            poolClients = [...poolClients, client]
          }
          if (tools.length) poolTools = uniqByName([...poolTools, ...tools])
          if (commands.length) poolCommands = uniqByName([...poolCommands, ...commands])
        }, servers)
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        process.stderr.write(`[mcpPool] connect failed: ${lastError}\n`)
      }
    })()
  }
  await connectPromise
  return getConnectedMcpClients()
}

/** MCP 配置变更后强制重连（toggle / add server） */
export async function reloadMcpPool(): Promise<void> {
  poolClients = []
  poolTools = []
  poolCommands = []
  connectPromise = null
  await ensureMcpPool()
}
