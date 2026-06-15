export const BROWSER_TOOLS: string[] = []

export type ClaudeForChromeContext = Record<string, unknown>
export type Logger = { debug?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
export type PermissionMode = string

export async function createClaudeForChromeMcpServer(): Promise<{ close: () => Promise<void> }> {
  return { close: async () => {} }
}
