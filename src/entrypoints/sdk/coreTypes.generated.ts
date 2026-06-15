/**
 * Generated SDK core types (dev stub).
 * Full generation: bun scripts/generate-sdk-types.ts
 */

export type SDKMessage = Record<string, unknown> & { type: string }
export type SDKUserMessage = Record<string, unknown> & { type: 'user' }
export type SDKResultMessage = Record<string, unknown> & { type: 'result' }
export type SDKResultSuccess = Record<string, unknown> & {
  type: 'result'
  subtype: 'success'
}
export type SDKResultError = Record<string, unknown> & {
  type: 'result'
  subtype: 'error'
}
export type SDKSessionInfo = Record<string, unknown>
export type SDKAssistantMessage = Record<string, unknown> & { type: 'assistant' }
export type SDKSystemMessage = Record<string, unknown> & { type: 'system' }
export type SDKPartialAssistantMessage = Record<string, unknown>
export type SDKStreamlinedTextMessage = Record<string, unknown>
export type SDKStreamlinedToolUseSummaryMessage = Record<string, unknown>
export type SDKPostTurnSummaryMessage = Record<string, unknown>
export type SDKPermissionDenial = Record<string, unknown>
export type SlashCommand = Record<string, unknown>
export type AgentDefinition = Record<string, unknown>
export type PermissionMode = string
export type PermissionUpdate = Record<string, unknown>
export type ModelUsage = Record<string, unknown>
export type HookEvent = string
export type HookInput = Record<string, unknown>
export type McpServerConfigForProcessTransport = Record<string, unknown>
export type McpServerStatus = Record<string, unknown>
export type ModelInfo = Record<string, unknown>
export type AccountInfo = Record<string, unknown>
export type AgentInfo = Record<string, unknown>
export type FastModeState = Record<string, unknown>
export type RewindFilesResult = Record<string, unknown>
export type SdkPluginConfig = Record<string, unknown>
export type ThinkingConfig = Record<string, unknown>
export type OutputFormat = Record<string, unknown>
export type ConfigScope = 'local' | 'user' | 'project'
export type ApiKeySource = string
