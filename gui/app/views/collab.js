// 多人实时协作：WebSocket 房间 + 对话同步 + 在线成员
import { db } from '../db.js'
import { store } from '../store.js'
import { toast, confirmPopover } from '../ui.js'

let container = null
let ws = null
let room = ''
let selfId = `u_${Math.random().toString(36).slice(2, 8)}`
let peers = new Map()

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

export function mountCollab(c) {
  container = c
  container.innerHTML = `
    <div class="view-head"><h1>协作空间</h1></div>
    <div class="collab-body">
      <section class="set-card">
        <h2>加入房间</h2>
        <p class="set-hint">同一 WiFi / 局域网内多人可实时同步对话与编辑。主机自动启动协作服务（端口 4177）。</p>
        <div class="collab-row">
          <input id="cb-room" placeholder="房间号，如 ccui-dev" />
          <button class="btn-primary" id="cb-join">加入</button>
          <button class="btn-ghost" id="cb-leave">离开</button>
        </div>
        <div class="collab-status" id="cb-status">未连接</div>
      </section>
      <section class="set-card">
        <h2>在线成员 <span id="cb-count">0</span></h2>
        <ul class="collab-peers" id="cb-peers"></ul>
      </section>
      <section class="set-card">
        <h2>同步日志</h2>
        <div class="collab-log" id="cb-log"></div>
      </section>
    </div>`

  container.querySelector('#cb-join').onclick = join
  container.querySelector('#cb-leave').onclick = e => {
    if (!ws) { leave(); return }
    confirmPopover(e.target, '离开当前协作房间？', () => leave())
  }
}

function log(msg) {
  const el = container?.querySelector('#cb-log')
  if (!el) return
  const row = h('div', 'cb-log-row', `<span class="t">${new Date().toLocaleTimeString()}</span> ${msg}`)
  el.prepend(row)
}

async function join() {
  const input = container.querySelector('#cb-room')
  room = (input.value.trim() || 'ccui-default')
  leave()
  try {
    const port = await window.ccui.collabPort()
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
  } catch (e) {
    toast(`无法连接协作服务：${e.message}`, { type: 'error' })
  }
}

function leave() {
  if (ws) { try { ws.close() } catch {} ws = null }
  peers.clear()
  renderPeers()
  setStatus('未连接')
}

function setStatus(s) {
  const el = container.querySelector('#cb-status')
  if (el) el.textContent = s
}

function handle(msg) {
  if (msg.type === 'peers') {
    peers = new Map((msg.list || []).map(p => [p.userId, p]))
    renderPeers()
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

function renderPeers() {
  const ul = container.querySelector('#cb-peers')
  const cnt = container.querySelector('#cb-count')
  if (cnt) cnt.textContent = String(peers.size)
  if (!ul) return
  ul.innerHTML = ''
  for (const p of peers.values()) {
    const li = h('li', null, `${p.name}${p.userId === selfId ? ' (你)' : ''}`)
    ul.appendChild(li)
  }
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
