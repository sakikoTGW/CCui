import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { idb } from '../../data/idb'
import { toast } from '../../shell/store-bridge'
import { confirmPopover, hostStudio } from '../../shell/host'
import { bus } from '../../shell/bus'

interface Convo {
  id: string
  title?: string
  updatedAt: number
  model?: string
  archived?: boolean
  deletedAt?: number | null
  items?: Array<{ t: string; text?: string; sdk?: unknown }>
  branches?: unknown[]
  checkpoints?: unknown[]
  [k: string]: unknown
}
type Tab = 'active' | 'archived' | 'trash'
interface Filter { q: string; from: string; to: string; model: string; tab: Tab }

function extractMsgText(sdk: unknown): string {
  const content = (sdk as { message?: { content?: unknown } })?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((b: { type?: string; text?: string; thinking?: string; name?: string }) => {
      if (!b) return ''
      if (b.type === 'text') return b.text || ''
      if (b.type === 'thinking') return b.thinking || ''
      if (b.type === 'tool_use') return `[工具 ${b.name}]`
      return ''
    })
    .join('\n')
}

function fullText(c: Convo): string {
  let s = c.title || ''
  for (const it of c.items || []) {
    if (it.t === 'user') s += '\n' + (it.text ?? '')
    else if (it.t === 'msg') s += '\n' + extractMsgText(it.sdk)
  }
  return s.toLowerCase()
}

function convoToMarkdown(c: Convo): string {
  let md = `# ${c.title || '未命名会话'}\n\n`
  md += `> 更新于 ${new Date(c.updatedAt).toLocaleString()}${c.model ? ' · 模型 ' + c.model : ''}\n\n`
  for (const it of c.items || []) {
    if (it.t === 'user') md += `## 用户\n\n${it.text ?? ''}\n\n`
    else if (it.t === 'msg') {
      const sdk = it.sdk as { type?: string; message?: { content?: unknown } }
      const content = sdk?.message?.content
      if (!Array.isArray(content)) continue
      if (sdk.type === 'assistant') {
        let body = ''
        for (const b of content as Array<{ type?: string; text?: string; thinking?: string; name?: string; input?: unknown }>) {
          if (!b) continue
          if (b.type === 'text') body += (b.text || '') + '\n\n'
          else if (b.type === 'thinking') body += `<details><summary>思考</summary>\n\n${b.thinking || ''}\n\n</details>\n\n`
          else if (b.type === 'tool_use') body += `\`\`\`\n[工具] ${b.name} ${JSON.stringify(b.input || {})}\n\`\`\`\n\n`
        }
        if (body.trim()) md += `## 助手\n\n${body}`
      }
    }
  }
  return md
}

