import { useCallback, useEffect, useMemo, useState } from 'react'
import { daemon } from '../../ipc/client'
import { toast } from '../../shell/store-bridge'

/**
 * 「Harness」一级视图 —— 驾驭者维度的从属树，三栏主从下钻：
 *   CCui(外壳) → harness(运行时框架) → instance(装配) → pack(整合包) → capability(能力)
 *
 * harness 与项目正交：harness/实例可独立 CLI 跑，也可被 CCui 接管(瓶口)当 GUI。
 * 心智(profile) 不在这里 —— 它绑项目，归项目页。
 */

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
  ccui: 'CCui 原生',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  cursor: 'Cursor',
  astrbot: 'AstrBot',
}

function packHasBinding(p: InstancePack): boolean {
  return !!p.binding && typeof p.binding === 'object' && Object.keys(p.binding as object).length > 0
}

export function HarnessView() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([])
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [busy, setBusy] = useState(false)

  const [selHarness, setSelHarness] = useState<string>('ccui')
  const [selId, setSelId] = useState<string | null>(null)
  const [expandedPack, setExpandedPack] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [instR, catR] = await Promise.all([
        daemon.request<{ instances?: Instance[]; activeId?: string | null }>({ cmd: 'instanceList' }, 15_000),
        daemon.request<{ entries?: CatalogEntry[]; runtimes?: RuntimeInfo[] }>({ cmd: 'packCatalog' }, 15_000),
      ])
      setInstances(instR.instances ?? [])
      setActiveId(instR.activeId ?? null)
      setCatalog(catR.entries ?? [])
      setRuntimes(catR.runtimes ?? [])
    } catch (e) {
      toast(`加载 Harness 失败：${(e as Error).message}`, { type: 'error' })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // 栏1：harness 集合 = 探测到的外部 runtime ∪ ccui 原生 ∪ 已有实例用到的 runtime
  const harnesses = useMemo(() => {
    const ids = new Set<string>(['ccui'])
    for (const r of runtimes) ids.add(r.id)
    for (const i of instances) ids.add(i.runtime)
    return [...ids].map(id => {
      const rt = runtimes.find(r => r.id === id)
      return {
        id,
        label: RUNTIME_LABEL[id] || rt?.label || id,
        detected: id === 'ccui' ? true : !!rt?.detected,
        count: instances.filter(i => i.runtime === id).length,
        skillCount: rt?.skillCount,
        mcpCount: rt?.mcpCount,
      }
    })
  }, [runtimes, instances])

  const harnessInstances = useMemo(
    () => instances.filter(i => i.runtime === selHarness),
    [instances, selHarness],
  )

  // 选中 harness 变化时，把选中实例落到该 harness 第一个
  useEffect(() => {
    if (selId && harnessInstances.some(i => i.id === selId)) return
    setSelId(harnessInstances[0]?.id ?? null)
  }, [harnessInstances, selId])

  const sel = instances.find(i => i.id === selId) ?? null

  // ---- 操作 ----
  const createInstance = async () => {
    const name = prompt(`在 ${RUNTIME_LABEL[selHarness] || selHarness} 上新建实例，起个名（如：调试专家）`)
    if (!name) return
    setBusy(true)
    try {
      const r = await daemon.request<{ instance?: Instance }>(
        { cmd: 'instanceCreate', name, runtime: selHarness },
        15_000,
      )
      await refresh()
      if (r.instance) setSelId(r.instance.id)
      toast(`已在 ${RUNTIME_LABEL[selHarness] || selHarness} 上创建「${name}」`, { type: 'success' })
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
        await daemon.request({ cmd: 'packExportAstrbotPlugin', pack: { schema: 'ccui-pack/v0.1', name: p.name } }, 30_000)
        n++
      }
      toast(`已生成 ${n} 个 AstrBot 插件到 data/plugins/`, { type: 'success' })
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

  const colStyle: React.CSSProperties = {
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '10px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="view-head">
        <h1>Harness</h1>
        <span className="vh-sub">CCui 驾驭的运行时 → 实例 → 整合包 → 能力（与项目正交）</span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, borderTop: '1px solid var(--border)' }}>
        {/* 栏1：Harness（运行时框架） */}
        <div style={{ ...colStyle, flex: '0 0 192px', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, opacity: 0.55, padding: '2px 8px 6px', textTransform: 'uppercase', letterSpacing: '.04em' }}>运行时框架</div>
          {harnesses.map(h => {
            const on = selHarness === h.id
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => setSelHarness(h.id)}
                style={{
                  textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  border: '1px solid transparent',
                  background: on ? 'var(--accent-weak)' : 'transparent',
                  color: on ? 'var(--accent)' : 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: on ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.label}</span>
                  <span style={{ fontSize: 10, opacity: 0.6, flexShrink: 0 }}>{h.count}</span>
                </div>
                <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>
                  {h.id === 'ccui' ? '内置直连' : h.detected ? '本机已装 · 可接管' : '未检测到'}
                </div>
              </button>
            )
          })}
        </div>

        {/* 栏2：实例（该 harness 下的装配） */}
        <div style={{ ...colStyle, flex: '0 0 232px', borderRight: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 8px 6px' }}>
            <span style={{ fontSize: 11, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '.04em' }}>实例</span>
            <button className="btn-ghost" disabled={busy} onClick={() => void createInstance()} style={{ fontSize: 12, padding: '2px 8px' }}>+ 新建</button>
          </div>
          {harnessInstances.length === 0 && (
            <p style={{ fontSize: 12, opacity: 0.6, padding: '4px 10px' }}>
              该 harness 下还没有实例。点「+ 新建」开始。
            </p>
          )}
          {harnessInstances.map(inst => {
            const on = selId === inst.id
            const active = activeId === inst.id
            return (
              <button
                key={inst.id}
                type="button"
                onClick={() => setSelId(inst.id)}
                style={{
                  textAlign: 'left', padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  background: on ? 'var(--accent-weak)' : 'var(--surface-2)',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.name}</span>
                  {active && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 999, background: 'var(--accent)', color: '#fff', flexShrink: 0 }}>运行中</span>}
                </div>
                <div style={{ fontSize: 10, opacity: 0.6, marginTop: 3 }}>
                  {inst.packs.length} 个整合包{inst.intercept?.enabled ? ' · 瓶口接管' : ''}
                </div>
              </button>
            )
          })}
        </div>

        {/* 栏3：详情（下钻：运行时信息 / 整合包▸能力 / 合同 / 瓶口） */}
        <div style={{ ...colStyle, flex: 1, padding: 16, gap: 14 }}>
          {!sel ? (
            <p style={{ fontSize: 13, opacity: 0.6 }}>在左侧选一个实例查看详情，或新建一个。</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{sel.name}</h3>
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{RUNTIME_LABEL[sel.runtime] || sel.runtime}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn-primary" disabled={busy || activeId === sel.id} onClick={() => void activate(sel.id)}>
                    {activeId === sel.id ? '运行中' : '启动'}
                  </button>
                  {sel.runtime === 'astrbot' && (
                    <button className="btn-ghost" disabled={busy} onClick={() => void exportAstrbotPlugins(sel.id)}>导出 AstrBot 插件</button>
                  )}
                  <button className="btn-ghost" disabled={busy} onClick={() => void remove(sel.id)}>删除</button>
                </div>
              </div>

              {/* 瓶口接管 */}
              {sel.runtime !== 'ccui' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.9, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <input type="checkbox" checked={!!sel.intercept?.enabled} disabled={busy} onChange={e => void toggleIntercept(sel.id, e.target.checked)} />
                  瓶口接管：让 CCui 当这个 harness 的 GUI——启动时把它的模型请求改道经 CCui 代理（可看/改/换模型）；停用自动还原
                </label>
              )}

              {/* 整合包 ▸ 能力（下钻第 4/5 层） */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>整合包 ▸ 能力</div>
                {sel.packs.length === 0 && <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>空实例。从下面装包。</p>}
                {sel.packs.map(p => {
                  const open = expandedPack === p.name
                  const caps = [
                    ...p.skills.map(s => ['skill', s] as const),
                    ...p.mcp.map(s => ['mcp', s] as const),
                    ...p.rules.map(s => ['rule', s] as const),
                  ]
                  return (
                    <div key={p.name} style={{ borderRadius: 8, border: '1px solid var(--border)', marginBottom: 6, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                        <button
                          type="button"
                          onClick={() => setExpandedPack(open ? null : p.name)}
                          style={{ flex: 1, textAlign: 'left', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            <span style={{ opacity: 0.5, marginRight: 6 }}>{open ? '▾' : '▸'}</span>
                            {p.name}
                            {packHasBinding(p) && (
                              <span title="带 CCui 行为契约，搬到别的 harness 会失效" style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--accent)', color: '#fff' }}>
                                CCui 调校
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2, paddingLeft: 18 }}>S{p.skills.length} · M{p.mcp.length} · R{p.rules.length} · {p.source}</div>
                        </button>
                        <button className="btn-ghost" disabled={busy} onClick={() => void removePack(p.name)} style={{ fontSize: 12, flexShrink: 0 }}>卸下</button>
                      </div>
                      {open && (
                        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px 8px 28px', display: 'flex', flexWrap: 'wrap', gap: 6, background: 'var(--surface-2)' }}>
                          {caps.length === 0 && <span style={{ fontSize: 11, opacity: 0.6 }}>该包未声明具体能力</span>}
                          {caps.map(([kind, name]) => (
                            <span key={`${kind}:${name}`} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, border: '1px solid var(--border)', opacity: 0.9 }}>
                              <span style={{ opacity: 0.5, marginRight: 4 }}>{kind === 'skill' ? 'S' : kind === 'mcp' ? 'M' : 'R'}</span>{name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 装包来源 */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>给这个实例装整合包</div>
                  <button className="btn-ghost" disabled={busy} onClick={installFile}>安装别人的 .pack.json</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {runtimes.filter(r => r.detected).map(r => (
                    <button key={r.id} className="btn-ghost" disabled={busy} onClick={() => void importRuntime(r.id)} style={{ fontSize: 12 }}>
                      导入本机 {RUNTIME_LABEL[r.id] || r.label}（S{r.skillCount ?? 0} M{r.mcpCount ?? 0}）
                    </button>
                  ))}
                </div>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
