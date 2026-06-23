import { z } from 'zod'
import { CcuiErrorSchema } from './errors.js'

/**
 * Daemon → renderer 出站消息。
 * 五类：event(会话事件) / resp(请求响应) / ack(命令确认) / status(生命周期) / error(协议级错误)。
 */

/** 会话事件信封 —— event 字段为引擎事件流，载荷在 P5 逐步收紧。 */
export const EventMsgSchema = z.object({
  kind: z.literal('event'),
  sessionId: z.string(),
  event: z.unknown(),
})

/** 请求响应：ok=true 携带任意载荷；ok=false 必带 CcuiError 信封。 */
export const RespOkSchema = z.object({
  kind: z.literal('resp'),
  reqId: z.string().optional(),
  ok: z.literal(true),
}).catchall(z.unknown())

export const RespErrSchema = z.object({
  kind: z.literal('resp'),
  reqId: z.string().optional(),
  ok: z.literal(false),
  error: CcuiErrorSchema,
})

export const RespMsgSchema = z.union([RespOkSchema, RespErrSchema])

export const AckMsgSchema = z.object({
  kind: z.literal('ack'),
  cmd: z.string(),
}).catchall(z.unknown())

export const StatusMsgSchema = z.object({
  kind: z.literal('status'),
  state: z.enum(['starting', 'ready', 'busy', 'error', 'offline']),
})

export const PongMsgSchema = z.object({ kind: z.literal('pong') })

export const MessagesMsgSchema = z.object({
  kind: z.literal('messages'),
  sessionId: z.string(),
  messages: z.array(z.unknown()),
})

/** 抓包克隆：代理在瓶口抓到一次请求并蒸馏出整合包草稿后，实时推给 UI。 */
export const CaptureSummarySchema = z.object({
  id: z.string(),
  at: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number(),
  streamed: z.boolean(),
  model: z.string().nullable(),
  basePromptLen: z.number(),
  toolCount: z.number(),
  requestPreview: z.string(),
  responsePreview: z.string(),
  pack: z.unknown().nullable(),
})
export const CaptureMsgSchema = z.object({
  kind: z.literal('capture'),
  record: CaptureSummarySchema,
})

/** 协议级错误（坏 JSON、未知命令）—— 与业务 resp.error 区分。 */
export const ErrorMsgSchema = z.object({
  kind: z.literal('error'),
  error: z.union([z.string(), CcuiErrorSchema]),
})

export const DaemonMessageSchema = z.union([
  EventMsgSchema,
  RespMsgSchema,
  AckMsgSchema,
  StatusMsgSchema,
  PongMsgSchema,
  MessagesMsgSchema,
  CaptureMsgSchema,
  ErrorMsgSchema,
])

export type EventMsg = z.infer<typeof EventMsgSchema>
export type RespMsg = z.infer<typeof RespMsgSchema>
export type AckMsg = z.infer<typeof AckMsgSchema>
export type StatusMsg = z.infer<typeof StatusMsgSchema>
export type MessagesMsg = z.infer<typeof MessagesMsgSchema>
export type CaptureSummary = z.infer<typeof CaptureSummarySchema>
export type CaptureMsg = z.infer<typeof CaptureMsgSchema>
export type ErrorMsg = z.infer<typeof ErrorMsgSchema>
export type DaemonMessage = z.infer<typeof DaemonMessageSchema>

/** 成功响应载荷的通用形态。 */
export type RespOk<T = Record<string, unknown>> = {
  kind: 'resp'
  reqId?: string
  ok: true
} & T

export type RespErr = z.infer<typeof RespErrSchema>
export type Resp<T = Record<string, unknown>> = RespOk<T> | RespErr