function downloadBlob(content: string, name: string, type: string) {
  const blob = new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function downloadMarkdown(convos: Convo[]) {
  if (!convos.length) return
  if (convos.length === 1) downloadBlob(convoToMarkdown(convos[0]), `${(convos[0].title || 'convo').slice(0, 24)}.md`, 'text/markdown')
  else downloadBlob(convos.map(convoToMarkdown).join('\n\n---\n\n'), `ccui-export-${convos.length}.md`, 'text/markdown')
}

export function StudioView() {
  const [all, setAll] = useState<Convo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>({ q: '', from: '', to: '', model: '', tab: 'active' })
  const [branchConvo, setBranchConvo] = useState<Convo | null>(null)
  const purgeBtn = useRef<HTMLButtonElement>(null)

  const load = async () => {
    const list = await idb.getAll<Convo>('conversations').catch(() => [] as Convo[])
    setAll(list)
    setSelected(new Set())
  }
  useEffect(() => {
    load()
  }, [])

  const inTab = (c: Convo) => {
    if (c.deletedAt) return filter.tab === 'trash'
    if (c.archived) return filter.tab === 'archived'
    return filter.tab === 'active'
  }
  const matches = (c: Convo) => {
    if (!inTab(c)) return false
    if (filter.q && !fullText(c).includes(filter.q.toLowerCase())) return false
    if (filter.from && c.updatedAt < new Date(filter.from).getTime()) return false
    if (filter.to && c.updatedAt > new Date(filter.to).getTime() + 86400000) return false
    if (filter.model && !(c.model || '').toLowerCase().includes(filter.model.toLowerCase())) return false
    return true
  }
  const rows = all.filter(matches).sort((a, b) => b.updatedAt - a.updatedAt)

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const bulkSet = async (patch: Partial<Convo>) => {
    if (!selected.size) return
    for (const id of selected) {
      const c = all.find((x) => x.id === id)
      if (!c) continue
      Object.assign(c, patch)
      await idb.put('conversations', c as never)
    }
    toast('已更新', { type: 'success' })
    await load()
  }
  const onPurge = () => {
    if (!selected.size) return
    confirmPopover(purgeBtn.current, `彻底删除 ${selected.size} 个会话？不可恢复`, async () => {
      for (const id of selected) await idb.delete('conversations', id)
      toast('已彻底删除', { type: 'success' })
      await load()
    })
  }

  const exportSelectedMarkdown = () => {
    if (!selected.size) return toast('请先勾选会话', { type: 'warn' })
    const convos = all.filter((c) => selected.has(c.id))
    downloadMarkdown(convos)
    toast(`已导出 ${convos.length} 个会话`, { type: 'success' })
  }
  const exportSelectedPdf = async () => {
    if (!selected.size) return toast('请先勾选会话', { type: 'warn' })
    const convos = all.filter((c) => selected.has(c.id))
    const html = await marked.parse(convos.map(convoToMarkdown).join('\n\n---\n\n'))
    try {
      const r = (await window.ccui.exportPdf(html, `ccui-${convos.length}`)) as { ok?: boolean; path?: string }
      if (r.ok) toast(`PDF 已保存：${r.path}`, { type: 'success' })
      else toast('已取消导出', { type: 'info' })
    } catch (e) {
      toast(`PDF 导出失败：${(e as Error).message}`, { type: 'error' })
    }
  }
  const exportAllJson = async () => {
    const payload = await hostStudio()?.exportAll()
    downloadBlob(JSON.stringify(payload, null, 2), `ccui-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json')
    toast('已备份全部数据', { type: 'success' })
  }

  const openConvo = (c: Convo) => {
    hostStudio()?.openConversation(c)
    bus.emit('switch-view', 'chat')
  }

  const inTrash = filter.tab === 'trash'
  const TABS: { id: Tab; label: string }[] = [
    { id: 'active', label: '活跃' },
    { id: 'archived', label: '已归档' },
    { id: 'trash', label: '回收站' },
  ]

  return (
    <>
      <div className="view-head">
        <h1>数据工作室</h1>
        <div className="vh-actions">
          <button className="btn-ghost" onClick={exportSelectedMarkdown}>导出所选 Markdown</button>
          <button className="btn-ghost" onClick={exportSelectedPdf}>导出所选 PDF</button>
          <button className="btn-ghost" onClick={exportAllJson}>备份全部 (JSON)</button>
        </div>
      </div>
      <div className="studio-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`st-tab${filter.tab === t.id ? ' active' : ''}`}
            onClick={() => { setFilter((f) => ({ ...f, tab: t.id })); setSelected(new Set()) }}
          >{t.label}</button>
        ))}
      </div>
      <div className="studio-filters">
        <input type="search" placeholder="关键词（标题/正文）" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
        <label>从 <input type="date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} /></label>
        <label>到 <input type="date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} /></label>
        <input type="text" placeholder="模型包含…" value={filter.model} onChange={(e) => setFilter((f) => ({ ...f, model: e.target.value }))} />
        <button className="btn-ghost" onClick={() => setFilter((f) => ({ q: '', from: '', to: '', model: '', tab: f.tab }))}>清空筛选</button>
      </div>
      {selected.size > 0 && (
        <div className="studio-bulk" style={{ display: 'flex' }}>
          <span>已选 {selected.size} 个</span>
          {!inTrash && <button className="btn-ghost" onClick={() => bulkSet({ archived: true, deletedAt: null })}>归档</button>}
          {filter.tab !== 'active' && <button className="btn-ghost" onClick={() => bulkSet({ archived: false, deletedAt: null })}>恢复</button>}
          {!inTrash && <button className="btn-ghost danger" onClick={() => bulkSet({ deletedAt: Date.now() })}>移入回收站</button>}
          {inTrash && <button className="btn-ghost danger" ref={purgeBtn} onClick={onPurge}>彻底删除</button>}
        </div>
      )}
      <div className="studio-list">
        {rows.length === 0 ? (
          <div className="studio-empty">
            <p>没有匹配的会话</p>
            <button className="btn-primary" onClick={() => bus.emit('switch-view', 'chat')}>去对话开始第一条</button>
          </div>
        ) : (
          rows.map((c) => {
            const msgCount = (c.items || []).length
            const brCount = (c.branches || []).length
            const cpCount = (c.checkpoints || []).length
            const meta = `${new Date(c.updatedAt).toLocaleString()} · ${msgCount} 条${brCount ? ` · ${brCount} 分支` : ''}${cpCount ? ` · ${cpCount} 检查点` : ''}${c.model ? ' · ' + c.model : ''}`
            return (
              <div className={`studio-row${selected.has(c.id) ? ' sel' : ''}`} key={c.id} onClick={() => openConvo(c)}>
                <input type="checkbox" className="st-cb" checked={selected.has(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(c.id)} />
                <div className="sr-main">
                  <div className="sr-title">{c.title || '未命名'}</div>
                  <div className="sr-meta">{meta}</div>
                </div>
                <button className="sr-branch" title="查看分支树" onClick={(e) => { e.stopPropagation(); setBranchConvo(c) }}>分支</button>
                <button className="sr-export" title="导出此会话" onClick={(e) => { e.stopPropagation(); downloadMarkdown([c]) }}>↧</button>
              </div>
            )
          })
        )}
      </div>
      {branchConvo && <BranchModal convo={branchConvo} onClose={() => setBranchConvo(null)} onOpen={openConvo} />}
    </>
  )
}

function BranchModal({ convo, onClose, onOpen }: { convo: Convo; onClose: () => void; onOpen: (c: Convo) => void }) {
  const backRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const studio = hostStudio()
    if (svgRef.current && studio) svgRef.current.innerHTML = studio.branchSvg(convo)
    if (treeRef.current && studio) studio.branchTree(treeRef.current, convo)
    let unregister: (() => void) | undefined
    if (backRef.current && studio) unregister = studio.registerOverlay(backRef.current, onClose)
    return () => { unregister?.() }
  }, [convo, onClose])

  return (
    <div className="modal-back" ref={backRef} onClick={(e) => { if (e.target === backRef.current) onClose() }}>
      <div className="modal branch-modal">
        <h2>分支树 · {(convo.title || '未命名').slice(0, 40)}</h2>
        <div className="bm-svg" ref={svgRef} />
        <div className="bm-tree" ref={treeRef} />
        <div className="wl-actions">
          <button className="btn-ghost" onClick={onClose}>关闭</button>
          <button className="btn-primary" onClick={() => { onClose(); onOpen(convo) }}>在对话中打开</button>
        </div>
      </div>
    </div>
  )
}
