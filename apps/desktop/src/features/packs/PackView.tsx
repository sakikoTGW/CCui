import { useCallback, useEffect, useState } from 'react'
import { daemon } from '../../ipc/client'
import { toast } from '../../shell/store-bridge'

interface RuntimeInfo {
  id: string
  label: string
  verified: boolean
  detected: boolean
  skillCount?: number
  mcpCount?: number
}

interface CatalogEntry {
  id: string
  runtime: string
  label: string
  description: string
  type: 'runtime-import' | 'bundled' | 'community'
  author?: string
}

interface InstancePack {
  name: string
  source: string
  installedAt: string
  skills: string[]
  rules: string[]
  mcp: string[]
  binding?: unknown
}

interface Instance {
  id: string
  name: string
  runtime: string
  createdAt: string
  activatedAt?: string
  packs: InstancePack[]
  intercept?: { enabled: boolean; upstream?: string }
}

const RUNTIME_LABEL: Record<string, string> = {
  'ccui': 'CCui 原生',
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'openclaw': 'OpenClaw',
  'hermes': 'Hermes',
  'cursor': 'Cursor',
}

function packHasBinding(p: InstancePack): boolean {
  return !!p.binding && typeof p.binding === 'object' && Object.keys(p.binding as object).length > 0
}

export function PackView() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([])
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [instR, catR] = await Promise.all([
        daemon.request<{ instances?: Instance[]; activeId?: string | null }>({ cmd: 'instanceList' }, 15_000),
        daemon.request<{ entries?: CatalogEntry[]; runtimes?: RuntimeInfo[] }>({ cmd: 'packCatalog' }, 15_000),
      ])
      const list = instR.instances ?? []
      setInstances(list)
      setActiveId(instR.activeId ?? null)
      setSelId(cur => (cur && list.some(i => i.id === cur) ? cur : list[0]?.id ?? null))
      setCatalog(catR.entries ?? [])
      setRuntimes(catR.runtimes ?? [])
    } catch (e) {
      toast(`加载实例失败：${(e as Error).message}`, { type: 'error' })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const sel = instances.find(i => i.id === selId) ?? null

  const createInstance = async () => {
    const name = prompt('新实例名称（如：调试专家 / 前端美学）')
    if (!name) return
    const runtime = prompt('基于哪个运行时？ccui / claude-code / codex / openclaw / hermes / cursor', 'ccui') || 'ccui'
    setBusy(true)
    try {
      const r = await daemon.request<{ instance?: Instance }>({ cmd: 'instanceCreate', name, runtime }, 15_000)
      await refresh()
      if (r.instance) setSelId(r.instance.id)
      toast(`已创建实例「${name}」`, { type: 'success' })
    } catch (e) {
      toast(`创建失败：${(e as Error).message}`, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const activate = async (id: string) => {
    setBusy(true)
    try {
      await daemon.request({ cmd: 'instanceActivate', id }, 30_000)
      await refresh()
      toast('已启动该实例（harness 已切换）', { type: 'success' })
    } catch (e) {
      toast(`启动失败：${(e as Error).message}`, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('删除整个实例？其整合包与投射会一并清除（不影响本机引擎配置）。')) return
    setBusy(true)
    try {
      await daemon.request({ cmd: 'instanceDelete', id }, 15_000)
      await refresh()
      toast('实例已删除', { type: 'success' })
    } catch (e) {
      toast(`删除失败：${(e as Error).message}`, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const installCatalog = async (entryId: string) => {
    if (!selId) { toast('请先选中一个实例', { type: 'warn' }); return }
    setBusy(true)
    try {
      await daemon.request({ cmd: 'instanceInstallCatalog', id: selId, entryId }, 60_000)
      await refresh()
      toast('整合包已装入实例', { type: 'success' })
    } catch (e) {
      toast(`装入失败：${(e as Error).message}`, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const importRuntime = async (runtime: string) => {
    if (!selId) { toast('请先选中一个实例', { type: 'warn' }); return }
    setBusy(true)
    try {
      await daemon.request({ cmd: 'instanceImportRuntime', id: selId, runtime }, 60_000)
      await refresh()
      toast(`已从本机 ${RUNTIME_LABEL[runtime] || runtime} 导入到实例`, { type: 'success' })
    } catch (e) {
      toast(`导入失败：${(e as Error).message}`, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const installFile = () => {
    if (!selId) { toast('请先选中一个实例', { type: 'warn' }); return }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.pack.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setBusy(true)
      try {
        const pack = JSON.parse(await file.text()) as Record<string, unknown>
        await daemon.request({ cmd: 'instanceInstallInline', id: selId, pack }, 90_000)
        await refresh()
        toast(`已把别人的整合包装入实例：${file.name}`, { type: 'success' })
      } catch (e) {
        toast(`装入失败：${(e as Error).message}`, { type: 'error' })
      } finally {
        setBusy(false)
      }
    }
    input.click()
  }

  const toggleIntercept = async (id: string, enabled: boolean) => {
    setBusy(true)
    try {
      await daemon.request({ cmd: 'instanceSetIntercept', id, enabled }, 15_000)
      await refresh()
      toast(enabled ? '已开启瓶口接管：启动时该引擎请求经 CCui 代理' : '已关闭瓶口接管', { type: 'success' })
    } catch (e) {
      toast(`设置失败：${(e as Error).message}`, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const exportAstrbotPlugins = async (id: string) => {
    const inst = instances.find(i => i.id === id)
    if (!inst) return
    setBusy(true)
    try {
      let n = 0
      for (const p of inst.packs) {
        await daemon.request({ cmd: 'packExportAstrbotPlugin', pack: { schema: 'ccui-pack/v0.1', name: p.name }, }, 30_000)
        n++
      }
      toast(`已生成 ${n} 个 AstrBot 插件到 data/plugins/（把它们放进 AstrBot 即可）`, { type: 'success' })
    } catch (e) {
      toast(`生成失败：${(e as Error).message}`, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const removePack = async (packName: string) => {
    if (!selId) return
    setBusy(true)
    try {
      await daemon.request({ cmd: 'instanceRemovePack', id: selId, packName }, 30_000)
      await refresh()
      toast(`已从实例卸下「${packName}」`, { type: 'success' })
    } catch (e) {
      toast(`卸载失败：${(e as Error).message}`, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-body" style={{ maxWidth: 1000, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.78 }}>
          每个<strong>实例</strong>是隔离的 harness（运行时 + 整合包），装/卸只在实例内，<strong>不污染本机</strong>。启动 = 换整套专家。
        </p>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="btn-ghost" disabled={busy} onClick={() => void refresh()}>刷新</button>
          <button className="btn-primary" disabled={busy} onClick={() => void createInstance()}>+ 新建实例</button>
        </div>
      </div>

        {/* 实例网格 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {instances.length === 0 && (
            <p style={{ fontSize: 13, opacity: 0.7 }}>还没有实例。点「+ 新建实例」开始（像在 PCL 里新建一个游戏实例）。</p>
          )}
          {instances.map(inst => {
            const on = selId === inst.id
            const active = activeId === inst.id
            return (
              <button
                key={inst.id}
                type="button"
                onClick={() => setSelId(inst.id)}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  borderRadius: 10,
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  background: on ? 'var(--accent-weak)' : 'var(--surface-2)',
                  color: 'inherit',
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                {active && (
                  <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--accent)', color: '#fff' }}>
                    运行中
                  </span>
                )}
                <div style={{ fontWeight: 600, fontSize: 14 }}>{inst.name}</div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>{RUNTIME_LABEL[inst.runtime] || inst.runtime}</div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>{inst.packs.length} 个整合包</div>
              </button>
            )
          })}
        </div>

        {/* 选中实例详情 */}
        {sel && (
          <section className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{sel.name}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary" disabled={busy || activeId === sel.id} onClick={() => void activate(sel.id)}>
                  {activeId === sel.id ? '运行中' : '启动'}
                </button>
                {sel.runtime === 'astrbot' && (
                  <button className="btn-ghost" disabled={busy} onClick={() => void exportAstrbotPlugins(sel.id)}>导出 AstrBot 插件</button>
                )}
                <button className="btn-ghost" disabled={busy} onClick={() => void remove(sel.id)}>删除</button>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.9, marginBottom: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!sel.intercept?.enabled}
                disabled={busy}
                onChange={e => void toggleIntercept(sel.id, e.target.checked)}
              />
              瓶口接管：启动时把该引擎请求改道经 CCui 代理（可看/改/换模型）；停用自动还原
            </label>

            {/* 已装整合包 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>实例内的整合包</div>
              {sel.packs.length === 0 && <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>空实例。从下面装包。</p>}
              {sel.packs.map(p => (
                <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {p.name}
                      {packHasBinding(p) && (
                        <span title="带 CCui 行为契约，搬到别的运行时会失效" style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--accent)', color: '#fff' }}>
                          CCui 调校
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>S{p.skills.length} R{p.rules.length} M{p.mcp.length} · {p.source}</div>
                  </div>
                  <button className="btn-ghost" disabled={busy} onClick={() => void removePack(p.name)}>卸下</button>
                </div>
              ))}
            </div>

            {/* 装包来源 */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>给这个实例装整合包</div>
                <button className="btn-ghost" disabled={busy} onClick={installFile}>安装别人的 .pack.json</button>
              </div>

              {/* 本机运行时导入 */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {runtimes.filter(r => r.detected).map(r => (
                  <button key={r.id} className="btn-ghost" disabled={busy} onClick={() => void importRuntime(r.id)} style={{ fontSize: 12 }}>
                    导入本机 {RUNTIME_LABEL[r.id] || r.label}（S{r.skillCount ?? 0} M{r.mcpCount ?? 0}）
                  </button>
                ))}
              </div>

              {/* 目录 */}
              <div style={{ display: 'grid', gap: 8 }}>
                {catalog.filter(e => e.type === 'bundled').map(entry => (
                  <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{entry.label}</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>{entry.description}</div>
                    </div>
                    <button className="btn-primary" disabled={busy} onClick={() => void installCatalog(entry.id)} style={{ flexShrink: 0 }}>装入</button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
    </div>
  )
}
