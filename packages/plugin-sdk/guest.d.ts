export interface CcuiPlugin {
  /** resolves once the host completes the handshake */
  ready: Promise<{ permissions: string[] }>
  /** show a toast in the host (requires "toast" permission) */
  toast(message: string, type?: string): Promise<void>
  /** emit a whitelisted bus event to the host (requires "bus:emit") */
  emit(event: string, payload?: unknown): Promise<void>
  /** read a snapshot of the shared store (requires "store:read") */
  getState(): Promise<Record<string, unknown>>
  /** call a whitelisted read-only daemon command (requires "daemon:request") */
  daemon(cmd: Record<string, unknown>): Promise<unknown>
  /** subscribe to a whitelisted host bus event (requires "bus:on") */
  on(event: string, fn: (payload: unknown) => void): () => void
}

export function createCcuiPlugin(pluginId: string): CcuiPlugin
