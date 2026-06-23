import { useEffect, useState } from 'react'
import { daemon } from '../../ipc/client'
import { idb } from '../../data/idb'
import { toast } from '../../shell/store-bridge'
import {
  projects,
  projectDisplayName,
  type ProjectsState,
  type ProjectEntry,
  type ProjectInfo,
} from '../../data/projects'
import { bus } from '../../shell/bus'
import { hostStudio } from '../../shell/host'
import { useCcuiStore } from '../../shell/store'

const ICON_STROKE = { stroke: 'currentColor', strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const STARTERS = [
  { label: '熟悉项目', prompt: '快速浏览这个仓库：入口在哪、主要模块怎么分、我该从哪读起？' },
  { label: '查 bug', prompt: '帮我排查一个 bug。我会描述现象，你先列出可能原因和要看的文件。' },
  { label: '写测试', prompt: '为指定文件补充单元测试，先说明测什么、怎么 mock。' },
  { label: '审查改动', prompt: '审查当前 git 改动的风险点、遗漏测试和可改进处。' },
]

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
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" {...ICON_STROKE}>
      <path d="M12 5v14M5 12h14" />
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

function reviewBridge() {
  return (globalThis as { ccuiReview?: { getAll?: () => ReviewItem[] } }).ccuiReview
}

interface ReviewItem {
  id: string
  kind: 'permission' | 'diff'
  toolName?: string
  message?: string
  path?: string
}

interface ConvoRow {
  id: string
  title?: string
  updatedAt: number
  model?: string
  items?: Array<{ t: string; text?: string; sdk?: unknown }>
  archived?: boolean
  deletedAt?: number | null
  kind?: string
  [k: string]: unknown
}

interface TemplateRow {
  id: string
  name: string
  body?: string
  [k: string]: unknown
}

interface ResourceItem {
  id: string
  kind: 'skill' | 'agent' | 'rule' | 'mcp'
  name: string
  description?: string
}

function convoTitle(c: ConvoRow): string {
  if (c.title && c.title !== '新对话') return c.title
  const first = c.items?.find((i) => i.t === 'user')
  const t = first?.text?.trim()
  if (t) return t.length > 48 ? `${t.slice(0, 48)}…` : t
  return '未命名对话'
}

function convoPreview(c: ConvoRow): string {
  const items = c.items || []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.t === 'user' && it.text?.trim()) {
      const t = it.text.trim()
      return t.length > 72 ? `${t.slice(0, 72)}…` : t
    }
    if (it.t === 'msg') {
      const content = (it.sdk as { message?: { content?: unknown } })?.message?.content
      if (Array.isArray(content)) {
        const text = content
          .map((b: { type?: string; text?: string }) => (b?.type === 'text' ? b.text || '' : ''))
          .join('')
          .trim()
        if (text) return text.length > 72 ? `${text.slice(0, 72)}…` : text
      }
    }
  }
  return '尚无消息'
}

