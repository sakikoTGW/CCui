import { useEffect, useRef, useState } from 'react'
import { daemon } from '../../ipc/client'
import { toast } from '../../shell/store-bridge'
import { bus } from '../../shell/bus'

interface GNode { id: string; kind: string; label: string; path: string }
interface GEdge { from: string; to: string; kind: string }
interface Graph {
  nodes: GNode[]
  edges: GEdge[]
  stats: { files: number; dirs: number; importEdges: number }
  scannedAt: number
  summary: string
}

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
}
function escAttr(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function areaForPath(path: string, areas: GNode[]): string {
  const norm = path.replace(/\\/g, '/')
  for (const a of areas) {
    if (a.label === 'root') continue
    if (norm.includes(`/${a.label}/`) || norm.startsWith(`${a.label}/`)) return a.label
  }
  return 'root'
}

// 纯函数：与原 renderGraph 等价输出，circle 携带 data-path 供委托点击。
function buildSvg(g: Graph, width: number): string {
  const areas = g.nodes.filter((n) => n.kind === 'area')
  const files = g.nodes.filter((n) => n.kind === 'file')
  const importEdges = g.edges.filter((e) => e.kind === 'imports')

  const PAD = 24, ROW_H = 48, ROW_Y0 = 36, FILE_SPACING = 56, FILE_X0 = 140
  const MAX_FILES_PER_AREA = 14, MAX_EDGES = 48
  const W = Math.max(720, width || 720)
  const H = Math.max(300, ROW_Y0 + areas.length * ROW_H + 48)

  const pos = new Map<string, { x: number; y: number; kind: string; node?: GNode }>()
  const areaY = new Map<string, number>()
  areas.forEach((a, i) => {
    const y = ROW_Y0 + i * ROW_H
    areaY.set(a.id, y)
    pos.set(a.id, { x: PAD + 8, y, kind: 'area' })
  })
  const byArea = new Map<string, GNode[]>(areas.map((a) => [a.label, []]))
  for (const f of files) {
    const label = areaForPath(f.path, areas)
    if (!byArea.has(label)) byArea.set(label, [])
    byArea.get(label)!.push(f)
  }
  for (const a of areas) {
    const y = areaY.get(a.id)
    if (y == null) continue
    const list = (byArea.get(a.label) ?? []).slice(0, MAX_FILES_PER_AREA)
    list.forEach((f, j) => pos.set(f.id, { x: FILE_X0 + j * FILE_SPACING, y, kind: 'file', node: f }))
  }

  const svg = [`<svg viewBox="0 0 ${W} ${H}" class="cg-svg" xmlns="http://www.w3.org/2000/svg">`]
  const drawn = new Set<string>()
  let edgeCount = 0
  for (const e of importEdges) {
    if (edgeCount >= MAX_EDGES) break
    const p1 = pos.get(e.from)
    const p2 = pos.get(e.to)
    if (!p1 || !p2 || p1.kind !== 'file' || p2.kind !== 'file') continue
    const key = `${e.from}|${e.to}`
    if (drawn.has(key)) continue
    drawn.add(key)
    edgeCount++
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const cx = (p1.x + p2.x) / 2
    const cy = (p1.y + p2.y) / 2 - (Math.abs(dy) < 2 ? 18 : Math.sign(dy) * 8)
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) continue
    svg.push(`<path d="M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}" fill="none" stroke="#d97757" stroke-width="1.2" opacity="0.45"/>`)
  }
  areas.forEach((a, i) => {
    const y = ROW_Y0 + i * ROW_H
    const count = Math.min((byArea.get(a.label) ?? []).length, MAX_FILES_PER_AREA)
    svg.push(`<rect x="${PAD}" y="${y - 14}" width="${W - PAD * 2}" height="32" rx="8" fill="var(--accent-weak,#f6e6df)" opacity="0.9"/>`)
    svg.push(`<text x="${PAD + 12}" y="${y + 6}" class="cg-t">${esc(a.label)}</text>`)
    if (count > 0) {
      svg.push(`<text x="${W - PAD - 8}" y="${y + 6}" class="cg-t" text-anchor="end" fill="var(--text-3,#888)" font-size="10">${count} files</text>`)
    }
  })
  for (const [, p] of pos) {
    if (p.kind !== 'file' || !p.node) continue
    const short = p.node.label.split('/').pop() || p.node.label
    svg.push(`<circle cx="${p.x}" cy="${p.y}" r="5" fill="#5b8a72" data-path="${escAttr(p.node.path)}" style="cursor:pointer"/>`)
    svg.push(`<title>${esc(p.node.label)}</title>`)
    svg.push(`<text x="${p.x}" y="${p.y + 16}" class="cg-t" text-anchor="middle" font-size="9" fill="var(--text-3,#888)">${esc(short.slice(0, 10))}</text>`)
  }
  svg.push('</svg>')
  return svg.join('')
}

