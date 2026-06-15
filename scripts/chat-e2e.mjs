// 端到端对话验证：注入消息 → 点发送 → 等 AI 回复 → 截图
import WebSocket from '../gui/node_modules/ws/index.js'
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9223'
const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
const page = (await res.json()).find(t => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
let seq = 0; const pending = new Map(); const logs = []
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
ws.on('message', d => {
  const m = JSON.parse(d)
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) }
  else if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)
})
await new Promise(r => ws.on('open', r))
await send('Runtime.enable'); await send('Page.enable')
await send('Page.bringToFront').catch(() => {})

await send('Runtime.evaluate', { expression: `
  document.querySelector('.act[data-view="chat"]').click();
  setTimeout(() => {
    const input = document.getElementById('input');
    input.value = '只回复两个字：收到';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('send').click();
  }, 500);
` })

let reply = ''
for (let i = 0; i < 45; i++) {
  await new Promise(r => setTimeout(r, 2000))
  const r2 = await send('Runtime.evaluate', { returnByValue: true, expression: `
    (() => {
      const msgs = document.querySelectorAll('.msg.assistant .bubble')
      const err = document.querySelector('.errorcard .ec-msg')
      const busy = document.querySelector('.send.stop')
      return JSON.stringify({ reply: msgs.length ? msgs[msgs.length-1].textContent.slice(0,200) : '', err: err ? err.textContent.slice(0,200) : '', busy: !!busy })
    })()` })
  const st = JSON.parse(r2.result.value)
  if (st.err) { console.log('ERROR CARD:', st.err); break }
  if (st.reply && !st.busy) { reply = st.reply; break }
}
console.log('AI REPLY:', reply || '(none)')
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync('e:/CCui/scripts/chat-e2e.png', Buffer.from(shot.data, 'base64'))
console.log('EXCEPTIONS:', logs.length ? logs.join('\n') : 'none')
ws.close(); process.exit(0)