function msgCount(c: ConvoRow): number {
  return (c.items || []).filter((i) => i.t === 'user' || i.t === 'msg').length
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

/**
 * 主页 hero：选 instance × project，进对话。
 */
function LaunchStage({
  projectName,
  projectPath,
  lastConvoTitle,
  onContinue,
  onNew,
  onOpenFolder,
  onRefresh,
  onOpenHarness,
}: {
  projectName: string
  projectPath: string
  lastConvoTitle: string
  onContinue: () => void
  onNew: () => void
  onOpenFolder: () => void
  onRefresh: () => void
  onOpenHarness: () => void
}) {
  const [active, setActive] = useState<{ name: string; runtime: string; intercept?: boolean } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await daemon.request<{
          instances?: { id: string; name: string; runtime: string; intercept?: { enabled?: boolean } }[]
          activeId?: string | null
        }>({ cmd: 'instanceList' }, 15_000)
        if (!alive) return
        const inst = r.instances?.find(i => i.id === r.activeId)
        setActive(inst ? { name: inst.name, runtime: inst.runtime, intercept: inst.intercept?.enabled } : null)
      } catch { /* 摘要失败不阻塞主页 */ }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [])

  return (
    <section className="launch" aria-label="主页">
      <div className="launch-bar">
        <div className="launch-id">
          <p className="launch-kicker">CCui 控制面 · 此刻在跑的 Agent</p>
          <h1 className="launch-project">{projectName}</h1>
          <p className="launch-path" title={projectPath}>{projectPath}</p>
        </div>
        <div className="launch-tools">
          <button type="button" className="btn-icon" title="刷新" aria-label="刷新" onClick={onRefresh}><RefreshIcon /></button>
          <button type="button" className="btn-ghost" onClick={onOpenFolder}><FolderIcon /> 切换项目</button>
        </div>
      </div>

      <div className="launch-rig">
        <button type="button" className="rig-cell rig-act" onClick={onOpenHarness} title="打开 Harness 窗口：装配运行时与实例">
          <span className="rig-cap">实例 · Harness 装配</span>
          <span className="rig-name">{loading ? '…' : active ? active.name : '未启动实例'}</span>
          <span className="rig-sub">
            {loading ? '\u00a0' : active
              ? `${RUNTIME_LABEL[active.runtime] || active.runtime}${active.intercept ? ' · 瓶口接管' : ''}`
              : '点此配置运行时 →'}
          </span>
        </button>
        <span className="rig-op" aria-hidden="true">×</span>
        <div className="rig-cell">
          <span className="rig-cap">项目 · 工作对象</span>
          <span className="rig-name">{projectName}</span>
          <span className="rig-sub">{loading ? '\u00a0' : '当前工作区代码与心智'}</span>
        </div>
      </div>

      <div className="launch-go">
        <button type="button" className="btn-primary launch-cta" onClick={onContinue}>
          {lastConvoTitle ? `进入工作区 · 继续「${lastConvoTitle}」` : '进入工作区 · 开始第一条对话'}
        </button>
        <button type="button" className="btn-ghost launch-new" onClick={onNew}><PlusIcon /> 新对话</button>
      </div>
    </section>
  )
}

