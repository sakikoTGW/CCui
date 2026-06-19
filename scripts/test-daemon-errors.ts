/** 验证 daemon 错误信封：坏 JSON / 非法命令 / 业务错误码。 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const daemon = join(root, 'services', 'daemon', 'daemon.ts')
const child = spawn(process.execPath, [daemon], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] })

let buf = ''
let ready = false
const msgs: Record<string, unknown>[] = []
const readyWaiters: Array<() => void> = []

child.stdout.on('data', d => {
  buf += d
  let i: number
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    let m: Record<string, unknown>
    try { m = JSON.parse(line) } catch { continue }
    msgs.push(m)
    if (m.kind === 'ready') { ready = true; readyWaiters.splice(0).forEach(f => f()) }
  }
})
const whenReady = () => ready ? Promise.resolve() : new Promise<void>(r => readyWaiters.push(r))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  await whenReady()
  let pass = 0, fail = 0
  const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  PASS', m) } else { fail++; console.log('  FAIL', m) } }

  // 坏 JSON
  child.stdin.write('{ not json\n')
  await sleep(300)
  const badJson = msgs.find(m => m.kind === 'error' && (m.error as { code?: string })?.code === 'BAD_JSON')
  ok(!!badJson, '坏 JSON → kind:error code:BAD_JSON')

  // 非法命令（send 缺 text）
  child.stdin.write(JSON.stringify({ cmd: 'send' }) + '\n')
  await sleep(300)
  const badCmd = msgs.find(m => m.kind === 'error' && (m.error as { code?: string })?.code === 'BAD_COMMAND')
  ok(!!badCmd, '非法命令 → kind:error code:BAD_COMMAND')

  // 未知命令
  child.stdin.write(JSON.stringify({ cmd: 'nope', reqId: 'x1' }) + '\n')
  await sleep(300)
  const unknown = msgs.find(m => m.kind === 'error' && /nope|无 cmd|BAD/i.test(JSON.stringify(m.error)))
  ok(!!unknown, '未知命令 → 错误信封')

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  child.kill()
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); child.kill(); process.exit(1) })
