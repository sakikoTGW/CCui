// Task Brief 持久化 — 草稿（按会话）+ 简报库
import { db } from '../db.js'
import { emptyBrief, normalizeBrief } from './schema.js'

const DRAFT_PREFIX = 'briefDraft:'
const LIBRARY_ID = 'briefLibrary'

export async function loadDraft(conversationId) {
  if (!conversationId) return emptyBrief()
  try {
    const row = await db.get('settings', `${DRAFT_PREFIX}${conversationId}`)
    return normalizeBrief(row?.value || emptyBrief(conversationId))
  } catch {
    return emptyBrief(conversationId)
  }
}

export async function saveDraft(brief, conversationId) {
  if (!conversationId) return brief
  const v = normalizeBrief({ ...brief, conversationId, updatedAt: Date.now() })
  await db.put('settings', { id: `${DRAFT_PREFIX}${conversationId}`, value: v })
  return v
}

export async function listLibrary() {
  try {
    return (await db.get('settings', LIBRARY_ID))?.value || []
  } catch {
    return []
  }
}

export async function saveToLibrary(brief, title) {
  const lib = await listLibrary()
  const item = {
    ...normalizeBrief(brief),
    title: title || briefSummaryTitle(brief),
    savedAt: Date.now(),
  }
  const idx = lib.findIndex(x => x.id === item.id)
  if (idx >= 0) lib[idx] = item
  else lib.unshift(item)
  if (lib.length > 40) lib.length = 40
  await db.put('settings', { id: LIBRARY_ID, value: lib })
  return item
}

export async function deleteFromLibrary(id) {
  const lib = (await listLibrary()).filter(x => x.id !== id)
  await db.put('settings', { id: LIBRARY_ID, value: lib })
}

function briefSummaryTitle(b) {
  const o = (b.outcome || b.problem || '未命名简报').trim()
  return o.slice(0, 40)
}
