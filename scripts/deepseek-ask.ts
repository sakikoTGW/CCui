#!/usr/bin/env bun
/**
 * DeepSeek 直连问答（不经过完整 CCui，秒级响应）
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from './loadEnv.js'

loadDotEnv(join(dirname(fileURLToPath(import.meta.url)), '..'))
const args = process.argv.slice(2)
let model = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro'
const promptParts: string[] = []

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' && args[i + 1]) {
    model = args[++i]
  } else {
    promptParts.push(args[i])
  }
}

const prompt = promptParts.join(' ').trim()
if (!prompt) {
  console.error('用法: bun scripts/deepseek-ask.ts [--model deepseek-v4-pro] 你的问题')
  process.exit(1)
}

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('请设置 ANTHROPIC_API_KEY（DeepSeek API Key）')
  process.exit(1)
}

const base =
  process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, '') ??
  'https://api.deepseek.com/anthropic'

const res = await fetch(`${base}/v1/messages`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  }),
})

const body = await res.text()
if (!res.ok) {
  console.error(`API ${res.status}: ${body}`)
  process.exit(1)
}

const data = JSON.parse(body) as {
  content?: Array<{ type: string; text?: string; thinking?: string }>
}

for (const block of data.content ?? []) {
  if (block.type === 'text' && block.text) console.log(block.text)
  else if (block.type === 'thinking' && block.thinking) {
    // v4 默认 thinking 模式，只输出最终 text；若无 text 则提示
  }
}

const hasText = (data.content ?? []).some(b => b.type === 'text' && b.text)
if (!hasText) {
  console.log(JSON.stringify(data, null, 2))
}
