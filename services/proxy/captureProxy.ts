/**
 * 抓包代理（瓶口）：转发任意 agent 运行时发往模型 API 的请求到真上游，
 * 同时录下「请求体 + 响应体」，并把请求蒸馏成 ccui-pack 草稿落盘。
 *
 * 这是「克隆别人 agent」的命门 —— 引擎自带的 base prompt / 工具 schema /
 * system-reminder（L2–L4）只在这里现形。详见 docs/PACK_SPEC.md。
 *
 * 设计要点：
 *  - tee() 响应流：客户端不被阻塞（流式照常），同时后台累积用于录制。
 *  - 零引擎依赖：纯 Bun.serve + fetch + node:fs，独立可跑、可单测。
 *  - onCapture 回调：供 daemon/UI 实时推送（下一片接 UI 视图）。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { distillRequest, type CcuiPackDraft } from './distill.js'

export type CaptureRecord = {
  id: string
  at: string
  method: string
  path: string
  requestBody: string
  responseBody: string
  status: number
  streamed: boolean
  pack: CcuiPackDraft | null
}

export type CaptureProxyOptions = {
  /** 监听端口 */
  port: number
  /** 真上游基址，如 https://api.deepseek.com/anthropic */
  upstreamBase: string
  /** 落盘目录（默认 <cwd>/.ccui） */
  outDir?: string
  /** 抓到一条完整记录时回调（UI 实时推送用） */
  onCapture?: (rec: CaptureRecord) => void
  /** 标注抓自哪个 agent/版本 */
  capturedFrom?: string | null
  /** 单条响应累积上限（防爆内存），默认 8MB */
  maxBodyBytes?: number
}

export type CaptureProxyHandle = {
  port: number
  url: string
  stop: () => void
}

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'content-length',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
])

function buildUpstreamUrl(upstreamBase: string, pathname: string, search: string): string {
  const base = upstreamBase.replace(/\/+$/, '')
  // 客户端走 /v1/messages，base 已含 /anthropic 这类前缀 → 直接拼
  return `${base}${pathname}${search}`
}

function forwardHeaders(src: Headers): Headers {
  const out = new Headers()
  for (const [k, v] of src.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue
    out.set(k, v)
  }
  return out
}

async function accumulateStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total <= maxBytes) chunks.push(value)
      }
    }
  } catch {
    /* 上游中断：返回已累积部分 */
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(Math.min(total, maxBytes))
  let off = 0
  for (const c of chunks) {
    if (off + c.byteLength > merged.length) break
    merged.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder().decode(merged)
}

let counter = 0
function nextId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter.toString(36)}`
}

export function startCaptureProxy(opts: CaptureProxyOptions): CaptureProxyHandle {
  const outDir = opts.outDir ?? join(process.cwd(), '.ccui')
  const capturesDir = join(outDir, 'captures')
  const packsDir = join(outDir, 'packs')
  const maxBytes = opts.maxBodyBytes ?? 8 * 1024 * 1024

  const server = Bun.serve({
    port: opts.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const method = req.method
      const requestBody =
        method === 'GET' || method === 'HEAD' ? '' : await req.text()

      const upstreamUrl = buildUpstreamUrl(
        opts.upstreamBase,
        url.pathname,
        url.search,
      )

      let upstream: Response
      try {
        upstream = await fetch(upstreamUrl, {
          method,
          headers: forwardHeaders(req.headers),
          body: requestBody || undefined,
          redirect: 'manual',
        })
      } catch (e) {
        return new Response(
          JSON.stringify({ error: `capture-proxy upstream failed: ${(e as Error).message}` }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        )
      }

      const respHeaders = forwardHeaders(upstream.headers)
      const id = nextId()
      const at = new Date().toISOString()

      // 仅对 messages / chat completions 做蒸馏
      const isLLM = /\/(v1\/messages|chat\/completions)/.test(url.pathname)
      const pack = isLLM ? distillRequest(requestBody, { path: url.pathname, capturedFrom: opts.capturedFrom ?? null }) : null

      const finalize = (responseBody: string, streamed: boolean) => {
        const rec: CaptureRecord = {
          id,
          at,
          method,
          path: url.pathname,
          requestBody,
          responseBody,
          status: upstream.status,
          streamed,
          pack,
        }
        void persist(rec)
        try {
          opts.onCapture?.(rec)
        } catch {
          /* 回调异常不影响转发 */
        }
      }

      const persist = async (rec: CaptureRecord) => {
        try {
          await mkdir(capturesDir, { recursive: true })
          await writeFile(
            join(capturesDir, `${rec.id}.json`),
            JSON.stringify(rec, null, 2),
            'utf8',
          )
          if (rec.pack) {
            await mkdir(packsDir, { recursive: true })
            await writeFile(
              join(packsDir, `${rec.id}.pack.json`),
              JSON.stringify(rec.pack, null, 2),
              'utf8',
            )
          }
        } catch {
          /* 落盘失败不影响转发 */
        }
      }

      if (!upstream.body) {
        finalize('', false)
        return new Response(null, { status: upstream.status, headers: respHeaders })
      }

      // tee：一支给客户端（不阻塞流式），一支后台累积录制
      const [toClient, toRecord] = upstream.body.tee()
      void accumulateStream(toRecord, maxBytes).then(text =>
        finalize(text, isLLM),
      )

      return new Response(toClient, {
        status: upstream.status,
        headers: respHeaders,
      })
    },
  })

  return {
    port: server.port,
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  }
}
