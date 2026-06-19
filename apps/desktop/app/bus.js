// 渲染层事件总线（vanilla 侧）。与 React 孤岛侧的 src/shell/bus.ts 是同一条
// window CustomEvent 传输（频道名 `ccui:<type>`）的两个薄封装，因此两个世界完全
// 互通：孤岛 bus.emit('switch-view','chat') 会被这里 bus.on('switch-view') 收到，
// 反之亦然。集中收口所有跨切面信号，取代散落各处的 new CustomEvent('ccui:...')，
// 也是后续插件层拦截信号的唯一入口。
const PREFIX = 'ccui:'

export const bus = {
  /** 订阅；返回取消订阅函数 */
  on(type, handler) {
    const wrapped = e => {
      try { handler(e.detail) } catch (err) { console.error(`bus handler "${type}" threw`, err) }
    }
    window.addEventListener(PREFIX + type, wrapped)
    return () => window.removeEventListener(PREFIX + type, wrapped)
  },
  /** 触发；detail 可选 */
  emit(type, detail) {
    window.dispatchEvent(new CustomEvent(PREFIX + type, { detail }))
  },
}
