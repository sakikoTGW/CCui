import { useCallback, useEffect, useRef, useState } from 'react'
import { daemon } from '../../ipc/client'
import { idb } from '../../data/idb'
import { projects, projectDisplayName, type ProjectsState, type ProjectEntry } from '../../data/projects'
import { toast } from '../../shell/store-bridge'

const RUNTIME_LABEL: Record<string, string> = {
  ccui: 'CCui 原生',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  cursor: 'Cursor',
  astrbot: 'AstrBot',
}

const STARTERS = [
  { label: '熟悉项目', prompt: '快速浏览这个仓库：入口在哪、主要模块怎么分、我该从哪读起？' },
  { label: '查 bug', prompt: '帮我排查一个 bug。我会描述现象，你先列出可能原因和要看的文件。' },
  { label: '写测试', prompt: '为指定文件补充单元测试，先说明测什么、怎么 mock。' },
  { label: '审查改动', prompt: '审查当前 git 改动的风险点、遗漏测试和可改进处。' },
]

interface ConvoRow {
  id: string
  title?: string
  updatedAt?: number
  items?: Array<{ t: string; text?: string }>
  archived?: boolean
  deletedAt?: number | null
  kind?: string
}

function convoTitle(c: ConvoRow): string {
  if (c.title && c.title !== '新对话') return c.title
  const first = c.items?.find(i => i.t === 'user')
  const t = first?.text?.trim()
  if (t) return t.length > 56 ? `${t.slice(0, 56)}…` : t
  return '未命名对话'
}

