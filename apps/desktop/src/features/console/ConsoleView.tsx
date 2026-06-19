import { useEffect, useState } from 'react'
import { daemon } from '../../ipc/client'
import { idb } from '../../data/idb'
import { getStore, toast } from '../../shell/store-bridge'
import { bus } from '../../shell/bus'

interface ResourceItem {
  id: string
  kind: 'skill' | 'agent' | 'rule' | 'mcp'
  name: string
  description?: string
  source?: string
  path?: string
}

const GROUPS: { kind: ResourceItem['kind']; label: string }[] = [
  { kind: 'skill', label: '技能 Skills' },
  { kind: 'agent', label: '子代理 Agents' },
  { kind: 'rule', label: '规则 Rules' },
  { kind: 'mcp', label: 'MCP 服务' },
]

type ResMap = Record<string, { kind: string; name: string; path?: string }>

async function readDisabled(): Promise<Set<string>> {
  const row = await idb.get<{ id: string; value: string[] }>('settings', 'disabledResources').catch(() => undefined)
  return new Set(row?.value ?? [])
}
function openInTree(path?: string) {
  if (!path) return
  bus.emit('openfile', { path })
  toast('已在文件面板打开', { type: 'info' })
}

export function ConsoleView() {
  const [items, setItems] = useState<ResourceItem[]>([])
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')

  const load = async (force?: boolean) => {
    setPhase('loading')
    let list: ResourceItem[]
    try {
      const resp = await daemon.request<{ items?: ResourceItem[] }>({ cmd: 'listResources' }, 20000)
      list = resp.items ?? []
    } catch (e) {
      setErrMsg((e as Error).message)
      setPhase('error')
      return
    }
    // 持久化 resourceMap，并把已禁用列表下发 daemon（与 vanilla 行为一致）
    try {
      const map: ResMap = {}
      for (const it of list) map[it.id] = { kind: it.kind, name: it.name, path: it.path }
      await idb.put('settings', { id: 'resourceMap', value: map })
      const set = await readDisabled()
      if (set.size || Object.keys(map).length) {
        await daemon.request({ cmd: 'setDisabledResources', ids: [...set], map }, 15000).catch(() => {})
      }
    } catch { /* 持久化失败不阻断展示 */ }
    setItems(list)
    setDisabled(await readDisabled())
    setPhase('ok')
    if (force) toast('已重新扫描', { type: 'success' })
  }

  useEffect(() => {
    load()
  }, [])

  const persistDisabled = async (next: Set<string>, all: ResourceItem[]) => {
    await idb.put('settings', { id: 'disabledResources', value: [...next] }).catch(() => {})
    getStore()?.set({ disabledResources: [...next] })
    const map: ResMap = {}
    for (const it of all) map[it.id] = { kind: it.kind, name: it.name, path: it.path }
    try {
      await daemon.request({ cmd: 'setDisabledResources', ids: [...next], map }, 15000)
    } catch (e) {
      toast(`引擎同步失败：${(e as Error).message}`, { type: 'warn' })
    }
  }

  const onToggle = async (it: ResourceItem, enabled: boolean) => {
    const next = new Set(disabled)
    if (enabled) next.delete(it.id)
    else next.add(it.id)
    setDisabled(next)
    await persistDisabled(next, items)
    if (it.kind === 'mcp') {
      try {
        const r = await daemon.request<{ ok?: boolean }>({ cmd: 'toggleMcp', name: it.name, enabled })
        toast(r.ok ? `MCP ${it.name} 已${enabled ? '启用' : '禁用'}` : 'MCP 开关未生效', { type: r.ok ? 'success' : 'warn' })
      } catch {
        toast('MCP 开关失败', { type: 'error' })
      }
    } else {
      toast(`${it.name} 已${enabled ? '启用' : '硬禁用'}`, { type: 'success' })
    }
  }

  return (
    <>
      <div className="view-head">
        <h1>控制台</h1>
        <div className="vh-actions">
          <button className="btn-ghost" onClick={() => load(true)}>重新扫描</button>
        </div>
      </div>
      <div className="console-note">
        所有开关均为<strong>引擎级硬过滤</strong>：禁用的 skill 不会进入命令池，rule 不会注入记忆，agent 不会出现在子代理列表；MCP 走连接开关。变更后<strong>新对话</strong>立即生效。
      </div>
      <div className="console-body">
        {phase === 'loading' && <div className="console-loading">正在扫描资源…</div>}
        {phase === 'error' && (
          <div className="error-state">扫描失败：{errMsg}<br />请确认 daemon 正在运行。</div>
        )}
        {phase === 'ok' &&
          GROUPS.map((g) => {
            const list = items.filter((i) => i.kind === g.kind)
            return (
              <section className="con-group" key={g.kind}>
                <h2>
                  {g.label} <span className="con-count">{list.length}</span>
                </h2>
                {list.length === 0 ? (
                  <div className="con-empty">{g.kind === 'mcp' ? '未配置 MCP 服务' : `未发现 ${g.label}`}</div>
                ) : (
                  list.map((it) => {
                    const off = disabled.has(it.id)
                    return (
                      <div className={`con-row${off ? ' off' : ''}`} key={it.id}>
                        <label className="switch">
                          <input type="checkbox" checked={!off} onChange={(e) => onToggle(it, e.target.checked)} />
                          <span className="track" />
                        </label>
                        <div className="con-main">
                          <div className="con-name">{it.name}</div>
                          <div className="con-desc">{it.description || '—'}</div>
                        </div>
                        <span className="con-src">{it.source}</span>
                        <button className="con-view" title="查看文件" onClick={() => openInTree(it.path)}>↗</button>
                      </div>
                    )
                  })
                )}
              </section>
            )
          })}
      </div>
    </>
  )
}
