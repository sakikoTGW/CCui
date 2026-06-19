import { z } from 'zod'

/**
 * 全局错误码 — 跨进程唯一真相。
 * renderer / daemon / indexer 共用；新增错误必须在此登记，禁止裸抛字符串。
 */
export const ErrorCode = {
  UNKNOWN: 'UNKNOWN',
  TIMEOUT: 'TIMEOUT',
  BAD_JSON: 'BAD_JSON',
  BAD_COMMAND: 'BAD_COMMAND',
  DAEMON_OFFLINE: 'DAEMON_OFFLINE',
  SESSION_CRASHED: 'SESSION_CRASHED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RESOURCE_SCAN_FAILED: 'RESOURCE_SCAN_FAILED',
  MAP_SCAN_FAILED: 'MAP_SCAN_FAILED',
  PROJECT_INFO_FAILED: 'PROJECT_INFO_FAILED',
  FILE_READ_FAILED: 'FILE_READ_FAILED',
  DIR_LIST_FAILED: 'DIR_LIST_FAILED',
  MCP_TOGGLE_FAILED: 'MCP_TOGGLE_FAILED',
  ORCHESTRATE_FAILED: 'ORCHESTRATE_FAILED',
  INDEXER_DOWN: 'INDEXER_DOWN',
  IDB_WRITE_FAILED: 'IDB_WRITE_FAILED',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export const ErrorCodeSchema = z.enum(
  Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]],
)

/** 统一错误信封 — 所有失败响应必须是这个形状。 */
export const CcuiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  /** 出错的功能模块（用于 UI 只灰该模块、不连坐）。 */
  feature: z.string().optional(),
  /** 可选附加调试信息，不展示给用户。 */
  detail: z.unknown().optional(),
})

export type CcuiError = z.infer<typeof CcuiErrorSchema>

/** 构造错误信封的便捷函数。 */
export function ccuiError(
  code: ErrorCode,
  message: string,
  opts?: { feature?: string; detail?: unknown },
): CcuiError {
  return { code, message, feature: opts?.feature, detail: opts?.detail }
}

/** 把任意抛出物归一成 CcuiError，禁止 message 丢失。 */
export function toCcuiError(
  err: unknown,
  code: ErrorCode = ErrorCode.UNKNOWN,
  feature?: string,
): CcuiError {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const e = err as Partial<CcuiError>
    if (typeof e.code === 'string' && typeof e.message === 'string') {
      return { code: e.code as ErrorCode, message: e.message, feature: feature ?? e.feature, detail: e.detail }
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { code, message, feature }
}
