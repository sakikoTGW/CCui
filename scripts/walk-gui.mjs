// 全视图遍历自检：依次切换所有视图，捕获异常 + 每视图截屏
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

const views = ['presets', 'templates', 'theme', 'studio', 'console', 'orchestrate', 'collab', 'settings', 'chat']
for (const v of views) {
  const before = logs.length
  await send('Runtime.evaluate', { expression: `
    (() => {
      const btn = document.querySelector('.act[data-view="${v}"]')
      if (btn) { btn.click(); return 'nav' }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
      return 'palette'
    })()` })
  if (v !== 'chat' && v !== 'console' && v !== 'studio' && v !== 'settings') {
    await send('Runtime.evaluate', { expression: `
      (() => {
        const input = document.querySelector('.cmd-input')
        if (!input) return
        const map = { presets:'参数预设', templates:'提示词模板', theme:'主题编辑器', orchestrate:'Compare lanes', collab:'协作' }
        input.value = map['${v}'] || '${v}'
        input.dispatchEvent(new Event('input'))
        setTimeout(() => document.querySelector('.cmd-item')?.click(), 200)
      })()` })
    await new Promise(r => setTimeout(r, 600))
  }
  await new Promise(r => setTimeout(r, 1400))
  const err = await send('Runtime.evaluate', { returnByValue: true, expression: `
    (() => { const e = document.querySelector('.view-${v} .error-state'); return e ? e.textContent.slice(0,200) : '' })()` })
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(`e:/CCui/scripts/walk-${v}.png`, Buffer.from(shot.data, 'base64'))
  const newLogs = logs.slice(before)
  console.log(`VIEW ${v}: ${err.result.value ? 'ERROR-STATE: ' + err.result.value : 'ok'}${newLogs.length ? ' | console: ' + newLogs.join(' || ') : ''}`)
}
// 文件面板抽屉
await send('Runtime.evaluate', { expression: `document.getElementById('treeToggle').click()` })
await new Promise(r => setTimeout(r, 2000))
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync('e:/CCui/scripts/walk-filetree.png', Buffer.from(shot.data, 'base64'))
console.log('VIEW filetree: snapped')
console.log('TOTAL CONSOLE ISSUES:', logs.length ? '\n' + logs.join('\n') : 'none')
ws.close(); process.exit(0)