function fmtTime(ts?: number): string {
  if (!ts) return ''
  const d = Date.now() - ts
  if (d < 60_000) return '刚刚'
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`
  if (d < 604800_000) return `${Math.floor(d / 86400_000)} 天前`
  return new Date(ts).toLocaleDateString()
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
}

type EnterPayload = { newConvo?: boolean; prompt?: string; convoId?: string }
function enterWorkspace(payload: EnterPayload = {}) {
  window.ccui?.enterWorkspace?.(payload)
}

export function LauncherApp() {
  const [state, setState] = useState<ProjectsState | null>(null)
  const [active, setActive] = useState<{ name: string; runtime: string; intercept?: boolean } | null>(null)
  const [convos, setConvos] = useState<ConvoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [st, instResp, convoList] = await Promise.all([
        projects.getState(),
        daemon.request<{
          instances?: { id: string; name: string; runtime: string; intercept?: { enabled?: boolean } }[]
          activeId?: string | null
        }>({ cmd: 'instanceList' }, 15_000).catch(() => ({ instances: [], activeId: null })),
        idb.getAll<ConvoRow>('conversations').catch(() => [] as ConvoRow[]),
      ])
      setState(st)
      const inst = instResp.instances?.find(i => i.id === instResp.activeId)
      setActive(inst ? { name: inst.name, runtime: inst.runtime, intercept: inst.intercept?.enabled } : null)
      setConvos(
        convoList
          .filter(c => !c.deletedAt && !c.archived && c.kind !== 'compare')
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, 6),
      )
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  const submit = (text?: string) => {
    const q = (text ?? draft).trim()
    if (!q) return
    enterWorkspace({ prompt: q, send: true })
    setDraft('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const canSend = draft.trim().length > 0

  const openFolder = async () => {
    const r = await projects.pickAndOpen()
    if (r?.ok && r.path) {
      await loadAll()
      toast('已打开项目', { type: 'success' })
    }
  }

  const switchProject = async (p: string) => {
    try {
      const r = await projects.switch(p)
      if (!r?.ok) throw new Error(r?.error || '切换失败')
      await loadAll()
      toast(`已切换到 ${r.name || projectDisplayName({ path: p })}`, { type: 'success' })
    } catch (e) {
      toast(`切换失败：${(e as Error).message}`, { type: 'error' })
    }
  }

  if (!state) {
    return <div className="hp-loading">读取工作区…</div>
  }

  const current: ProjectEntry =
    state.recent?.find(r => r.path === state.current) ?? { path: state.current, name: projectDisplayName({ path: state.current }) }
  const displayName = current.name || projectDisplayName(current)
  const recentProjects = (state.recent ?? []).slice(0, 8)
  const runtimeLabel = active ? (RUNTIME_LABEL[active.runtime] || active.runtime) : null

  return (
    <div className="hp">
      <header className="hp-top">
        <div className="hp-brand">
          <span className="hp-mark" aria-hidden="true">◇</span>
          <span className="hp-brand-text">CCui</span>
        </div>
        <div className="hp-top-actions">
          <button type="button" className="hp-btn-text" onClick={() => void loadAll()} disabled={loading}>刷新</button>
          <button type="button" className="hp-btn-outline" onClick={() => void openFolder()}>打开项目</button>
        </div>
      </header>

      <main className="hp-main">
        <div className="hp-hero">
          <h1 className="hp-greet">{greeting()}，今天要做什么？</h1>

          <div className="hp-composer">
            <div className="hp-composer-inner">
              <div className="hp-composer-meta">
                <button
                  type="button"
                  className="hp-meta-link"
                  onClick={() => window.ccui?.openHarnessWindow?.()}
                  title="Harness：选 harness、管 instance、装 pack"
                >
                  {loading ? '…' : active?.name || '选 instance'}
                </button>
                {runtimeLabel && (
                  <span className="hp-meta-tag">{runtimeLabel}{active?.intercept ? ' · 瓶口' : ''}</span>
                )}
                <span className="hp-meta-sep" aria-hidden="true">·</span>
                <button type="button" className="hp-meta-link" onClick={() => void openFolder()} title={current.path}>
                  {displayName}
                </button>
              </div>
              <div className="hp-composer-row">
                <textarea
                  ref={inputRef}
                  className="hp-input"
                  rows={2}
                  placeholder="输入任务，Enter 发送…"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                />
              <button
                type="button"
                className="hp-send"
                aria-label="发送并进入对话"
                disabled={!canSend}
                onClick={() => submit()}
              >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="hp-starters">
              {STARTERS.map(s => (
                <button type="button" className="hp-chip" key={s.label} onClick={() => submit(s.prompt)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {convos.length > 0 && (
          <section className="hp-section">
            <div className="hp-section-head">
              <h2>最近对话</h2>
              <button type="button" className="hp-btn-text" onClick={() => enterWorkspace({})}>全部 →</button>
            </div>
            <ul className="hp-convo-list">
              {convos.map(c => (
                <li key={c.id}>
                  <button type="button" className="hp-convo-row" onClick={() => enterWorkspace({ convoId: c.id })}>
                    <span className="hp-convo-title">{convoTitle(c)}</span>
                    <span className="hp-convo-time">{fmtTime(c.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="hp-section">
          <div className="hp-section-head">
            <h2>最近项目</h2>
            <button type="button" className="hp-btn-text" onClick={() => void openFolder()}>打开文件夹…</button>
          </div>
          {recentProjects.length === 0 ? (
            <p className="hp-empty">还没有项目。<button type="button" className="hp-btn-text" onClick={() => void openFolder()}>打开一个文件夹</button></p>
          ) : (
            <div className="hp-proj-grid">
              {recentProjects.map(p => {
                const name = p.name || projectDisplayName(p)
                const isCurrent = p.path === state.current
                return (
                  <button
                    type="button"
                    key={p.path}
                    className={`hp-proj-card${isCurrent ? ' is-current' : ''}`}
                    onClick={() => (isCurrent ? enterWorkspace({}) : void switchProject(p.path))}
                  >
                    <span className="hp-proj-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 7a2 2 0 012-2h5l2 2h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="hp-proj-name">{name}</span>
                    <span className="hp-proj-path" title={p.path}>{p.path}</span>
                    {p.lastOpened ? <span className="hp-proj-time">{fmtTime(p.lastOpened)}</span> : null}
                    {isCurrent ? <span className="hp-proj-badge">当前</span> : null}
                  </button>
                )
              })}
            </div>
          )}
        </section>

      </main>
    </div>
  )
}