function ChipGroups({ info, onCapClick }: { info: ProjectInfo | null; onCapClick: () => void }) {
  if (!info) return <p className="proj-scanning">扫描项目信息中…</p>

  const g = info.graphStats
  const caps: { label: string; key: string }[] = []
  if (info.skills != null) caps.push({ label: `${info.skills} Skills`, key: 'skills' })
  if (info.agents != null) caps.push({ label: `${info.agents} Agents`, key: 'agents' })
  if (info.rules != null) caps.push({ label: `${info.rules} Rules`, key: 'rules' })
  if (info.mcp != null) caps.push({ label: `${info.mcp} MCP`, key: 'mcp' })

  const meta: string[] = []
  if (info.gitBranch) meta.push(`分支 ${info.gitBranch}`)
  if (info.hasClaudeMd) meta.push('CLAUDE.md')
  if (info.hasEnv) meta.push('.env')

  return (
    <div className="proj-chip-groups">
      {g && (
        <div className="proj-chip-row">
          <span className="proj-chip-label">体量</span>
          <span className="proj-chip stat">{g.files} 文件</span>
          <span className="proj-chip stat">{g.dirs} 目录</span>
        </div>
      )}
      {caps.length > 0 && (
        <div className="proj-chip-row">
          <span className="proj-chip-label">装备</span>
          {caps.map((c) => (
            <button type="button" className="proj-chip cap" key={c.key} onClick={onCapClick}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {meta.length > 0 && (
        <div className="proj-chip-row">
          <span className="proj-chip-label">配置</span>
          {meta.map((m) => (
            <span className="proj-chip meta" key={m}>{m}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPanel() {
  const daemonStatus = useCcuiStore((s) => s.daemonStatus)
  const model = useCcuiStore((s) => s.model)
  const busy = useCcuiStore((s) => s.busy)
  const cost = useCcuiStore((s) => s.totalCost)
  const presetId = useCcuiStore((s) => s.activePresetId)
  const presets = useCcuiStore((s) => s.presets)
  const presetName = presets.find((p) => p.id === presetId)?.name || '默认'

  const engineLabel =
    daemonStatus === 'ready' ? (busy ? '执行中' : '已就绪') :
    daemonStatus === 'starting' ? '启动中' : '未连接'
  const engineClass =
    daemonStatus === 'ready' ? (busy ? 'busy' : 'ok') :
    daemonStatus === 'starting' ? 'warn' : 'err'

  return (
    <aside className="proj-status-card" aria-label="运行状态">
      <h3 className="proj-panel-title">运行状态</h3>
      <dl className="proj-status-list">
        <div className="proj-status-row">
          <dt>引擎</dt>
          <dd><span className={`proj-status-dot ${engineClass}`} />{engineLabel}</dd>
        </div>
        <div className="proj-status-row">
          <dt>模型</dt>
          <dd className="mono">{model || '—'}</dd>
        </div>
        <div className="proj-status-row">
          <dt>预设</dt>
          <dd>{presetName}</dd>
        </div>
        <div className="proj-status-row">
          <dt>本会话费用</dt>
          <dd className="mono">${(cost || 0).toFixed(4)}</dd>
        </div>
      </dl>
      <button type="button" className="btn-ghost sm proj-status-link" onClick={() => switchView('settings')}>
        连接与模型设置 →
      </button>
    </aside>
  )
}

function ProjectsSkeleton() {
  return (
    <div className="proj-page proj-skel" aria-hidden="true">
      <div className="proj-hero-head">
        <div>
          <div className="sk sk-kicker" />
          <div className="sk sk-hero-name" />
          <div className="sk sk-path" />
        </div>
        <div className="sk sk-icon-btn" />
      </div>
      <div className="proj-dash">
        <div className="sk sk-hero-card" />
        <div className="sk sk-status-card" />
      </div>
      <div className="sk sk-panel" />
      <div className="sk sk-panel" />
    </div>
  )
}

interface StructGraph { stats?: { files: number; dirs: number; importEdges: number }; summary?: string; scannedAt?: number }

export function ProjectsView() {
  const [state, setState] = useState<ProjectsState | null>(null)
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [struct, setStruct] = useState<StructGraph | null>(null)
  const [structPhase, setStructPhase] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [convos, setConvos] = useState<ConvoRow[]>([])
  const [resources, setResources] = useState<ResourceItem[]>([])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [reviews, setReviews] = useState<ReviewItem[]>([])

  useEffect(() => {
    setReviews(reviewBridge()?.getAll?.() ?? [])
    return bus.on('review-queue', (list) => setReviews((list as ReviewItem[]) ?? []))
  }, [])

  const openConvo = (c: ConvoRow) => {
    switchView('chat')
    hostStudio()?.openConversation(c)
  }

  const newConvo = () => {
    switchView('chat')
    bus.emit('new-convo')
  }

  const runStarter = (prompt: string) => {
    switchView('chat')
    bus.emit('insert-prompt', prompt)
  }

  const loadStructure = async (refresh: boolean) => {
    setStructPhase('loading')
    try {
      const r = await daemon.request<{ graph?: StructGraph }>({ cmd: 'projectGraph', refresh }, 120000)
      setStruct(r.graph ?? null)
      setStructPhase('ok')
      if (refresh) toast('项目结构已更新', { type: 'success' })
    } catch {
      setStructPhase('error')
    }
  }

  const sendStructToAgent = () => {
    if (!struct?.summary) return
    switchView('chat')
    bus.emit('insert-prompt', `请先阅读以下项目结构，再回答我后续的问题：\n\n${struct.summary}\n\n---\n\n`)
    toast('已切到对话并插入项目结构', { type: 'info' })
  }

  const copyStruct = () => {
    if (!struct?.summary) return
    navigator.clipboard?.writeText(struct.summary).then(() => toast('已复制结构摘要', { type: 'success' }), () => {})
  }

  const refresh = async () => {
    setPhase('loading')
    try {
      const [st, convoList, tplList, infoResp, resResp] = await Promise.all([
        projects.getState(),
        idb.getAll<ConvoRow>('conversations').catch(() => [] as ConvoRow[]),
        idb.getAll<TemplateRow>('templates').catch(() => [] as TemplateRow[]),
        daemon.request<{ info?: ProjectInfo }>({ cmd: 'getProjectInfo' }, 30000),
        daemon.request<{ items?: ResourceItem[] }>({ cmd: 'listResources' }, 20000).catch(() => ({ items: [] })),
      ])
      setState(st)
      setInfo(infoResp.info ?? null)
      const activeConvos = convoList
        .filter((c) => !c.deletedAt && !c.archived && c.kind !== 'compare')
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      setConvos(activeConvos)
      setTemplates(tplList.slice(0, 6))
      setResources((resResp.items ?? []).slice(0, 8))
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

  if (phase === 'loading') return <ProjectsSkeleton />
  if (phase === 'error') return <div className="proj-error">加载失败：{errMsg}</div>
  if (!state) return null

  const current: ProjectEntry =
    state.recent?.find((r) => r.path === state.current) ?? {
      path: state.current,
      name: projectDisplayName({ path: state.current }),
    }
  const others = (state.recent ?? []).filter((r) => r.path !== state.current)
  const displayName = current.name || projectDisplayName(current)
  const recentConvos = convos.slice(0, 8)
  const lastConvo = recentConvos[0]

  const onPin = async (p: ProjectEntry) => {
    await projects.pin(p.path, !p.pinned)
    await refresh()
    toast(p.pinned ? '已取消固定' : '已固定', { type: 'success' })
  }
  const onRemove = async (p: ProjectEntry) => {
    await projects.remove(p.path)
    await refresh()
    toast('已从列表移除', { type: 'info' })
  }
  const onOpenFolder = async () => {
    const r = await projects.pickAndOpen()
    if (r?.ok && r.path) doSwitch(r.path)
  }

  // 项目存档（project profile）：一键复刻 agent 对本项目的理解与目标
  const exportProfile = async () => {
    try {
      const r = await daemon.request<{ path?: string; files?: number; stats?: Record<string, unknown> }>({ cmd: 'profileExport' }, 60_000)
      toast(`已导出项目存档（${r.files ?? 0} 个文件）：${r.path ?? ''}`, { type: 'success' })
    } catch (e) {
      toast(`导出存档失败：${(e as Error).message}`, { type: 'error' })
    }
  }

  const importProfile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.profile.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const profile = JSON.parse(await file.text()) as Record<string, unknown>
        const r = await daemon.request<{ report?: { restored: string[]; skipped: string[] } }>(
          { cmd: 'profileImport', profile, overwrite: false }, 60_000,
        )
        const n = r.report?.restored.length ?? 0
        toast(`已导入项目存档：还原 ${n} 项${r.report?.skipped.length ? `，跳过 ${r.report.skipped.length}（已存在）` : ''}`, { type: 'success' })
        refresh()
      } catch (e) {
        toast(`导入存档失败：${(e as Error).message}`, { type: 'error' })
      }
    }
    input.click()
  }

  const kindLabel: Record<string, string> = { skill: 'Skill', agent: 'Agent', rule: 'Rule', mcp: 'MCP' }

  return (
    <div className="home">
      <LaunchStage
        projectName={displayName}
        projectPath={current.path}
        lastConvoTitle={lastConvo ? convoTitle(lastConvo) : ''}
        onContinue={() => (lastConvo ? openConvo(lastConvo) : newConvo())}
        onNew={newConvo}
        onOpenFolder={onOpenFolder}
        onRefresh={refresh}
        onOpenHarness={() => window.ccui?.openHarnessWindow?.()}
      />

      <div className="home-grid">
        <section className="proj-panel home-overview" aria-label="项目概览">
          <div className="proj-panel-head">
            <h2>项目概览</h2>
            <button type="button" className="btn-ghost sm proj-panel-link" onClick={() => projects.openInExplorer(state.current)}>资源管理器</button>
          </div>
          <ChipGroups info={info} onCapClick={() => window.ccui?.openHarnessWindow?.()} />
        </section>

        <StatusPanel />

      {reviews.length > 0 && (
        <section className="proj-panel proj-review-panel" aria-label="待审查">
          <div className="proj-panel-head">
            <h2>待你批准</h2>
            <span className="proj-panel-badge warn">{reviews.length}</span>
            <button type="button" className="btn-ghost sm proj-panel-link" onClick={() => switchView('review')}>全部审查 →</button>
          </div>
          <ul className="proj-review-list">
            {reviews.slice(0, 4).map((r) => (
              <li key={r.id}>
                <button type="button" className="proj-review-row" onClick={() => switchView('review')}>
                  <span className={`proj-review-kind ${r.kind}`}>{r.kind === 'diff' ? '改动' : '权限'}</span>
                  <span className="proj-review-text">
                    {r.kind === 'diff' ? (r.path || r.toolName) : (r.message || r.toolName || '工具请求')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="proj-panel" aria-label="最近对话">
        <div className="proj-panel-head">
          <h2>最近对话</h2>
          <span className="proj-panel-sub">{convos.length ? `${convos.length} 条` : '尚无'}</span>
          <button type="button" className="btn-ghost sm proj-panel-link" onClick={newConvo}>+ 新对话</button>
        </div>
        {recentConvos.length === 0 ? (
          <div className="proj-convo-empty">
            <p>还没有对话记录。选下面一个起手式，或自己输入第一句。</p>
            <div className="proj-starter-chips">
              {STARTERS.map((s) => (
                <button type="button" className="proj-starter-chip" key={s.label} onClick={() => runStarter(s.prompt)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="proj-convo-list">
            {recentConvos.map((c) => (
              <li key={c.id}>
                <button type="button" className="proj-convo-row" onClick={() => openConvo(c)}>
                  <span className="proj-convo-title">{convoTitle(c)}</span>
                  <span className="proj-convo-preview">{convoPreview(c)}</span>
                  <span className="proj-convo-meta">
                    {fmtTime(c.updatedAt)} · {msgCount(c)} 条
                    {c.model ? ` · ${c.model}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="proj-panel" aria-label="快捷起手">
        <div className="proj-panel-head">
          <h2>快捷起手</h2>
          <span className="proj-panel-sub">一点即进对话</span>
        </div>
        <div className="proj-starter-chips">
          {STARTERS.map((s) => (
            <button type="button" className="proj-starter-chip" key={s.label} onClick={() => runStarter(s.prompt)}>
              {s.label}
            </button>
          ))}
          {templates.map((t) => (
            <button
              type="button"
              className="proj-starter-chip tpl"
              key={t.id}
              onClick={() => runStarter(t.body || t.name)}
              title={t.body}
            >
              {t.name}
            </button>
          ))}
        </div>
        <p className="proj-tips">
          <kbd>Ctrl+K</kbd> 命令面板 · <kbd>@</kbd> 引用文件 · 拖拽附件到输入框 · <kbd>Ctrl+Shift+R</kbd> 审查
        </p>
      </section>

      {resources.length > 0 && (
        <section className="proj-panel proj-caps-panel" aria-label="已加载装备">
          <div className="proj-panel-head">
            <h2>已加载装备</h2>
            <button type="button" className="btn-ghost sm proj-panel-link" onClick={() => window.ccui?.openHarnessWindow?.()}>管理 →</button>
          </div>
          <ul className="proj-cap-list">
            {resources.map((r) => (
              <li key={r.id} className="proj-cap-item">
                <span className={`proj-cap-kind ${r.kind}`}>{kindLabel[r.kind] || r.kind}</span>
                <span className="proj-cap-name">{r.name}</span>
                {r.description && <span className="proj-cap-desc">{r.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

        <section className="proj-panel home-mind" aria-label="项目心智">
          <div className="proj-panel-head">
            <h2>项目心智</h2>
            <span className="proj-panel-sub">存档 / 复刻</span>
          </div>
          <p className="home-mind-hint">导出 agent 对本项目的理解与目标；换机或换人导入后，立刻「已经懂这个项目」。</p>
          <div className="home-mind-actions">
            <button type="button" className="btn-ghost sm" onClick={exportProfile}>导出心智存档</button>
            <button type="button" className="btn-ghost sm" onClick={importProfile}>导入心智存档</button>
          </div>
        </section>
      </div>

      <section className="proj-panel proj-workspaces">
        <div className="proj-panel-head">
          <h2>其他工作区</h2>
          <span className="proj-panel-sub">{others.length ? `${others.length} 个` : '暂无'}</span>
        </div>
        {others.length === 0 ? (
          <div className="proj-recent-empty">
            <p>只有当前这一个工作区</p>
            <button type="button" className="btn-ghost sm" onClick={onOpenFolder}>打开另一个文件夹</button>
          </div>
        ) : (
          <ul className="proj-recent-list">
            {others.map((p) => (
              <li key={p.path}>
                <div
                  className="proj-recent-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => doSwitch(p.path)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doSwitch(p.path) }}
                >
                  <span className="proj-recent-icon"><FolderIcon /></span>
                  <div className="proj-recent-meta">
                    <span className="proj-recent-name">{p.name || projectDisplayName(p)}</span>
                    <span className="proj-recent-path" title={p.path}>{p.path}</span>
                  </div>
                  <span className="proj-recent-time">{fmtTime(p.lastOpened)}</span>
                  <button
                    type="button"
                    className={`proj-pin${p.pinned ? ' on' : ''}`}
                    title={p.pinned ? '取消固定' : '固定'}
                    aria-label={p.pinned ? '取消固定' : '固定'}
                    onClick={(e) => { e.stopPropagation(); onPin(p) }}
                  >★</button>
                  <button type="button" className="btn-ghost sm proj-recent-switch" onClick={(e) => { e.stopPropagation(); doSwitch(p.path) }}>切换</button>
                  <button type="button" className="btn-ghost sm danger proj-recent-remove" title="从列表移除" onClick={(e) => { e.stopPropagation(); onRemove(p) }}>移除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="proj-struct-fold">
        <summary onClick={() => { if (structPhase === 'idle') loadStructure(false) }}>
          项目结构 <span className="proj-struct-sub">按需 · 喂给 Agent 的记忆</span>
        </summary>
        <div className="proj-struct">
          {structPhase === 'loading' && <p className="proj-scanning">扫描项目结构中…</p>}
          {structPhase === 'error' && (
            <p className="proj-scanning">扫描失败。<button type="button" className="btn-ghost sm" onClick={() => loadStructure(false)}>重试</button></p>
          )}
          {structPhase === 'ok' && struct && (
            <>
              <div className="proj-chip-row">
                {struct.stats && (
                  <span className="proj-chip stat">
                    {struct.stats.files} 文件 · {struct.stats.dirs} 目录 · {struct.stats.importEdges} import 边
                  </span>
                )}
                {struct.scannedAt && <span className="proj-chip meta">{new Date(struct.scannedAt).toLocaleString()}</span>}
              </div>
              <details className="proj-struct-md">
                <summary>结构摘要（Markdown）</summary>
                <pre>{struct.summary || '（空）'}</pre>
              </details>
              <div className="vh-actions proj-struct-actions">
                <button type="button" className="btn-ghost" onClick={() => loadStructure(true)}>重新扫描</button>
                <button type="button" className="btn-ghost" onClick={copyStruct}>复制</button>
                <button type="button" className="btn-primary" onClick={sendStructToAgent}>发给 Agent</button>
              </div>
            </>
          )}
        </div>
      </details>
    </div>
  )
}
