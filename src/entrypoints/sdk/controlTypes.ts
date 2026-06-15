/**
 * SDK control protocol types (dev stub).
 * Full generation: bun scripts/generate-sdk-types.ts
 */

export type SDKControlRequest = Record<string, unknown> & {
  type: 'control_request'
  request_id: string
  request: Record<string, unknown>
}

export type SDKControlResponse = Record<string, unknown> & {
  type: 'control_response'
  response: Record<string, unknown>
}

export type SDKControlInitializeRequest = Record<string, unknown>
export type SDKControlInitializeResponse = Record<string, unknown>
export type SDKControlPermissionRequest = Record<string, unknown>
export type SDKControlMcpSetServersResponse = Record<string, unknown> & {
  plugins?: unknown[]
}
export type SDKControlReloadPluginsResponse = Record<string, unknown> & {
  plugins?: unknown[]
}
export type SDKControlCancelRequest = Record<string, unknown>
export type SDKKeepAliveMessage = Record<string, unknown> & { type: 'keep_alive' }

export type StdoutMessage = Record<string, unknown> & { type: string }
export type StdinMessage = Record<string, unknown> & { type: string }
