// 多人实时协作：WebSocket 房间 + 对话同步 + 在线成员
// 连接/广播核心(ws/room/peers)留在 vanilla 单实例：chat.js 动态 import 取 broadcastConversation，
// React 孤岛经 window.ccuiCollab 桥读状态/收发。两端共用同一 ws，避免状态分裂。
import { db } from '../db.js'
import { store } from '../store.js'
import { toast } from '../ui.js'

let ws = null
let room = ''
let selfId = `u_${Math.random().toString(36).slice(2, 8)}`
let peers = new Map()
let status = '未连接'
const logs = []
const listeners = new Set()

function snapshot() {
  return {
    status,
    room,
    selfId,
    peers: [...peers.values()],
    logs: [...logs],
  }
}

function notify() {
  const snap = snapshot()
  for (const fn of listeners) { try { fn(snap) } catch {} }
}

function log(msg) {
  logs.unshift({ t: new Date().toLocaleTimeString(), msg })
  if (logs.length > 200) logs.length = 200
  notify()
}

function setStatus(s) {
  status = s
  notify()
}

function join(roomName) {
  room = (roomName || '').trim() || 'ccui-default'
  leave()
  return window.ccui.collabPort().then(port => {
    ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', room, userId: selfId, name: `用户-${selfId.slice(-4)}` }))
      setStatus(`已连接 · 房间 ${room}`)
      log('已加入房间')
    }
    ws.onmessage = ev => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      handle(msg)
    }
    ws.onclose = () => { setStatus('已断开'); log('连接关闭') }
    ws.onerror = () => toast('协作服务连接失败', { type: 'error' })
  }).catch(e => {
    toast(`无法连接协作服务：${e.message}`, { type: 'error' })
  })
}

function leave() {
  if (ws) { try { ws.close() } catch {} ws = null }
  peers.clear()
  setStatus('未连接')
}

function handle(msg) {
  if (msg.type === 'peers') {
    peers = new Map((msg.list || []).map(p => [p.userId, p]))
    notify()
    return
  }
  if (msg.type === 'convo_push' && msg.payload) {
    log(`${msg.fromName || '同伴'} 推送了对话「${msg.payload.title || ''}」`)
    mergeRemoteConvo(msg.payload).catch(() => {})
    return
  }
  if (msg.type === 'chat' && msg.text) {
    log(`${msg.fromName}: ${msg.text.slice(0, 80)}`)
  }
}

async function mergeRemoteConvo(c) {
  if (!c?.id) return
  try {
    await db.put('conversations', c)
    const list = await db.getAll('conversations')
    store.set({ conversations: list.sort((a, b) => b.updatedAt - a.updatedAt) })
    toast(`已同步远程对话：${c.title}`, { type: 'success' })
  } catch {}
}

/** 广播当前对话给房间（chat 持久化后调用） */
export function broadcastConversation(convo) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !room) return
  ws.send(JSON.stringify({ type: 'convo_push', room, userId: selfId, payload: convo }))
}

/** 广播输入状态 */
export function broadcastTyping(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !room) return
  ws.send(JSON.stringify({ type: 'typing', room, userId: selfId, text: text.slice(0, 120) }))
}

// 协作核心桥：React 孤岛经此读状态 / join / leave。单一真相留在本模块。
window.ccuiCollab = {
  getState: snapshot,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  join,
  leave,
}

// 视图已迁移到 React 孤岛 ../../dist/islands.js。
let unmount = null
export async function mountCollab(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountCollab(c)
}
