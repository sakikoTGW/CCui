import { useEffect, useState } from 'react'
import { daemon } from '../../ipc/client'
import { toast } from '../../shell/store-bridge'
import {
  projects,
  projectDisplayName,
  type ProjectsState,
  type ProjectEntry,
  type ProjectInfo,
} from '../../data/projects'
import { bus } from '../../shell/bus'

const ICON_STROKE = { stroke: 'currentColor', strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" {...ICON_STROKE}>
      <path d="M3 6h6l2 2h10v11H3V6z" />
    </svg>
  )
}
function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" {...ICON_STROKE}>
      <path d="M4 12a8 8 0 0 1 13-6M20 12a8 8 0 0 1-13 6" />
      <path d="M17 3v4h-4M7 21v-4h4" />
    </svg>
  )
}

function fmtTime(ts?: number): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return new Date(ts).toLocaleDateString()
}

function switchView(view: string) {
  bus.emit('switch-view', view)
}

function infoChips(info: ProjectInfo): string[] {
  const g = info.graphStats
  return [
    g ? `${g.files} 文件 · ${g.dirs} 目录` : null,
    info.skills != null ? `${info.skills} Skills` : null,
    info.agents != null ? `${info.agents} Agents` : null,
    info.rules != null ? `${info.rules} Rules` : null,
    info.mcp != null ? `${info.mcp} MCP` : null,
    info.gitBranch ? `分支 ${info.gitBranch}` : null,
    info.hasClaudeMd ? 'CLAUDE.md' : null,
    info.hasEnv ? '.env' : null,
  ].filter((s): s is string => Boolean(s))
}

export function ProjectsView() {
  const [state, setState] = useState<ProjectsState | null>(null)
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')

  const refresh = async () => {
    setPhase('loading')
    try {
      const st = await projects.getState()
      setState(st)
      const res = await daemon.request<{ info?: ProjectInfo }>({ cmd: 'getProjectInfo' }, 30000)
      setInfo(res.info ?? null)
      setPhase('ok')
    } catch (e) {
      setErrMsg((e as Error).message)
      setPhase('error')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const doSwitch = async (projectPath: string) => {
    if (!state || projectPath === state.current) return
    try {
      toast('正在切换项目…', { type: 'info' })
      const r = await projects.switch(projectPath)
      if (!r?.ok) throw new Error(r?.error || '切换失败')
      bus.emit('project-changed', r)
      await refresh()
      toast(`已切换到 ${r.name || projectDisplayName(r)}`, { type: 'success' })
    } catch (e) {
      toast(`切换失败：${(e as Error).message}`, { type: 'error' })
    }
  }

  if (phase === 'loading') return <div className="proj-loading">加载项目…</div>
  if (phase === 'error') return <div className="proj-error">加载失败：{errMsg}</div>
  if (!state) return null

  const current: ProjectEntry =
    state.recent?.find((r) => r.path === state.current) ?? {
      path: state.current,
      name: projectDisplayName({ path: state.current }),
    }
  const others = (state.recent ?? []).filter((r) => r.path !== state.current)
  const all: ProjectEntry[] = [current, ...others]

  const onPin = async (p: ProjectEntry) => {
    await projects.pin(p.path, !p.pinned)
    await refresh()
    toast(p.pinned ? '已取消固定' : '已固定', { type: 'success' })
  }
  const onRemove = async (p: ProjectEntry) => {
    if (p.path === state.current) {
      toast('不能移除当前工作区，请先切换其他项目', { type: 'warn' })
      return
    }
    await projects.remove(p.path)
    await refresh()
    toast('已从列表移除', { type: 'info' })
  }
  const onOpenFolder = async () => {
    const r = await projects.pickAndOpen()
    if (r?.ok && r.path) doSwitch(r.path)
  }

  return (
    <>
      <div className="view-head">
        <h1>项目</h1>
        <div className="vh-actions">
          <button className="btn-ghost" onClick={refresh}><RefreshIcon /> 刷新</button>
          <button className="btn-primary" onClick={onOpenFolder}>打开文件夹…</button>
        </div>
      </div>
      <p className="proj-hint">管理本地工作区，类似 Cursor / Codex 的项目列表。切换项目会重启 Agent 引擎并刷新文件树。</p>

      <section className="proj-current">
        <div className="proj-current-badge">当前工作区</div>
        <div className="proj-current-body">
          <div className="proj-current-icon"><FolderIcon /></div>
          <div className="proj-current-meta">
            <div className="proj-current-name">{current.name || projectDisplayName(current)}</div>
            <div className="proj-current-path" title={current.path}>{current.path}</div>
            <div className="proj-current-stats">
              {info ? (
                infoChips(info).map((s) => <span className="proj-chip" key={s}>{s}</span>)
              ) : (
                '扫描项目信息中…'
              )}
            </div>
          </div>
          <div className="proj-current-actions">
            <button className="btn-primary" onClick={() => switchView('chat')}>开始对话</button>
            <button className="btn-ghost" onClick={() => projects.openInExplorer(state.current)}>在资源管理器中打开</button>
            <button className="btn-ghost" onClick={() => switchView('map')}>结构图</button>
            <button className="btn-ghost" onClick={() => switchView('console')}>控制台</button>
          </div>
        </div>
      </section>

      <section className="proj-section">
        <div className="proj-section-head">
          <h2>最近打开</h2>
          <span className="proj-section-sub">{others.length + 1} 个工作区</span>
        </div>
        <div className="proj-grid">
          {all.length === 0 ? (
            <div className="proj-empty">尚无项目记录，点击「打开文件夹」添加</div>
          ) : (
            all.map((p) => {
              const isCurrent = p.path === state.current
              return (
                <div
                  className={`proj-card${isCurrent ? ' active' : ''}`}
                  key={p.path}
                  onClick={() => { if (!isCurrent) doSwitch(p.path) }}
                >
                  <div className="proj-card-top">
                    <span className="proj-card-icon"><FolderIcon /></span>
                    <button
                      className={`proj-pin${p.pinned ? ' on' : ''}`}
                      title={p.pinned ? '取消固定' : '固定'}
                      onClick={(e) => { e.stopPropagation(); onPin(p) }}
                    >★</button>
                  </div>
                  <div className="proj-card-name">{p.name || projectDisplayName(p)}</div>
                  <div className="proj-card-path" title={p.path}>{p.path}</div>
                  <div className="proj-card-foot">
                    <span>{fmtTime(p.lastOpened)}</span>
                    {isCurrent && <span className="proj-active-tag">当前</span>}
                  </div>
                  <div className="proj-card-actions">
                    <button
                      className="btn-ghost proj-switch"
                      disabled={isCurrent}
                      onClick={(e) => { e.stopPropagation(); doSwitch(p.path) }}
                    >{isCurrent ? '当前' : '切换'}</button>
                    <button
                      className="btn-ghost proj-remove"
                      title="从列表移除"
                      onClick={(e) => { e.stopPropagation(); onRemove(p) }}
                    >移除</button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </>
  )
}
