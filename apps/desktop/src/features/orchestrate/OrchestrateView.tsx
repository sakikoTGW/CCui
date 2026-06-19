/**
 * Compare 跳转面板。真正的并行编排逻辑（runCompare/stopParallel）仍在 vanilla
 * parallel.js，由 chat.js 调用——此视图只是把用户引导到 chat 并触发 + Compare。
 */
import { bus } from '../../shell/bus'

export function OrchestrateView() {
  const start = () => {
    bus.emit('switch-view', 'chat')
    bus.emit('start-compare')
  }
  return (
    <div className="redirect-pane">
      <h1>Compare = 三条 Thread</h1>
      <p>
        不是另一种页面类型。点 Sidebar「+ Compare」，输入任务后会创建 Lane A/B/C
        三条独立 Thread，各自有 transcript 和 sessionId。
      </p>
      <button className="btn-primary" onClick={start}>开始 Compare</button>
    </div>
  )
}
