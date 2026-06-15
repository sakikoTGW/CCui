// 变更审查队列 — 权限请求 + 文件 diff，供独立审查窗口批处理
import { api } from './api.js'
import { toast } from './ui.js'
import { toggleAllowedTool } from './permissions.js'

/** @typedef {'permission'|'diff'} ReviewKind */
/** @typedef {{ id: string; kind: ReviewKind; permId?: string; toolName: string; message?: string; path?: string; oldStr?: string; newStr?: string; input?: unknown; selected: boolean; at: number }} ReviewItem */

const items = new Map()
let seq = 0
let wired = false

function sync() {
  const list = getAll()
  window.ccui?.pushReviewQueue?.(list)
  window.dispatchEvent(new CustomEvent('ccui:review-queue', { detail: list }))
  return list
}

/** @param {Omit<ReviewItem, 'id'|'selected'|'at'> & { id?: string }} raw @param {{ notify?: boolean }} opts */
export function enqueue(raw, { notify = true } = {}) {
  const id = raw.id || `rq_${++seq}_${Date.now().toString(36)}`
  if (items.has(id)) return id
  items.set(id, {
    ...raw,
    id,
    selected: true,
    at: Date.now(),
  })
  sync()
  if (notify) window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'review' }))
  return id
}

export function remove(id) {
  if (!items.delete(id)) return
  sync()
}

export function getAll() {
  return [...items.values()].sort((a, b) => a.at - b.at)
}

export function pendingCount() {
  return items.size
}

export function clear() {
  items.clear()
  sync()
}

/** @param {string} permId */
export function removeByPermId(permId) {
  for (const [id, it] of items) {
    if (it.kind === 'permission' && it.permId === permId) {
      items.delete(id)
      break
    }
  }
  sync()
}

async function respondOne(item, allow, { alwaysAllow = false } = {}) {
  if (item.kind === 'permission') {
    if (allow && alwaysAllow) {
      try {
        await toggleAllowedTool(item.toolName, true)
        toast(`已记住：${item.toolName} 将自动允许`, { type: 'success' })
      } catch (e) {
        toast(`保存失败：${e.message}`, { type: 'error' })
      }
    }
    if (item.permId) api.respondPermission(item.permId, allow)
    window.dispatchEvent(new CustomEvent('ccui:review-perm', {
      detail: { item, permId: item.permId, allow },
    }))
    return
  }
  if (item.kind === 'diff') {
    window.dispatchEvent(new CustomEvent('ccui:review-diff', { detail: { item, allow } }))
  }
}

/** @param {string[]} ids @param {boolean} allow */
export async function respondBatch(ids, allow, opts = {}) {
  const list = ids.map(id => items.get(id)).filter(Boolean)
  for (const it of list) {
    await respondOne(it, allow, opts)
    items.delete(it.id)
  }
  sync()
  if (list.length) {
    toast(allow ? `已允许 ${list.length} 项` : `已拒绝 ${list.length} 项`, { type: allow ? 'success' : 'info' })
  }
}

export function initReviewQueueBridge() {
  if (wired || !window.ccui?.onReviewAction) return
  wired = true
  window.ccui.onReviewAction(async payload => {
    const { action, ids, allow, alwaysAllow } = payload || {}
    if (!ids?.length) return
    if (action === 'batch') await respondBatch(ids, !!allow, { alwaysAllow: !!alwaysAllow })
    else if (action === 'single') await respondBatch([ids[0]], !!allow, { alwaysAllow: !!alwaysAllow })
    else if (action === 'clear-resolved') {
      for (const id of ids) items.delete(id)
      sync()
    }
  })
}
