// 主页独立窗口：挂载 LauncherApp。
// 这是 CCui 启动后第一个窗口；「进入工作区」经 IPC 打开/聚焦主工作区窗口。
import { mountLauncher } from './dist/islands.js'

window.ccuiToast = (msg, opts = {}) => {
  const n = document.createElement('div')
  n.textContent = msg
  const bg = opts.type === 'error' ? '#c0392b' : opts.type === 'warn' ? '#b7791f' : opts.type === 'info' ? '#2b6cb0' : '#2d7d46'
  n.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:80vw;padding:8px 14px;border-radius:8px;font-size:13px;color:#fff;background:${bg};box-shadow:0 6px 20px rgba(0,0,0,.22)`
  document.body.appendChild(n)
  setTimeout(() => { n.style.opacity = '0'; n.style.transition = 'opacity .3s' }, 2300)
  setTimeout(() => n.remove(), 2700)
}

const root = document.getElementById('launcherRoot')
if (root) mountLauncher(root)
