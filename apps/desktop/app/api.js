// daemon API 层封装 — 在 IPC 之上做：事件分发、超时、错误映射
// window.ccui 由 preload 暴露：send/respondPermission/interrupt/setRouter/onDaemon/onLog
const handlers = new Set()
let started = false
let lastActivity = Date.now()
let watchdog = null

const pendingReqs = new Map()
let reqSeq = 0

function ensureStarted() {
  if (started) return
  started = true
  window.ccui.onDaemon(msg => {
    lastActivity = Date.now()
    if (msg && msg.kind === 'resp' && msg.reqId && pendingReqs.has(msg.reqId)) {
      const { resolve, timer } = pendingReqs.get(msg.reqId)
      clearTimeout(timer)
      pendingReqs.delete(msg.reqId)
      resolve(msg)
      return
    }
    for (const h of handlers) {
      try { h(msg) } catch (e) { console.error('handler error', e) }
    }
  })
}

export const api = {
  onMessage(fn) {
    ensureStarted()
    handlers.add(fn)
    return () => handlers.delete(fn)
  },
  send(payload) {
    lastActivity = Date.now()
    window.ccui.send(payload.text, {
      taskType: payload.taskType,
      model: payload.model,
      systemPrompt: payload.systemPrompt,
      sessionId: payload.sessionId ?? 'main',
    })
  },
  respondPermission(id, allow, updatedInput) {
    window.ccui.respondPermission(id, allow, updatedInput)
  },
  interrupt(sessionId) {
    window.ccui.interrupt(sessionId)
  },
  reset(sessionId) {
    window.ccui.reset(sessionId)
  },
  hydrateSession(sessionId, payload) {
    window.ccui.hydrateSession(sessionId, payload)
  },
  getMessages(sessionId) {
    return this.request({ cmd: 'getMessages', sessionId }, 8000)
  },
  setEnv(patch) {
    window.ccui.setEnv(patch)
  },
  // 请求/响应：发带 reqId 的命令，等匹配的 resp
  request(cmd, timeoutMs = 15000) {
    ensureStarted()
    const reqId = `r${++reqSeq}_${Date.now().toString(36)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pendingReqs.delete(reqId); reject(new Error('daemon 请求超时')) }, timeoutMs)
      pendingReqs.set(reqId, { resolve, timer })
      window.ccui.request({ ...cmd, reqId })
    })
  },
  setRouter(patch) {
    window.ccui.setRouter(patch)
  },
  // 看门狗：一轮发起后若长时间无任何 daemon 活动，回调超时
  startWatchdog(onTimeout, ms = 120000) {
    this.stopWatchdog()
    lastActivity = Date.now()
    watchdog = setInterval(() => {
      if (Date.now() - lastActivity > ms) {
        this.stopWatchdog()
        onTimeout()
      }
    }, 5000)
  },
  stopWatchdog() {
    if (watchdog) { clearInterval(watchdog); watchdog = null }
  },
}

// 错误码 → 人话
export function humanizeError(raw) {
  const s = String(raw || '')
  if (/401|unauthor|api[_ ]?key/i.test(s)) return 'API Key 无效或缺失，请到设置检查。'
  if (/429|rate.?limit/i.test(s)) return '请求过于频繁（限流），稍后再试。'
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(s)) return '网络超时，请检查网络或稍后重试。'
  if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(s)) return '无法连接 API 服务地址，请检查网络与 BASE_URL。'
  if (/insufficient|balance|quota/i.test(s)) return '账户额度不足。'
  return s || '发生未知错误。'
}
