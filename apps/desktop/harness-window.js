// Harness 独立窗口入口：挂载 React HarnessView 孤岛。
// daemon 通道经 preload(window.ccui) + 主进程把 daemon 消息广播到本窗口。
import { mountHarness } from './dist/islands.js'

// 最小 toast —— 独立窗口没有主壳的 toast 单例，提供一个轻量实现给孤岛复用
window.ccuiToast = (msg, opts = {}) => {
  const n = document.createElement('div')
  n.textContent = msg
  const bg = opts.type === 'error' ? '#c0392b' : opts.type === 'warn' ? '#b7791f' : opts.type === 'info' ? '#2b6cb0' : '#2d7d46'
  n.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:80vw;padding:8px 14px;border-radius:8px;font-size:13px;color:#fff;background:${bg};box-shadow:0 6px 20px rgba(0,0,0,.22)`
  document.body.appendChild(n)
  setTimeout(() => { n.style.opacity = '0'; n.style.transition = 'opacity .3s' }, 2300)
  setTimeout(() => n.remove(), 2700)
}

const root = document.getElementById('harnessRoot')
if (root) mountHarness(root)
