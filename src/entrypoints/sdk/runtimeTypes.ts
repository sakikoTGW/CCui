/**
 * SDK runtime types — callbacks and non-serializable interfaces (dev stub).
 */

import type { z } from 'zod/v4'
import type { SDKMessage, SDKResultMessage, SDKSessionInfo, SDKUserMessage } from './coreTypes.js'

export type AnyZodRawShape = Record<string, z.ZodTypeAny>
export type InferShape<T extends AnyZodRawShape> = {
  [K in keyof T]: z.infer<T[K]>
}

export type Options = Record<string, unknown>
export type InternalOptions = Record<string, unknown>
export type Query = AsyncIterable<SDKMessage>
export type InternalQuery = AsyncIterable<SDKMessage>

export type ListSessionsOptions = Record<string, unknown>
export type GetSessionInfoOptions = Record<string, unknown>
export type GetSessionMessagesOptions = Record<string, unknown>
export type SessionMutationOptions = Record<string, unknown>
export type ForkSessionOptions = Record<string, unknown>
export type ForkSessionResult = { sessionId: string }

export type SDKSessionOptions = Record<string, unknown>
export type SDKSession = {
  query: (prompt: string) => AsyncIterable<SDKMessage>
  close: () => Promise<void>
}

export type SessionMessage = Record<string, unknown>
export type McpSdkServerConfigWithInstance = Record<string, unknown>
export type SdkMcpToolDefinition<T extends AnyZodRawShape = AnyZodRawShape> = {
  name: string
  description: string
  inputSchema: T
}

export type { SDKMessage, SDKResultMessage, SDKSessionInfo, SDKUserMessage }
