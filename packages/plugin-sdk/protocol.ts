/**
 * 宿主 ↔ 访客(iframe) postMessage 协议 + 安全白名单。
 *
 * iframe 用 sandbox="allow-scripts"（无 allow-same-origin → 不可碰 parent DOM，
 * 唯一通道是 postMessage）。所有 RPC 经此协议，宿主据 manifest.permissions +
 * 下方白名单门控。
 */

/** 仅允许插件触发的安全 bus 事件（不开放任意事件，防越权驱动宿主）。 */
export const SAFE_BUS_EMIT = ['switch-view', 'insert-prompt', 'openfile'] as const
export type SafeBusEmit = (typeof SAFE_BUS_EMIT)[number]

/** 仅允许插件订阅的 bus 事件。 */
export const SAFE_BUS_ON = [
  'switch-view',
  'project-changed',
  'theme-changed',
  'personalize-changed',
] as const
export type SafeBusOn = (typeof SAFE_BUS_ON)[number]

/** 仅允许插件调用的 daemon 只读命令。 */
export const SAFE_DAEMON_CMDS = [
  'listResources',
  'listDir',
  'readFile',
  'projectGraph',
  'getProjectInfo',
] as const
export type SafeDaemonCmd = (typeof SAFE_DAEMON_CMDS)[number]

// ---------- 访客 → 宿主 ----------
export interface GuestHello {
  t: 'ccui:hello'
  pluginId: string
}
export interface GuestRpc {
  t: 'ccui:rpc'
  id: number
  method: 'toast' | 'bus.emit' | 'store.get' | 'daemon.request'
  args: unknown
}
export interface GuestSub {
  t: 'ccui:sub'
  event: string
}
export type GuestMessage = GuestHello | GuestRpc | GuestSub

// ---------- 宿主 → 访客 ----------
export interface HostReady {
  t: 'ccui:ready'
  pluginId: string
  permissions: string[]
}
export interface HostRpcRes {
  t: 'ccui:rpc:res'
  id: number
  ok: boolean
  result?: unknown
  error?: string
}
export interface HostEvent {
  t: 'ccui:event'
  event: string
  payload: unknown
}
export type HostMessage = HostReady | HostRpcRes | HostEvent

export function isGuestMessage(v: unknown): v is GuestMessage {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { t?: unknown }).t === 'string' &&
    (v as { t: string }).t.startsWith('ccui:')
  )
}
