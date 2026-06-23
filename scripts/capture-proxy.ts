#!/usr/bin/env bun
/**
 * 抓包代理启动器：读 .env 的 ANTHROPIC_BASE_URL 当上游，起本地代理。
 *
 * 用法：
 *   bun scripts/capture-proxy.ts [port]
 * 然后把任意 agent 运行时的 base url 指向打印出来的地址，例如：
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:4178
 * 抓到的请求/响应落在 <cwd>/.ccui/captures，蒸馏出的整合包草稿在 <cwd>/.ccui/packs。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from './loadEnv.js'
import { startCaptureProxy } from '../services/proxy/captureProxy.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)

const port = Number(process.argv[2] ?? process.env.CCUI_CAPTURE_PORT ?? 4178)
const upstreamBase =
  process.env.CCUI_CAPTURE_UPSTREAM ??
  process.env.ANTHROPIC_BASE_URL ??
  'https://api.deepseek.com/anthropic'

const handle = startCaptureProxy({
  port,
  upstreamBase,
  outDir: join(root, '.ccui'),
  capturedFrom: process.env.CCUI_CAPTURE_FROM ?? null,
  onCapture: rec => {
    const promptLen = rec.pack?.harness.base_system_prompt.length ?? 0
    const tools = rec.pack?.harness.tool_schemas.length ?? 0
    console.error(
      `[capture] ${rec.method} ${rec.path} -> ${rec.status} | basePrompt=${promptLen}ch tools=${tools} ${rec.pack ? `(pack ${rec.id})` : ''}`,
    )
  },
})

console.error(`[capture-proxy] listening ${handle.url}`)
console.error(`[capture-proxy] upstream  ${upstreamBase}`)
console.error(`[capture-proxy] point your runtime: ANTHROPIC_BASE_URL=${handle.url}`)

process.on('SIGINT', () => {
  handle.stop()
  process.exit(0)
})
