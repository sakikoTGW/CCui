// 预设管理视图已迁移到 React 孤岛 ../../dist/islands.js。
// 此文件仅保留全局热键(Ctrl+1..9 切换预设)与其依赖的 applyPreset。
import { store } from '../store.js'
import { db } from '../db.js'
import { toast } from '../ui.js'

let unmount = null
export async function mountPresets(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountPresets(c)
}

async function applyPreset(p) {
  store.set({ activePresetId: p.id })
  try { await db.put('settings', { id: 'activePreset', value: p.id }) } catch {}
  toast(`已激活预设「${p.name}」`, { type: 'success' })
}

// 全局快捷键 Ctrl+1..9 切换预设(读 store.presets，由 boot 与孤岛 loadPresets 维护)
export function initPresetHotkeys() {
  document.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.shiftKey || e.altKey) return
    const n = parseInt(e.key, 10)
    if (n >= 1 && n <= 9) {
      const list = store.get().presets
      const p = list[n - 1]
      if (p) { e.preventDefault(); applyPreset(p) }
    }
  })
}
