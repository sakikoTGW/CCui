#!/usr/bin/env bun
/**
 * 验证 getRecall 命令链路：spawn 真实 daemon → 发 getRecall → 期望 ok 信封。
 * 证明 handlers 新增的 @ccui/engine-memory recallLog 导入可编译可运行、命令已注册。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const proc = Bun.spawn(['bun', join(root, 'services', 'daemon', 'daemon.ts')], {
  cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore',
})
const dec = new TextDecoder()
let buf = ''
const pending = new Map<string, (m: any) => void>()
let ready: () => void
const readyP = new Promise<void>(r => (ready = r))

async function loop() {
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line) continue
      let m: any; try { m = JSON.parse(line) } catch { continue }
      if (m.kind === 'ready') { ready(); continue }
      if (m.kind === 'resp' && m.reqId && pending.has(m.reqId)) { pending.get(m.reqId)!(m); pending.delete(m.reqId) }
    }
  }
}
void loop()
function req(o: Record<string, unknown>): Promise<any> {
  const reqId = `q${Math.random().toString(36).slice(2)}`
  return new Promise(res => { pending.set(reqId, res); proc.stdin.write(`${JSON.stringify({ ...o, reqId })}\n`); proc.stdin.flush() })
}

const to = setTimeout(() => { console.error('FAIL 超时(daemon 未就绪/无响应)'); proc.kill(); process.exit(1) }, 60_000)
await readyP

const r = await req({ cmd: 'getRecall' })
let okAll = true
const ok = (n: string, c: boolean) => { okAll = okAll && c; console.log(`${c ? '  ok ' : 'FAIL'} ${n}`) }
ok('daemon 就绪且 getRecall 有响应', !!r)
ok('getRecall 返回 ok 信封', r?.kind === 'resp' && r.ok === true)
ok('含 last 字段（null 或对象均可）', r && 'last' in r)
ok('含 history 数组', r && Array.isArray(r.history))
console.log(`[getRecall] last=${r?.last ? 'present' : 'null'} history=${r?.history?.length ?? 'n/a'}`)

clearTimeout(to)
proc.stdin.end(); proc.kill()
console.log(`\nrecall-probe: ${okAll ? 'PASS' : 'FAIL'}`)
process.exit(okAll ? 0 : 1)
