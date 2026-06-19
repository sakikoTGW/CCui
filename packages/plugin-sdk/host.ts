/**
 * 宿主侧插件桥 —— 把访客 iframe 的 postMessage RPC 翻译成对宿主能力
 * (toast / bus / store / daemon) 的调用，并按 manifest.permissions + 协议
 * 白名单门控。依赖全部注入 → 纯逻辑可单测（不绑 DOM/Electron）。
 */
import { parseManifest, type PluginManifest, type PluginPermission } from './manifest'
import {
  SAFE_BUS_EMIT,
  SAFE_BUS_ON,
  SAFE_DAEMON_CMDS,
  isGuestMessage,
  type HostMessage,
} from './protocol'

export interface PluginRecord {
  manifest: PluginManifest
  /** 插件目录（绝对或相对宿主可解析路径） */
  dir: string
}

export interface DiscoverEntry {
  dir: string
  /** ccui.plugin.json 文本 */
  text: string
}

export interface DiscoverResult {
  records: PluginRecord[]
  errors: Array<{ dir: string; error: string }>
}

/** 校验一批已读取的清单文本，分流为有效记录 / 错误。id 去重（先到先得）。 */
export function collectPlugins(entries: DiscoverEntry[]): DiscoverResult {
  const records: PluginRecord[] = []
  const errors: Array<{ dir: string; error: string }> = []
  const seen = new Set<string>()
  for (const e of entries) {
    const r = parseManifest(e.text)
    if (!r.ok) {
      errors.push({ dir: e.dir, error: r.error })
      continue
    }
    if (seen.has(r.manifest.id)) {
      errors.push({ dir: e.dir, error: `id 重复：${r.manifest.id}` })
      continue
    }
    seen.add(r.manifest.id)
    records.push({ manifest: r.manifest, dir: e.dir })
  }
  return { records, errors }
}

/**
 * 注入到 iframe srcdoc 的引导脚本源（classic script）：定义 createCcuiPlugin 并
 * 挂 window.ccui，让单文件插件无需 import 直接用 `ccui.toast(...)`。与 guest.js
 * 同一协议；guest.js 面向打包型插件（ESM import），本字符串面向 srcdoc 注入型。
 */
const GUEST_SRC = String.raw`
function createCcuiPlugin(pluginId){
  var nextId=1, pending=new Map(), listeners=new Map(), readyResolve;
  var ready=new Promise(function(res){readyResolve=res});
  function post(m){window.parent.postMessage(m,'*')}
  window.addEventListener('message',function(e){
    var m=e.data; if(!m||typeof m.t!=='string')return;
    if(m.t==='ccui:ready'){readyResolve({permissions:m.permissions||[]});return}
    if(m.t==='ccui:rpc:res'){var p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(new Error(m.error||'rpc failed'));return}
    if(m.t==='ccui:event'){var s=listeners.get(m.event);if(s)s.forEach(function(fn){try{fn(m.payload)}catch(_){}})}
  });
  function rpc(method,args){var id=nextId++;return new Promise(function(resolve,reject){pending.set(id,{resolve:resolve,reject:reject});post({t:'ccui:rpc',id:id,method:method,args:args})})}
  post({t:'ccui:hello',pluginId:pluginId});
  return {
    ready:ready,
    toast:function(message,type){return rpc('toast',{message:message,type:type})},
    emit:function(event,payload){return rpc('bus.emit',{event:event,payload:payload})},
    getState:function(){return rpc('store.get',{})},
    daemon:function(cmd){return rpc('daemon.request',{cmd:cmd})},
    on:function(event,fn){var s=listeners.get(event);if(!s){s=new Set();listeners.set(event,s);post({t:'ccui:sub',event:event})}s.add(fn);return function(){s.delete(fn)}}
  };
}
`

/** 生成注入访客的 <script>，自动把 window.ccui 准备好。 */
export function guestBootstrap(pluginId: string): string {
  return `<script>${GUEST_SRC}\nwindow.ccui=createCcuiPlugin(${JSON.stringify(pluginId)});</script>`
}

