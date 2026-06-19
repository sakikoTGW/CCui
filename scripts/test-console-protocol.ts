/**
 * 验证 daemon 控制台/文件协议：listResources / listDir / readFile。
 * 起一个独立 daemon 子进程，发命令，校验 resp。
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bun = process.execPath
const daemon = join(root, 'services', 'daemon', 'daemon.ts')

const child = spawn(bun, [daemon], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] })

let buf = ''
const waiters = new Map<string, (m: Record<string, unknown>) => void>()
let ready = false
const readyWaiters: Array<() => void> = []

child.stdout.on('data', d => {
  buf += d
  let i: number
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg: Record<string, unknown>
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.kind === 'ready') { ready = true; readyWaiters.splice(0).forEach(f => f()) }
    if (msg.kind === 'resp' && typeof msg.reqId === 'string') {
      const w = waiters.get(msg.reqId)
      if (w) { waiters.delete(msg.reqId); w(msg) }
    }
  }
})

function whenReady(): Promise<void> {
  return ready ? Promise.resolve() : new Promise(r => readyWaiters.push(r))
}
function req(cmd: Record<string, unknown>, timeout = 20000): Promise<Record<string, unknown>> {
  const reqId = `t${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(reqId); reject(new Error('timeout: ' + cmd.cmd)) }, timeout)
    waiters.set(reqId, m => { clearTimeout(timer); resolve(m) })
    child.stdin.write(JSON.stringify({ ...cmd, reqId }) + '\n')
  })
}

async function main() {
  await whenReady()
  let pass = 0, fail = 0
  const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  PASS', m) } else { fail++; console.log('  FAIL', m) } }

  const res = await req({ cmd: 'listResources' })
  const items = (res.items as unknown[]) || []
  ok(Array.isArray(items), `listResources 返回数组 (${items.length} 项)`)
  const kinds = new Set(items.map(i => (i as { kind: string }).kind))
  console.log('    kinds:', [...kinds].join(', ') || '(空)')

  const dir = await req({ cmd: 'listDir' })
  const entries = (dir.entries as unknown[]) || []
  ok(Array.isArray(entries) && entries.length > 0, `listDir 根目录返回 ${entries.length} 项`)

  const pkg = (entries as Array<{ name: string; type: string; path: string }>).find(e => e.name === 'package.json')
  if (pkg) {
    const file = await req({ cmd: 'readFile', path: pkg.path })
    const content = String(file.content || '')
    ok(content.includes('claude-code') || content.includes('name'), 'readFile 读到 package.json 内容')
  } else {
    ok(false, '根目录未见 package.json')
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  child.kill()
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); child.kill(); process.exit(1) })
