/**
 * 插件宿主孤岛（P9）。
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

const PLG_ICON = (
  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" fill="none" aria-hidden="true">
    <path d="M10 4a2 2 0 1 1 4 0v2h3a1 1 0 0 1 1 1v3h2a2 2 0 1 1 0 4h-2v3a1 1 0 0 1-1 1h-3v-2a2 2 0 1 0-4 0v2H6a1 1 0 0 1-1-1v-3H4a2 2 0 1 1 0-4h1V7a1 1 0 0 1 1-1h4z" />
  </svg>
)

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

function permLabel(perms: string[]): string {
  if (!perms.length) return '无特权'
  if (perms.length <= 2) return perms.join(' · ')
  return `${perms.length} 项权限`
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

  const closePlugin = useCallback(() => {
    bridgeRef.current?.dispose()
    bridgeRef.current = null
    setActive(null)
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
      records.map((r, i) => {
        const m = r.manifest
        const on = active?.record.manifest.id === m.id
        const busy = loadingId === m.id
        return (
          <button
            key={m.id}
            type="button"
            className={`plg-item${on ? ' plg-on' : ''}${busy ? ' plg-busy' : ''}`}
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            onClick={() => void openPlugin(r)}
            disabled={busy}
          >
            <span className="plg-item-ico" aria-hidden="true">{PLG_ICON}</span>
            <span className="plg-item-body">
              <span className="plg-name">{m.ui?.title ?? m.name}</span>
              <span className="plg-meta">
                v{m.version}
                {' · '}
                {permLabel(m.permissions)}
              </span>
              {m.description ? <span className="plg-desc">{m.description}</span> : null}
            </span>
            {busy ? <span className="plg-item-spin" aria-hidden="true" /> : null}
          </button>
        )
      }),
    [records, active, loadingId, openPlugin],
  )

  const activeTitle = active?.record.manifest.ui?.title ?? active?.record.manifest.name

  return (
    <div className="view view-plugins plg-root">
      <aside className="plg-side">
        <header className="plg-side-head">
          <div className="plg-side-title-wrap">
            <span className="plg-side-title">扩展</span>
            {!scanning && records.length > 0 ? (
              <span className="plg-count">{records.length}</span>
            ) : null}
          </div>
          <button type="button" className="plg-rescan" onClick={() => void rescan()} disabled={scanning}>
            {scanning ? '扫描中…' : '重新扫描'}
          </button>
        </header>
        {scanning && records.length === 0 ? (
          <div className="plg-skeleton" aria-hidden="true">
            <div className="plg-sk" /><div className="plg-sk" /><div className="plg-sk" />
          </div>
        ) : null}
        {!scanning && records.length === 0 ? (
          <div className="plg-empty">
            <span className="plg-empty-ico" aria-hidden="true">{PLG_ICON}</span>
            <p className="plg-empty-title">未发现插件</p>
            <p className="plg-hint">
              在项目根 <code>plugins/&lt;名称&gt;/</code> 放置
              <code>ccui.plugin.json</code> 与入口 HTML，通过 <code>window.ccui</code> 调用宿主能力。
            </p>
          </div>
        ) : null}
        {records.length > 0 ? <div className="plg-list">{list}</div> : null}
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
          <>
            <header className="plg-stage-head">
              <span className="plg-stage-title">{activeTitle}</span>
              <span className="plg-stage-id">{active.record.manifest.id}</span>
              <button type="button" className="plg-stage-close" onClick={closePlugin} title="关闭插件">
                关闭
              </button>
            </header>
            <iframe
              ref={iframeRef}
              className="plg-frame"
              title={active.record.manifest.name}
              sandbox="allow-scripts"
              srcDoc={active.srcdoc}
            />
          </>
        ) : (
          <div className="plg-stage-empty">
            <span className="plg-stage-empty-ico" aria-hidden="true">{PLG_ICON}</span>
            <p>{scanning ? '正在扫描插件…' : '从左侧选择插件以加载'}</p>
            <p className="plg-stage-empty-sub">插件在沙箱 iframe 中运行，权限由清单声明</p>
          </div>
        )}
      </section>
    </div>
  )
}
