// 按需引导：行为触发后轻提示，每条只显示一次
import { db } from './db.js'
import { toast } from './ui.js'

async function seenSet() {
  try { return new Set((await db.get('settings', 'tipsSeen'))?.value || []) } catch { return new Set() }
}

async function markSeen(key) {
  const s = await seenSet()
  s.add(key)
  try { await db.put('settings', { id: 'tipsSeen', value: [...s] }) } catch {}
}

/** @param {string} key @param {string} message @param {{ action?: { label: string, onClick: () => void } }} [opts] */
export async function maybeTip(key, message, opts = {}) {
  const s = await seenSet()
  if (s.has(key)) return false
  await markSeen(key)
  toast(message, { type: 'info', timeout: 6000, action: opts.action })
  return true
}

export async function resetTips() {
  try { await db.put('settings', { id: 'tipsSeen', value: [] }) } catch {}
}
