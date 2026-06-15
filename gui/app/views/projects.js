// 项目管理 — Cursor/Codex 风格：最近项目、切换工作区、当前概览
import { api } from '../api.js'
import { toast } from '../ui.js'
import { ICONS } from '../icons.js'
import {
  getProjectsState,
  pickAndOpenProject,
  switchProject,
  pinProject,
  removeProject,
  openInExplorer,
  projectDisplayName,
} from '../project-registry.js'

let container = null
let state = null
let info = null

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return d.toLocaleDateString()
}

export async function mountProjects(c) {
  container = c
  await refresh()
}

async function refresh() {
  container.innerHTML = '<div class="proj-loading">加载项目…</div>'
  try {
    state = await getProjectsState()
    const res = await api.request({ cmd: 'getProjectInfo' }, 30000)
    info = res.info || null
    render()
  } catch (e) {
    container.innerHTML = `<div class="proj-error">加载失败：${esc(e.message)}</div>`
  }
}

function render() {
  const current = state.recent?.find(r => r.path === state.current) || {
    path: state.current,
    name: projectDisplayName({ path: state.current }),
  }
  const others = (state.recent || []).filter(r => r.path !== state.current)

  container.innerHTML = `
    <div class="view-head">
      <h1>项目</h1>
      <div class="vh-actions">
        <button class="btn-ghost" id="proj-refresh">${ICONS.refresh} 刷新</button>
        <button class="btn-primary" id="proj-open">打开文件夹…</button>
      </div>
    </div>
    <p class="proj-hint">管理本地工作区，类似 Cursor / Codex 的项目列表。切换项目会重启 Agent 引擎并刷新文件树。</p>

    <section class="proj-current">
      <div class="proj-current-badge">当前工作区</div>
      <div class="proj-current-body">
        <div class="proj-current-icon">${ICONS.folder}</div>
        <div class="proj-current-meta">
          <div class="proj-current-name">${esc(current.name || projectDisplayName(current))}</div>
          <div class="proj-current-path" title="${esc(current.path)}">${esc(current.path)}</div>
          <div class="proj-current-stats" id="proj-stats"></div>
        </div>
        <div class="proj-current-actions">
          <button class="btn-primary" id="proj-chat">开始对话</button>
          <button class="btn-ghost" id="proj-explorer">在资源管理器中打开</button>
          <button class="btn-ghost" id="proj-map">结构图</button>
          <button class="btn-ghost" id="proj-console">控制台</button>
        </div>
      </div>
    </section>

    <section class="proj-section">
      <div class="proj-section-head">
        <h2>最近打开</h2>
        <span class="proj-section-sub">${others.length + 1} 个工作区</span>
      </div>
      <div class="proj-grid" id="proj-grid"></div>
    </section>`

  const statsEl = container.querySelector('#proj-stats')
  if (info) {
    const g = info.graphStats
    statsEl.innerHTML = [
      g ? `${g.files} 文件 · ${g.dirs} 目录` : null,
      info.skills != null ? `${info.skills} Skills` : null,
      info.agents != null ? `${info.agents} Agents` : null,
      info.rules != null ? `${info.rules} Rules` : null,
      info.mcp != null ? `${info.mcp} MCP` : null,
      info.gitBranch ? `分支 ${esc(info.gitBranch)}` : null,
      info.hasClaudeMd ? 'CLAUDE.md' : null,
      info.hasEnv ? '.env' : null,
    ].filter(Boolean).map(s => `<span class="proj-chip">${s}</span>`).join('')
  } else {
    statsEl.textContent = '扫描项目信息中…'
  }

  const grid = container.querySelector('#proj-grid')
  const all = [current, ...others]
  if (all.length === 0) {
    grid.innerHTML = '<div class="proj-empty">尚无项目记录，点击「打开文件夹」添加</div>'
  } else {
    for (const p of all) {
      const card = h('div', `proj-card${p.path === state.current ? ' active' : ''}`)
      card.innerHTML = `
        <div class="proj-card-top">
          <span class="proj-card-icon">${ICONS.folder}</span>
          <button class="proj-pin${p.pinned ? ' on' : ''}" title="${p.pinned ? '取消固定' : '固定'}">★</button>
        </div>
        <div class="proj-card-name">${esc(p.name || projectDisplayName(p))}</div>
        <div class="proj-card-path" title="${esc(p.path)}">${esc(p.path)}</div>
        <div class="proj-card-foot">
          <span>${fmtTime(p.lastOpened)}</span>
          ${p.path === state.current ? '<span class="proj-active-tag">当前</span>' : ''}
        </div>
        <div class="proj-card-actions">
          ${p.path !== state.current ? '<button class="btn-ghost proj-switch">切换</button>' : '<button class="btn-ghost proj-switch" disabled>当前</button>'}
          <button class="btn-ghost proj-remove" title="从列表移除">移除</button>
        </div>`
      card.querySelector('.proj-pin').onclick = async e => {
        e.stopPropagation()
        await pinProject(p.path, !p.pinned)
        await refresh()
        toast(p.pinned ? '已取消固定' : '已固定', { type: 'success' })
      }
      card.querySelector('.proj-switch').onclick = async e => {
        e.stopPropagation()
        if (p.path === state.current) return
        await doSwitch(p.path)
      }
      card.querySelector('.proj-remove').onclick = async e => {
        e.stopPropagation()
        if (p.path === state.current) {
          toast('不能移除当前工作区，请先切换其他项目', { type: 'warn' })
          return
        }
        await removeProject(p.path)
        await refresh()
        toast('已从列表移除', { type: 'info' })
      }
      card.onclick = () => {
        if (p.path !== state.current) doSwitch(p.path)
      }
      grid.appendChild(card)
    }
  }

  container.querySelector('#proj-refresh').onclick = () => refresh()
  container.querySelector('#proj-open').onclick = () => pickAndOpenProject().then(r => {
    if (r?.ok && r.path) doSwitch(r.path)
  })
  container.querySelector('#proj-explorer').onclick = () => openInExplorer(state.current)
  container.querySelector('#proj-chat').onclick = () => window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'chat' }))
  container.querySelector('#proj-map').onclick = () => window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'map' }))
  container.querySelector('#proj-console').onclick = () => window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'console' }))
}

async function doSwitch(projectPath) {
  try {
    toast('正在切换项目…', { type: 'info' })
    const r = await switchProject(projectPath)
    if (!r?.ok) throw new Error(r?.error || '切换失败')
    window.dispatchEvent(new CustomEvent('ccui:project-changed', { detail: r }))
    await refresh()
    toast(`已切换到 ${r.name || projectDisplayName(r)}`, { type: 'success' })
  } catch (e) {
    toast(`切换失败：${e.message}`, { type: 'error' })
  }
}
