/**
 * 抓包克隆服务（daemon 侧）：把瓶口代理挂进常驻 daemon，
 * 抓到的每条请求蒸馏成整合包草稿后，实时经 out() 推给 UI（kind:'capture'）。
 *
 * 引擎自带的 base prompt / 工具 schema / system-reminder（L2–L4）只在这里现形。
 * 规范见 docs/PACK_SPEC.md，纯抓包引擎见 services/proxy/。
 */
import { join } from 'node:path'
import {
  startCaptureProxy,
  type CaptureProxyHandle,
  type CaptureRecord,
} from '../proxy/captureProxy.js'

const PREVIEW_LIMIT = 100_000
const RING_MAX = 50
const DEFAULT_PORT = 4178
const DEFAULT_UPSTREAM = 'https://api.deepseek.com/anthropic'

export type CaptureSummary = {
  id: string
  at: string
  method: string
  path: string
  status: number
  streamed: boolean
  model: string | null
  basePromptLen: number
  toolCount: number
  requestPreview: string
  responsePreview: string
  pack: CaptureRecord['pack']
}

export type CaptureStatus = {
  running: boolean
  url: string | null
  upstream: string
}

type Emit = (obj: unknown) => void

function toSummary(rec: CaptureRecord): CaptureSummary {
  return {
    id: rec.id,
    at: rec.at,
    method: rec.method,
    path: rec.path,
    status: rec.status,
    streamed: rec.streamed,
    model: rec.pack?.model.name ?? null,
    basePromptLen: rec.pack?.harness.base_system_prompt.length ?? 0,
    toolCount: rec.pack?.harness.tool_schemas.length ?? 0,
    requestPreview: rec.requestBody.slice(0, PREVIEW_LIMIT),
    responsePreview: rec.responseBody.slice(0, PREVIEW_LIMIT),
    pack: rec.pack,
  }
}

class CaptureService {
  private handle: CaptureProxyHandle | null = null
  private ring: CaptureSummary[] = []
  private emit: Emit | null = null
  private upstream = ''

  setEmitter(emit: Emit): void {
    this.emit = emit
  }

  start(opts: { port?: number; upstream?: string } = {}): CaptureStatus {
    if (this.handle) return this.status()
    const upstream =
      opts.upstream ||
      process.env.ANTHROPIC_BASE_URL ||
      DEFAULT_UPSTREAM
    this.upstream = upstream
    this.handle = startCaptureProxy({
      port: opts.port ?? DEFAULT_PORT,
      upstreamBase: upstream,
      outDir: join(process.cwd(), '.ccui'),
      onCapture: rec => this.onCapture(rec),
    })
    return this.status()
  }

  stop(): CaptureStatus {
    try {
      this.handle?.stop()
    } catch {
      /* ignore */
    }
    this.handle = null
    return this.status()
  }

  status(): CaptureStatus {
    return {
      running: !!this.handle,
      url: this.handle?.url ?? null,
      upstream: this.upstream || (process.env.ANTHROPIC_BASE_URL ?? DEFAULT_UPSTREAM),
    }
  }

  list(): CaptureSummary[] {
    return this.ring
  }

  private onCapture(rec: CaptureRecord): void {
    const summary = toSummary(rec)
    this.ring.unshift(summary)
    if (this.ring.length > RING_MAX) this.ring.pop()
    try {
      this.emit?.({ kind: 'capture', record: summary })
    } catch {
      /* 推送失败不影响抓包落盘 */
    }
  }
}

export const captureService = new CaptureService()
