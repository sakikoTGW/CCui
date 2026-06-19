// 控制台视图已迁移到 React 孤岛 ../../dist/islands.js。
// 此文件保留薄 shim：动态挂载 React ConsoleView + 启动期下发禁用列表(vanilla)。
import { api } from '../api.js'
import { db } from '../db.js'

/** 启动时把已保存的禁用列表下发 daemon(被 renderer 导入；当前未调用，保留以防回归) */
export async function syncDisabledToDaemon() {
  let set, map
  try { set = new Set((await db.get('settings', 'disabledResources'))?.value || []) } catch { set = new Set() }
  try { map = (await db.get('settings', 'resourceMap'))?.value || {} } catch { map = {} }
  if (!set.size && !Object.keys(map).length) return
  try {
    await api.request({ cmd: 'setDisabledResources', ids: [...set], map }, 15000)
  } catch {}
}

let unmount = null
export async function mountConsole(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountConsole(c)
}
