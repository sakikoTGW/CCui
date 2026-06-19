/**
 * 多 Agent 编排：A/B/C 并行 + 交叉评审 + 汇总。
 * 每 lane 独立 AgentSession，事件带 laneId 推送。
 */
import { AgentSession } from './agentSession.js'

export type LaneSpec = {
  id: string
  label: string
  model?: string
  systemPrompt?: string
  /** GUI Thread 绑定的 daemon sessionId；有则复用 getSession，而非临时 Session */
  sessionId?: string
}

export type SessionResolver = (sessionId: string) => AgentSession

export type LaneResult = {
  laneId: string
  label: string
  text: string
  error?: string
}

export type ReviewResult = {
  reviewerId: string
  reviewerLabel: string
  targetId: string
  targetLabel: string
  text: string
}

type EmitFn = (obj: Record<string, unknown>) => void

function collectText(session: AgentSession, onDelta: (t: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    const unsub = session.onEvent(e => {
      if (e.type === 'delta' && e.kind === 'text') { text += e.text; onDelta(text) }
      if (e.type === 'text') { text += e.text; onDelta(text) }
      if (e.type === 'error') reject(new Error(e.error))
      if (e.type === 'done') { unsub(); resolve(text) }
    })
  })
}

export class Orchestrator {
  private lanes = new Map<string, AgentSession>()
  private running = false
  private emit: EmitFn
  private resolveSession?: SessionResolver

  constructor(emit: EmitFn, resolveSession?: SessionResolver) {
    this.emit = emit
    this.resolveSession = resolveSession
  }

  isRunning(): boolean { return this.running }

  interrupt(): void {
    for (const s of this.lanes.values()) s.interrupt()
    this.running = false
  }

  private mkSession(laneId: string, sessionId?: string): AgentSession {
    if (sessionId && this.resolveSession) {
      const session = this.resolveSession(sessionId)
      this.lanes.set(laneId, session)
      return session
    }
    const session = new AgentSession({ cwd: process.cwd(), autoApprove: true, maxTurns: 12 })
    session.onEvent(event => this.emit({ kind: 'orch_event', laneId, event }))
    this.lanes.set(laneId, session)
    return session
  }

  /** A/B/C 并行跑同一 prompt */
  async runParallel(prompt: string, specs: LaneSpec[]): Promise<LaneResult[]> {
    this.running = true
    this.lanes.clear()
    const results: LaneResult[] = []
    try {
      await Promise.all(specs.map(async spec => {
        const bound = !!(spec.sessionId && this.resolveSession)
        const session = this.mkSession(spec.id, spec.sessionId)
        let text = ''
        try {
          const done = collectText(session, t => {
            text = t
            if (!bound) this.emit({ kind: 'orch_delta', laneId: spec.id, text: t })
          })
          await session.send(prompt, { model: spec.model, systemPrompt: spec.systemPrompt })
          text = await done
          results.push({ laneId: spec.id, label: spec.label, text })
          this.emit({ kind: 'orch_lane_done', laneId: spec.id, text })
        } catch (e) {
          const err = (e as Error).message
          results.push({ laneId: spec.id, label: spec.label, text: '', error: err })
          this.emit({ kind: 'orch_lane_error', laneId: spec.id, error: err })
        }
      }))
    } finally {
      this.running = false
    }
    return results
  }

  /** 交叉评审：每个 lane 评审下一个 lane 的产出（环状） */
  async crossReview(laneResults: LaneResult[]): Promise<ReviewResult[]> {
    const ok = laneResults.filter(r => r.text && !r.error)
    if (ok.length < 2) return []
    this.running = true
    const reviews: ReviewResult[] = []
    try {
      await Promise.all(ok.map(async (reviewer, i) => {
        const target = ok[(i + 1) % ok.length]
        const session = this.mkSession(`review_${reviewer.laneId}`)
        const prompt = `你是评审员「${reviewer.label}」。请评审方案「${target.label}」的产出，用中文列出：1) 主要优点 2) 关键问题 3) 具体改进建议。不要重写全文。\n\n--- 待评审 ---\n${target.text.slice(0, 12000)}`
        let text = ''
        try {
          const done = collectText(session, t => {
            text = t
            this.emit({ kind: 'orch_review_delta', reviewerId: reviewer.laneId, targetId: target.laneId, text: t })
          })
          await session.send(prompt, { model: reviewer.laneId === 'A' ? undefined : undefined })
          text = await done
          reviews.push({ reviewerId: reviewer.laneId, reviewerLabel: reviewer.label, targetId: target.laneId, targetLabel: target.label, text })
          this.emit({ kind: 'orch_review_done', reviewerId: reviewer.laneId, targetId: target.laneId, text })
        } catch {
          reviews.push({ reviewerId: reviewer.laneId, reviewerLabel: reviewer.label, targetId: target.laneId, targetLabel: target.label, text: '评审失败' })
        }
      }))
    } finally {
      this.running = false
    }
    return reviews
  }

  /** 汇总：综合所有方案 + 评审，输出最终推荐 */
  async synthesize(prompt: string, laneResults: LaneResult[], reviews: ReviewResult[]): Promise<string> {
    const session = this.mkSession('synth')
    this.running = true
    try {
      const body = laneResults.map(r => `## ${r.label}\n${r.text || r.error || '(空)'}`).join('\n\n')
      const rev = reviews.map(r => `### ${r.reviewerLabel} → ${r.targetLabel}\n${r.text}`).join('\n\n')
      const synthPrompt = `原始任务：${prompt}\n\n以下是 A/B/C 多方案产出与交叉评审。请用中文给出：1) 各方案对比摘要 2) 推荐采纳哪一版及理由 3) 可合并的最优实施清单。\n\n${body}\n\n--- 交叉评审 ---\n${rev}`
      let text = ''
      const done = collectText(session, t => { text = t; this.emit({ kind: 'orch_synth_delta', text: t }) })
      await session.send(synthPrompt)
      return await done
    } finally {
      this.running = false
    }
  }
}
