// Compare 编排 — 纯 API，无 UI。引擎内每 lane 已是独立 AgentSession。
import { api } from './api.js'
import { store } from './store.js'
import { bus } from './bus.js'

const DEFAULT_LANES = [
  { id: 'A', label: 'Lane A' },
  { id: 'B', label: 'Lane B' },
  { id: 'C', label: 'Lane C' },
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
      <h1>Compare = 三条 Thread</h1>
      <p>不是另一种页面类型。点 Sidebar「+ Compare」，输入任务后会创建 Lane A/B/C 三条独立 Thread，各自有 transcript 和 sessionId。</p>
      <button class="btn-primary" id="go-par">开始 Compare</button>
    </div>`
  container.querySelector('#go-par').onclick = () => {
    bus.emit('switch-view', 'chat')
    bus.emit('start-compare')
  }
}
