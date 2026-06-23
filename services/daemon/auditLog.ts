/**
 * 审计日志 —— 每一次权限决策 append-only 落盘，让「谁批了什么」可追溯。
 * 这是「可托付」的硬要求：门禁拦了什么、放了什么、谁拍的，必须留痕。
 * 文件：<cwd>/.ccui/audit/decisions.jsonl（每行一条 JSON）。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export type AuditDecision = {
  ts: string
  sessionId: string
  tool: string
  behavior: 'allow' | 'deny'
  /** 是否由整合包合同强制审查（即使引擎判 allow） */
  forced?: boolean
  /** 是否高风险工具 */
  highRisk?: boolean
  /** 来源：auto=引擎判定 / policy=allowedTools放行 / user=人审 / autoApprove=无人值守 */
  source: 'auto' | 'policy' | 'user' | 'autoApprove'
  reason?: string
}

function auditFile(cwd: string): string {
  return join(cwd, '.ccui', 'audit', 'decisions.jsonl')
}

export async function recordDecision(cwd: string, d: Omit<AuditDecision, 'ts'>): Promise<void> {
  try {
    const file = auditFile(cwd)
    await fs.mkdir(join(cwd, '.ccui', 'audit'), { recursive: true })
    await fs.appendFile(file, `${JSON.stringify({ ts: new Date().toISOString(), ...d })}\n`, 'utf8')
  } catch {
    /* 审计写失败不应阻断会话，但绝不静默吞掉决策本身（决策由 gate 保证） */
  }
}

export async function readAudit(cwd: string, limit = 200): Promise<AuditDecision[]> {
  try {
    const raw = await fs.readFile(auditFile(cwd), 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    const tail = lines.slice(-limit)
    const out: AuditDecision[] = []
    for (const l of tail) {
      try { out.push(JSON.parse(l) as AuditDecision) } catch { /* skip 坏行 */ }
    }
    return out.reverse()
  } catch {
    return []
  }
}