/** 把引导脚本注入插件 HTML（优先插到 </head> 前，否则前置）。 */
export function buildPluginSrcdoc(pluginId: string, html: string): string {
  const boot = guestBootstrap(pluginId)
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, m => `${m}\n${boot}`)
  }
  return `${boot}\n${html}`
}

export interface HostBridgeDeps {
  manifest: PluginManifest
  /** 向访客 iframe 发消息 */
  post: (msg: HostMessage) => void
  toast?: (message: string, type?: string) => void
  emit?: (event: string, payload: unknown) => void
  on?: (event: string, handler: (payload: unknown) => void) => () => void
  getState?: () => Record<string, unknown>
  daemonRequest?: (cmd: Record<string, unknown>) => Promise<unknown>
}

export interface HostBridge {
  /** 处理来自访客的一条原始消息（event.data） */
  handleMessage(raw: unknown): void
  dispose(): void
}

export function createPluginBridge(deps: HostBridgeDeps): HostBridge {
  const perms = new Set<PluginPermission>(deps.manifest.permissions)
  const unsubs: Array<() => void> = []
  const subscribed = new Set<string>()
  let disposed = false

  const has = (p: PluginPermission) => perms.has(p)

  function respond(id: number, ok: boolean, result?: unknown, error?: string): void {
    deps.post({ t: 'ccui:rpc:res', id, ok, result, error })
  }

  async function handleRpc(
    id: number,
    method: string,
    args: unknown,
  ): Promise<void> {
    try {
      const a = (args ?? {}) as Record<string, unknown>
      switch (method) {
        case 'toast': {
          if (!has('toast') || !deps.toast) return respond(id, false, undefined, 'permission denied: toast')
          deps.toast(String(a.message ?? ''), typeof a.type === 'string' ? a.type : undefined)
          return respond(id, true)
        }
        case 'bus.emit': {
          const event = String(a.event ?? '')
          if (!has('bus:emit') || !deps.emit) return respond(id, false, undefined, 'permission denied: bus:emit')
          if (!(SAFE_BUS_EMIT as readonly string[]).includes(event))
            return respond(id, false, undefined, `event not allowed: ${event}`)
          deps.emit(event, a.payload)
          return respond(id, true)
        }
        case 'store.get': {
          if (!has('store:read') || !deps.getState) return respond(id, false, undefined, 'permission denied: store:read')
          return respond(id, true, deps.getState())
        }
        case 'daemon.request': {
          const cmd = (a.cmd ?? {}) as Record<string, unknown>
          const name = String(cmd.cmd ?? '')
          if (!has('daemon:request') || !deps.daemonRequest)
            return respond(id, false, undefined, 'permission denied: daemon:request')
          if (!(SAFE_DAEMON_CMDS as readonly string[]).includes(name))
            return respond(id, false, undefined, `daemon cmd not allowed: ${name}`)
          const result = await deps.daemonRequest(cmd)
          return respond(id, true, result)
        }
        default:
          return respond(id, false, undefined, `unknown method: ${method}`)
      }
    } catch (e) {
      respond(id, false, undefined, (e as Error).message)
    }
  }

  function handleSub(event: string): void {
    if (disposed) return
    if (!has('bus:on') || !deps.on) return
    if (!(SAFE_BUS_ON as readonly string[]).includes(event)) return
    if (subscribed.has(event)) return
    subscribed.add(event)
    const off = deps.on(event, payload => {
      deps.post({ t: 'ccui:event', event, payload })
    })
    unsubs.push(off)
  }

  return {
    handleMessage(raw: unknown): void {
      if (disposed || !isGuestMessage(raw)) return
      switch (raw.t) {
        case 'ccui:hello':
          deps.post({
            t: 'ccui:ready',
            pluginId: deps.manifest.id,
            permissions: deps.manifest.permissions,
          })
          return
        case 'ccui:rpc':
          void handleRpc(raw.id, raw.method, raw.args)
          return
        case 'ccui:sub':
          handleSub(raw.event)
          return
      }
    },
    dispose(): void {
      disposed = true
      for (const off of unsubs) {
        try {
          off()
        } catch {
          /* ignore */
        }
      }
      unsubs.length = 0
      subscribed.clear()
    },
  }
}
