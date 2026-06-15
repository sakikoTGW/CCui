// CDP 截图自检：连 Electron 远程调试口，截全窗口 + 抓控制台错误
import WebSocket from '../gui/node_modules/ws/index.js'
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9223'
const OUT = process.argv[3] || 'e:/CCui/scripts/gui-snap.png'

const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
const targets = await res.json()
const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.error('NO PAGE TARGET'); process.exit(1) }
console.log('TARGET:', page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
let seq = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const logs = []
ws.on('message', d => {
  const m = JSON.parse(d)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' '))
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text))
  }
})

await new Promise(r => ws.on('open', r))
await send('Runtime.enable')
await send('Page.enable')
await new Promise(r => setTimeout(r, 1500))

// 收集页面里的既有错误（重载一次以捕获 boot 期错误）
await send('Page.reload')
await new Promise(r => setTimeout(r, 5000))
await send('Page.bringToFront').catch(() => {})
await new Promise(r => setTimeout(r, 800))

const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log('SNAP SAVED:', OUT)

// 额外检查：导航元素与图标是否挂载
const check = await send('Runtime.evaluate', { returnByValue: true, expression: `
  JSON.stringify({
    actBtns: document.querySelectorAll('.act').length,
    actSvgs: document.querySelectorAll('.act svg').length,
    sendSvg: !!document.querySelector('.send svg'),
    composerInner: !!document.querySelector('.composer-inner'),
    bg: getComputedStyle(document.body).backgroundColor,
    font: getComputedStyle(document.body).fontFamily.slice(0, 60),
  })` })
console.log('DOM CHECK:', check.result.value)
console.log('CONSOLE ERRORS:', logs.length ? '\n' + logs.join('\n') : 'none')
ws.close()
process.exit(0)
