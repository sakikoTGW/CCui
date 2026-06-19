/**
 * 插件宿主孤岛（P9）。
 *
 * - 发现：经 daemon 只读命令扫 <project>/plugins/<name>/ccui.plugin.json，
 *   用 @ccui/plugin-sdk 的 collectPlugins 校验。
 * - 隔离：每个插件渲染进 sandbox="allow-scripts"（无 allow-same-origin → 唯一
 *   通道是 postMessage）的 iframe，内容用 srcdoc（宿主读 HTML 文本 + 注入
 *   window.ccui 引导）。插件崩溃/越权都困在 iframe 内。
 * - 桥：createPluginBridge 把访客 RPC 按 manifest.permissions + 白名单门控后，
 *   翻译成宿主 toast / bus / store / daemon 调用。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPluginSrcdoc,
  collectPlugins,
  createPluginBridge,
  type HostBridge,
  type PluginRecord,
} from '@ccui/plugin-sdk'
import { daemon } from '../../ipc/client'
import { bus } from '../../shell/bus'
import { ccuiStore } from '../../shell/store'
import { toast } from '../../shell/store-bridge'

interface LoadedPlugin {
  record: PluginRecord
  srcdoc: string
}

async function discover(): Promise<{ records: PluginRecord[]; errors: string[] }> {
  let dirs: string[] = []
  try {
    const resp = await daemon.request<{ entries?: Array<{ name: string; type: string }> }>(
      { cmd: 'listDir', path: 'plugins' },
      15000,
    )
    dirs = (resp.entries ?? []).filter(e => e.type === 'dir').map(e => e.name)
  } catch {
    return { records: [], errors: [] }
  }
  const entries: Array<{ dir: string; text: string }> = []
  for (const name of dirs) {
    try {
      const r = await daemon.request<{ content?: string }>(
        { cmd: 'readFile', path: `plugins/${name}/ccui.plugin.json` },
        10000,
      )
      if (r.content) entries.push({ dir: `plugins/${name}`, text: r.content })
    } catch {
      /* 无清单的目录跳过 */
    }
  }
  const { records, errors } = collectPlugins(entries)
  return { records, errors: errors.map(e => `${e.dir}: ${e.error}`) }
}

export function PluginHost(): React.ReactElement {
  const [records, setRecords] = useState<PluginRecord[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [scanning, setScanning] = useState(true)
  const [active, setActive] = useState<LoadedPlugin | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const bridgeRef = useRef<HostBridge | null>(null)

  const rescan = useCallback(async () => {
    setScanning(true)
    try {
      const { records, errors } = await discover()
      setRecords(records)
      setErrors(errors)
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void rescan()
  }, [rescan])

  // 单一 window 消息监听（组件生命周期内常驻），按 iframe 源过滤后交当前 bridge。
  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      const frame = iframeRef.current
      if (!frame || e.source !== frame.contentWindow) return
      bridgeRef.current?.handleMessage(e.data)
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      bridgeRef.current?.dispose()
      bridgeRef.current = null
    }
  }, [])

  const openPlugin = useCallback(async (record: PluginRecord) => {
    if (!record.manifest.ui) {
      toast('该插件未声明 UI 入口', { type: 'info' })
      return
    }
    setLoadingId(record.manifest.id)
    try {
      const r = await daemon.request<{ content?: string }>(
        { cmd: 'readFile', path: `${record.dir}/${record.manifest.ui.entry}` },
        10000,
      )
      const html = r.content ?? '<!doctype html><meta charset="utf-8"><body>插件入口为空</body>'
      const srcdoc = buildPluginSrcdoc(record.manifest.id, html)

      bridgeRef.current?.dispose()
      bridgeRef.current = createPluginBridge({
        manifest: record.manifest,
        post: msg => iframeRef.current?.contentWindow?.postMessage(msg, '*'),
        toast: (message, type) => toast(message, { type: (type as 'info') ?? 'info' }),
        emit: (event, payload) =>
          (bus.emit as unknown as (e: string, p: unknown) => void)(event, payload),
        on: (event, handler) =>
          (bus.on as unknown as (e: string, h: (p: unknown) => void) => () => void)(event, handler),
        getState: () => ccuiStore().getState() as unknown as Record<string, unknown>,
        daemonRequest: async cmd => daemon.request(cmd as Record<string, unknown>, 20000),
      })
      setActive({ record, srcdoc })
    } catch (e) {
      toast(`插件加载失败：${(e as Error).message}`, { type: 'error' })
    } finally {
      setLoadingId(null)
    }
  }, [])

  const list = useMemo(
    () =>
      records.map(r => {
        const m = r.manifest
        const on = active?.record.manifest.id === m.id
        return (
          <button
            key={m.id}
            type="button"
            className={`plg-item${on ? ' plg-on' : ''}`}
            onClick={() => void openPlugin(r)}
            disabled={loadingId === m.id}
          >
            <span className="plg-name">{m.ui?.title ?? m.name}</span>
            <span className="plg-meta">
              v{m.version}
              {m.permissions.length ? ` · ${m.permissions.length} 权限` : ' · 无特权'}
            </span>
            {m.description ? <span className="plg-desc">{m.description}</span> : null}
          </button>
        )
      }),
    [records, active, loadingId, openPlugin],
  )

  return (
    <div className="view view-plugins plg-root">
      <aside className="plg-side">
        <header className="plg-side-head">
          <span className="plg-side-title">扩展</span>
          <button type="button" className="plg-rescan" onClick={() => void rescan()} disabled={scanning}>
            {scanning ? '扫描中…' : '重新扫描'}
          </button>
        </header>
        {records.length === 0 && !scanning ? (
          <div className="plg-empty">
            <p>未发现插件。</p>
            <p className="plg-hint">
              在项目根 <code>plugins/&lt;名称&gt;/</code> 放 <code>ccui.plugin.json</code> 与入口 HTML，
              用 <code>window.ccui</code> 调用宿主能力。
            </p>
          </div>
        ) : (
          <div className="plg-list">{list}</div>
        )}
        {errors.length ? (
          <div className="plg-errors">
            {errors.map((e, i) => (
              <div key={i} className="plg-error">⚠ {e}</div>
            ))}
          </div>
        ) : null}
      </aside>
      <section className="plg-stage">
        {active ? (
          <iframe
            ref={iframeRef}
            className="plg-frame"
            title={active.record.manifest.name}
            sandbox="allow-scripts"
            srcDoc={active.srcdoc}
          />
        ) : (
          <div className="plg-stage-empty">
            {scanning ? '正在扫描插件…' : '选择左侧插件以加载'}
          </div>
        )}
      </section>
    </div>
  )
}
