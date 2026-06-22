// Thread 领域模型 — 与 daemon sessionId 一一对应（Codex：一条 thread = 一个 agent 会话）
import { uid } from './db.js'

export function newSessionId(prefix = 'thread') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function blankThread(title = '新对话') {
  return {
    id: uid('c'),
    title,
    sessionId: newSessionId('thread'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    items: [],
    branches: [],
    checkpoints: [],
    reviewState: {},
  }
}

export function laneThread(lane, prompt, groupId) {
  return {
    id: uid('c'),
    title: `路线 ${lane} · ${prompt.slice(0, 22)}`,
    sessionId: newSessionId(`lane_${lane}`),
    lane,
    compareGroupId: groupId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    items: [{ t: 'user', text: prompt }],
    branches: [],
    checkpoints: [],
    reviewState: {},
  }
}

export function assistantSdk(text) {
  return { type: 'assistant', message: { content: [{ type: 'text', text: text || '' }] } }
}

export function synthesisSdk(text) {
  return { type: 'assistant', message: { content: [{ type: 'text', text: `**汇总推荐**\n\n${text || ''}` }] } }
}