export function ContextMapView() {
  const [graph, setGraph] = useState<Graph | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)

  const load = async (refresh: boolean) => {
    setState('loading')
    try {
      const res = await daemon.request<{ graph?: Graph }>({ cmd: 'projectGraph', refresh }, 120000)
      if (!res.graph) throw new Error('扫描失败')
      setGraph(res.graph)
      setState('ok')
      toast(refresh ? '结构图已更新' : '已加载结构图', { type: 'success' })
    } catch (e) {
      setErrMsg((e as Error).message)
      setState('error')
    }
  }

  useEffect(() => {
    load(false)
  }, [])

  // 重新渲染 SVG（依赖容器宽度）
  useEffect(() => {
    const host = canvasRef.current
    if (!host || !graph) return
    host.innerHTML = buildSvg(graph, host.clientWidth)
  }, [graph])

  const onCanvasClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    const path = t.getAttribute?.('data-path')
    if (path) bus.emit('openfile', { path })
  }

  const copyMd = () => {
    if (!graph?.summary) return
    navigator.clipboard.writeText(graph.summary).then(
      () => toast('已复制结构摘要', { type: 'success' }),
      () => toast('复制失败', { type: 'error' }),
    )
  }
  const sendToAgent = () => {
    if (!graph?.summary) return
    bus.emit('switch-view', 'chat')
    bus.emit('insert-prompt', `请先阅读以下项目结构图，再回答我后续问题：\n\n${graph.summary}\n\n---\n\n`)
    toast('已切到对话并插入结构摘要', { type: 'info' })
  }

  return (
    <>
      <div className="view-head">
        <h1>项目结构图</h1>
        <div className="vh-actions">
          <button className="btn-ghost" onClick={() => load(true)}>重新扫描</button>
          <button className="btn-ghost" onClick={sendToAgent}>发给 Agent</button>
          <button className="btn-primary" onClick={copyMd}>复制 Markdown</button>
        </div>
      </div>
      <p className="cg-hint">
        扫描目录 + import 边，缓存到 <code>.claude/ccui-project-graph.json</code> 供 Agent 记忆。非语义向量层，M4 再加强。
      </p>
      <div className="cg-stats">
        {state === 'ok' && graph
          ? `${graph.stats.files} 文件 · ${graph.stats.dirs} 目录 · ${graph.stats.importEdges} import 边 · ${new Date(graph.scannedAt).toLocaleString()}`
          : ''}
      </div>
      <div className="cg-canvas-wrap">
        {state === 'loading' && <div className="cg-loading">扫描项目中…</div>}
        {state === 'error' && <div className="cg-error">加载失败：{errMsg}</div>}
        {state === 'ok' && <div className="cg-canvas" ref={canvasRef} onClick={onCanvasClick} />}
      </div>
      <details className="cg-md">
        <summary>Markdown 摘要</summary>
        <pre>{graph?.summary ?? ''}</pre>
      </details>
    </>
  )
}
