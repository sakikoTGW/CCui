/**
 * @ccui/plugin-sdk/guest — 访客(iframe)侧 SDK，纯 JS ESM、零依赖，可在沙箱
 * iframe 中以 <script type="module"> 直接 import。封装与宿主的 postMessage RPC。
 *
 * 用法（插件 index.html 内）：
 *   import { createCcuiPlugin } from '<path>/guest.js'
 *   const ccui = createCcuiPlugin('my-plugin')
 *   await ccui.ready
 *   await ccui.toast('hello from plugin')
 */

/**
 * @param {string} pluginId
 * @returns {{
 *   ready: Promise<{permissions: string[]}>,
 *   toast: (message: string, type?: string) => Promise<void>,
 *   emit: (event: string, payload?: unknown) => Promise<void>,
 *   getState: () => Promise<Record<string, unknown>>,
 *   daemon: (cmd: Record<string, unknown>) => Promise<unknown>,
 *   on: (event: string, fn: (payload: unknown) => void) => () => void,
 * }}
 */
export function createCcuiPlugin(pluginId) {
  let nextId = 1
  const pending = new Map()
  const listeners = new Map()
  let readyResolve
  const ready = new Promise(res => {
    readyResolve = res
  })

  function post(msg) {
    window.parent.postMessage(msg, '*')
  }

  window.addEventListener('message', e => {
    const m = e.data
    if (!m || typeof m.t !== 'string') return
    if (m.t === 'ccui:ready') {
      readyResolve({ permissions: m.permissions || [] })
      return
    }
    if (m.t === 'ccui:rpc:res') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error || 'rpc failed'))
      return
    }
    if (m.t === 'ccui:event') {
      const set = listeners.get(m.event)
      if (set) for (const fn of set) {
        try {
          fn(m.payload)
        } catch {
          /* ignore listener error */
        }
      }
    }
  })

  function rpc(method, args) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      post({ t: 'ccui:rpc', id, method, args })
    })
  }

  post({ t: 'ccui:hello', pluginId })

  return {
    ready,
    toast: (message, type) => rpc('toast', { message, type }),
    emit: (event, payload) => rpc('bus.emit', { event, payload }),
    getState: () => rpc('store.get', {}),
    daemon: cmd => rpc('daemon.request', { cmd }),
    on(event, fn) {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
        post({ t: 'ccui:sub', event })
      }
      set.add(fn)
      return () => set.delete(fn)
    },
  }
}
