import { writeFileSync } from 'fs'
import { join } from 'path'
import { isEnvTruthy } from './envUtils.js'

export const CCUI_PROGRESS_PREFIX = 'CCUI_PROGRESS:'
export const CCUI_READY_MARKER = 'CCUI_READY'

/** 开发模式启动进度（stderr 协议行 + 状态文件，供进度条与自动验收读取） */
export function devStartupProgress(percent: number, label: string): void {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_DEV)) return
  const pct = Math.min(100, Math.max(0, Math.round(percent)))
  process.stderr.write(`${CCUI_PROGRESS_PREFIX}${pct}:${label}\n`)
  try {
    writeFileSync(
      join(process.cwd(), '.ccui-startup-status'),
      JSON.stringify({ percent: pct, label, at: new Date().toISOString() }),
      'utf8',
    )
  } catch {
    // 非致命：状态文件仅用于验收脚本
  }
}

export function devStartupReady(): void {
  devStartupProgress(100, 'REPL 已就绪，可以输入')
  if (isEnvTruthy(process.env.CLAUDE_CODE_DEV)) {
    process.stderr.write(`${CCUI_READY_MARKER}\n`)
  }
}
