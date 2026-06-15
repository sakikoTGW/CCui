// 工具权限 — 「始终允许」列表（与对话内授权卡片、daemon setAllowedTools 同步）
import { db } from './db.js'
import { api } from './api.js'

/** 常用工具名（与引擎 Tool.name 一致） */
export const PERM_TOOL_GROUPS = [
  { id: 'file', label: '读写文件', tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'] },
  { id: 'run', label: '执行 / 网络', tools: ['Bash', 'WebFetch', 'WebSearch'] },
  { id: 'agent', label: 'Agent / 任务', tools: ['Agent', 'Skill', 'TodoWrite'] },
]

export const PERM_EXPLAIN = `每次工具调用默认会弹窗询问。勾选的项加入「始终允许」后不再打断；未勾选的仍会每次确认。Skills / MCP / Rules 的开关在「控制台」。`

export async function getAllowedTools() {
  try { return (await db.get('settings', 'allowedTools'))?.value || [] } catch { return [] }
}

export async function saveAllowedTools(list) {
  const uniq = [...new Set(list.filter(Boolean))]
  await db.put('settings', { id: 'allowedTools', value: uniq })
  await api.request({ cmd: 'setAllowedTools', tools: uniq }, 8000)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ccui:perms-updated', { detail: uniq }))
  }
  return uniq
}

export async function toggleAllowedTool(name, on) {
  const cur = new Set(await getAllowedTools())
  if (on) cur.add(name); else cur.delete(name)
  return saveAllowedTools([...cur])
}

export function permSummary(list) {
  if (!list?.length) return '每次工具调用需确认'
  const head = list.slice(0, 3).join(', ')
  const tail = list.length > 3 ? ` 等 ${list.length} 项` : ''
  return `始终允许：${head}${tail}`
}
