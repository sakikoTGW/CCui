#!/usr/bin/env bun
/**
 * GUI Core Daemon 协议 + 工具/权限链路验证
 * spawn daemon → 发 send（触发工具）→ 自动批准权限 → 收事件
 * 用法: bun run scripts/test-daemon.ts
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const daemonPath = join(root, 'src', 'gui-service', 'daemon.ts')

const proc = Bun.spawn(['bun', daemonPath], {
  cwd: root,
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'inherit',
})

const writer = proc.stdin
function sendCmd(obj: unknown) {
  writer.write(`${JSON.stringify(obj)}\n`)
  writer.flush()
}

const prompt =
  process.argv.slice(2).join(' ').trim() ||
  '用 Glob 或 Read 工具看看当前目录下有哪些 .md 文件，然后简短列出它们的文件名'

let sawTool = false
let sawPermission = false
let sawText = false
let sawDone = false

const decoder = new TextDecoder()
let buf = ''

async function readLoop() {
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      handleLine(JSON.parse(line))
    }
  }
}

function handleLine(msg: { kind: string; event?: { type: string; [k: string]: unknown } }) {
  if (msg.kind === 'ready') {
    console.log('[daemon] ready')
    console.log(`> ${prompt}\n`)
    sendCmd({ cmd: 'send', text: prompt })
    return
  }
  if (msg.kind !== 'event' || !msg.event) return
  const e = msg.event
  switch (e.type) {
    case 'route':
      console.log(`[路由] → ${e.model} (${e.tier}) ${e.reason}`)
      break
    case 'permission_request':
      sawPermission = true
      console.log(`[权限请求] ${e.toolName} → 自动批准`)
      sendCmd({ cmd: 'respondPermission', id: e.id, allow: true })
      break
    case 'text':
      sawText = true
      process.stdout.write(String(e.text))
      break
    case 'message': {
      const sdk = e.sdk as { type?: string; message?: { content?: unknown } }
      const content = sdk.message?.content
      if (Array.isArray(content) && content.some(b => b?.type === 'tool_use')) {
        sawTool = true
        const names = content.filter(b => b?.type === 'tool_use').map(b => b.name)
        console.log(`[工具调用] ${names.join(', ')}`)
      }
      break
    }
    case 'usage':
      console.log(`\n[用量] ${e.model} in=${e.inputTokens} out=${e.outputTokens} ≈$${Number(e.costUsd).toFixed(4)}`)
      break
    case 'error':
      console.error(`\n[错误] ${e.error}`)
      break
    case 'done':
      sawDone = true
      console.log('\n[完成]')
      report()
      break
  }
}

function report() {
  console.log('\n--- 验证结果 ---')
  console.log(`工具调用: ${sawTool ? '✓' : '—'}`)
  console.log(`权限往返: ${sawPermission ? '✓' : '— (工具被自动允许，无需 ask)'}`)
  console.log(`文本回复: ${sawText ? '✓' : '✗'}`)
  console.log(`正常结束: ${sawDone ? '✓' : '✗'}`)
  writer.end()
  proc.kill()
  process.exit(sawText && sawDone ? 0 : 1)
}

setTimeout(() => {
  console.error('\n[超时] 90s 未完成')
  proc.kill()
  process.exit(1)
}, 90_000)

void readLoop()
