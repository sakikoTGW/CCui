#!/usr/bin/env bun
/**
 * AgentSession headless 垂直切片演示（M0 命门验证）
 * 发一句话 → ModelRouter 分派 → 引擎跑通 → 事件流（含模型/成本）
 *
 * 用法: bun run scripts/gui-headless-demo.ts "你的问题"
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from './loadEnv.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
process.env.CLAUDE_CODE_DEV ??= '1'

// MACRO.* 通常由 Bun --define 编译期注入；headless 直跑 .ts 没经 build，运行时兜底。
;(globalThis as Record<string, unknown>).MACRO ??= new Proxy(
  { VERSION: '2.0.0-dev' } as Record<string, unknown>,
  { get: (t, k) => (k in t ? t[k as string] : '') },
)

const prompt = process.argv.slice(2).join(' ').trim() || '用一句话介绍你自己'

const { AgentSession } = await import('../src/gui-service/agentSession.js')

const session = new AgentSession({ cwd: root, autoApprove: true })

session.onEvent(e => {
  switch (e.type) {
    case 'route':
      console.log(`\n[路由] → ${e.model} (${e.tier}) 因为: ${e.reason}`)
      break
    case 'text':
      process.stdout.write(e.text)
      break
    case 'permission_request':
      console.log(`\n[权限请求] ${e.toolName}: ${e.message}`)
      break
    case 'usage':
      console.log(
        `\n[用量] ${e.model}  in=${e.inputTokens} out=${e.outputTokens}  ≈$${e.costUsd.toFixed(4)}`,
      )
      break
    case 'done':
      console.log('\n[完成]')
      break
    case 'error':
      console.error(`\n[错误] ${e.error}`)
      break
  }
})

console.log(`> ${prompt}`)
await session.send(prompt)
process.exit(0)
