#!/usr/bin/env bun
/**
 * 端到端发现探针：spawn 真实 daemon → 用 listDir / readFile（与 PluginHost.discover
 * 同一命令路径）扫 plugins/ → collectPlugins 校验。证明示例插件 hello 可被发现。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectPlugins } from '@ccui/plugin-sdk'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const daemonPath = join(root, 'services', 'daemon', 'daemon.ts')

const proc = Bun.spawn(['bun', daemonPath], { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
const writer = proc.stdin
const decoder = new TextDecoder()
let buf = ''
let seq = 0
const pending = new Map<string, (m: any) => void>()

function req(obj: Record<string, unknown>): Promise<any> {
  const reqId = `p${++seq}`
  return new Promise(resolve => {
    pending.set(reqId, resolve)
    writer.write(`${JSON.stringify({ ...obj, reqId })}\n`)
    writer.flush()
  })
}

let ready: () => void
const readyP = new Promise<void>(r => (ready = r))

async function readLoop() {
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      let msg: any
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.kind === 'ready') { ready(); continue }
      if (msg.kind === 'resp' && msg.reqId && pending.has(msg.reqId)) {
        pending.get(msg.reqId)!(msg)
        pending.delete(msg.reqId)
      }
    }
  }
}
void readLoop()

const timeout = setTimeout(() => { console.error('FAIL 超时'); proc.kill(); process.exit(1) }, 60_000)

await readyP

const dirResp = await req({ cmd: 'listDir', path: 'plugins' })
const dirs: string[] = (dirResp.entries ?? []).filter((e: any) => e.type === 'dir').map((e: any) => e.name)
console.log(`[listDir plugins] dirs = ${JSON.stringify(dirs)}`)

const entries: Array<{ dir: string; text: string }> = []
for (const name of dirs) {
  const r = await req({ cmd: 'readFile', path: `plugins/${name}/ccui.plugin.json` })
  if (typeof r.content === 'string') entries.push({ dir: `plugins/${name}`, text: r.content })
}

const { records, errors } = collectPlugins(entries)
console.log(`[collectPlugins] records=${records.length} errors=${errors.length}`)
for (const rec of records) console.log(`  - ${rec.manifest.id} v${rec.manifest.version} perms=[${rec.manifest.permissions.join(',')}] entry=${rec.manifest.ui?.entry}`)

const hello = records.find(r => r.manifest.id === 'hello')
let okAll = true
function ok(name: string, cond: boolean) { okAll = okAll && cond; console.log(`${cond ? '  ok ' : 'FAIL'} ${name}`) }

ok('plugins 目录含 hello', dirs.includes('hello'))
ok('hello 清单被发现', !!hello)
ok('hello 有 UI 入口 index.html', hello?.manifest.ui?.entry === 'index.html')
ok('hello 权限含 toast/daemon:request', !!hello && hello.manifest.permissions.includes('toast') && hello.manifest.permissions.includes('daemon:request'))

// 也验证入口 HTML 可读
if (hello) {
  const h = await req({ cmd: 'readFile', path: `${hello.dir}/${hello.manifest.ui!.entry}` })
  ok('hello 入口 HTML 可读且含 window.ccui', typeof h.content === 'string' && h.content.includes('window.ccui'))
}

clearTimeout(timeout)
writer.end()
proc.kill()
console.log(`\nplugin-discovery: ${okAll ? 'PASS' : 'FAIL'}`)
process.exit(okAll ? 0 : 1)
