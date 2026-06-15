// 全视图巡检：依次切换所有视图，捕获 JS 异常并截图
import WebSocket from '../gui/node_modules/ws/index.js'
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9223'
const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
const targets = await res.json()
const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.error('NO PAGE TARGET'); process.exit(1) }

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
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push('[error] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '))
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text))
  }
})
await new Promise(r => ws.on('open', r))
await send('Runtime.enable')
await send('Page.enable')
await send('Page.bringToFront').catch(() => {})

const VIEWS = ['presets', 'templates', 'theme', 'studio', 'console', 'orchestrate', 'collab', 'settings', 'chat']
for (const v of VIEWS) {
  const before = logs.length
  await send('Runtime.evaluate', { expression: `document.querySelector('.act[data-view="${v}"]')?.click()` })
  await new Promise(r => setTimeout(r, 1800))
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(`e:/CCui/scripts/tour-${v}.png`, Buffer.from(shot.data, 'base64'))
  const errs = logs.slice(before)
  console.log(`VIEW ${v}: ${errs.length ? 'ERRORS ' + errs.join(' | ') : 'clean'}`)
}
// 文件抽屉
await send('Runtime.evaluate', { expression: `document.getElementById('treeToggle')?.click()` })
await new Promise(r => setTimeout(r, 2500))
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync('e:/CCui/scripts/tour-filetree.png', Buffer.from(shot.data, 'base64'))
console.log('VIEW filetree: done')
console.log('TOTAL ERRORS:', logs.length ? '\n' + logs.join('\n') : 'none')
ws.close(); process.exit(0)
