import { CommandSchema, type Command } from './commands.js'
import { ccuiError, ErrorCode, type CcuiError } from './errors.js'

/**
 * 解析入站命令。成功返回 { ok:true, command }，失败返回 { ok:false, error }。
 * daemon 边界用它替代裸 JSON.parse + as Command，杜绝未经校验的命令进 handler。
 */
export type ParseResult =
  | { ok: true; command: Command }
  | { ok: false; error: CcuiError }

export function parseCommand(raw: unknown): ParseResult {
  const result = CommandSchema.safeParse(raw)
  if (result.success) return { ok: true, command: result.data }
  const issue = result.error.issues[0]
  const path = issue?.path?.join('.') || '(root)'
  const cmd = (raw as { cmd?: unknown })?.cmd
  return {
    ok: false,
    error: ccuiError(
      ErrorCode.BAD_COMMAND,
      `非法命令 ${typeof cmd === 'string' ? cmd : '(无 cmd)'}：${path} ${issue?.message ?? ''}`.trim(),
      { detail: result.error.issues },
    ),
  }
}

/** 解析 NDJSON 一行；坏 JSON 返回 BAD_JSON。 */
export function parseCommandLine(line: string): ParseResult {
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    return { ok: false, error: ccuiError(ErrorCode.BAD_JSON, `坏 JSON: ${line.slice(0, 200)}`) }
  }
  return parseCommand(json)
}
