// Compare 编排 — 纯 API，无 UI。引擎内每 lane 已是独立 AgentSession。
import { api } from './api.js'
import { store } from './store.js'
import { bus } from './bus.js'

const DEFAULT_LANES = [
  { id: 'A', label: '路线 A' },
  { id: 'B', label: '路线 B' },
  { id: 'C', label: '路线 C' },
]

export function setParallelRunning(v) {
  store.set({ orchBusy: v })
}

export function isParallelRunning() {
  return store.get().orchBusy
}

export function stopParallel() {
  api.request({ cmd: 'interruptOrchestrate' }).catch(() => {})
  setParallelRunning(false)
}

/** 同一 prompt 跑 A/B/C；sessionByLane 把每条 lane 绑到 Sidebar Thread 的 sessionId */
export async function runCompare(prompt, laneConfigs = {}, sessionByLane = {}) {
  setParallelRunning(true)
  try {
    const lanes = DEFAULT_LANES.map(spec => ({
      ...spec,
      sessionId: sessionByLane[spec.id] || undefined,
      model: laneConfigs[spec.id]?.model || undefined,
      systemPrompt: laneConfigs[spec.id]?.systemPrompt || undefined,
    }))
    const resp = await api.request({
      cmd: 'orchestrate',
      prompt,
      lanes,
      crossReview: true,
      synthesize: true,
    }, 600000)
    if (!resp.ok) throw new Error(resp.error || 'orchestrate failed')
    return resp
  } finally {
    setParallelRunning(false)
  }
}

export function mountOrchestrate(container) {
  container.innerHTML = `
    <div class="redirect-pane">
      <h1>对比 = 三条独立会话</h1>
      <p>不是另一种页面类型。点侧栏「+ 对比」，输入任务后会创建路线 A/B/C 三条独立会话，各自有对话记录和 sessionId。</p>
      <button class="btn-primary" id="go-par">开始对比</button>
    </div>`
  container.querySelector('#go-par').onclick = () => {
    bus.emit('switch-view', 'chat')
    bus.emit('start-compare')
  }
}
