// 控制台：skill / agent / rule / MCP 一览 + 硬开关（引擎级过滤）
import { api } from '../api.js'
import { db } from '../db.js'
import { store } from '../store.js'
import { toast } from '../ui.js'

let container = null
let items = []

const GROUPS = [
  { kind: 'skill', label: '技能 Skills', icon: '' },
  { kind: 'agent', label: '子代理 Agents', icon: '' },
  { kind: 'rule', label: '规则 Rules', icon: '' },
  { kind: 'mcp', label: 'MCP 服务', icon: '' },
]

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

async function getDisabled() {
  try { return new Set((await db.get('settings', 'disabledResources'))?.value || []) } catch { return new Set() }
}

async function pushToEngine(set) {
  const map = (await db.get('settings', 'resourceMap'))?.value || {}
  for (const it of items) map[it.id] = { kind: it.kind, name: it.name, path: it.path }
  try {
    await api.request({ cmd: 'setDisabledResources', ids: [...set], map }, 15000)
  } catch (e) {
    toast(`引擎同步失败：${e.message}`, { type: 'warn' })
  }
}

async function setDisabled(set) {
  try { await db.put('settings', { id: 'disabledResources', value: [...set] }) } catch {}
  store.set({ disabledResources: [...set] })
  await pushToEngine(set)
}

/** 启动时把已保存的禁用列表下发 daemon */
export async function syncDisabledToDaemon() {
  const set = await getDisabled()
  const map = (await db.get('settings', 'resourceMap'))?.value || {}
  if (!set.size && !Object.keys(map).length) return
  try {
    await api.request({ cmd: 'setDisabledResources', ids: [...set], map }, 15000)
  } catch {}
}

export async function mountConsole(c) {
  container = c
  container.innerHTML = `
    <div class="view-head"><h1>控制台</h1>
      <div class="vh-actions"><button class="btn-ghost" id="con-refresh">重新扫描</button></div>
    </div>
    <div class="console-note">所有开关均为<strong>引擎级硬过滤</strong>：禁用的 skill 不会进入命令池，rule 不会注入记忆，agent 不会出现在子代理列表；MCP 走连接开关。变更后<strong>新对话</strong>立即生效。</div>
    <div class="console-body" id="con-body"><div class="console-loading">正在扫描资源…</div></div>`

  container.querySelector('#con-refresh').onclick = () => load(true)
  await load()
}

async function load(force) {
  const body = container.querySelector('#con-body')
  body.innerHTML = '<div class="console-loading">正在扫描资源…</div>'
  try {
    const resp = await api.request({ cmd: 'listResources' }, 20000)
    items = resp.items || []
  } catch (e) {
    body.innerHTML = `<div class="error-state">扫描失败：${e.message}<br/>请确认 daemon 正在运行。</div>`
    return
  }
  try {
    const map = {}
    for (const it of items) map[it.id] = { kind: it.kind, name: it.name, path: it.path }
    await db.put('settings', { id: 'resourceMap', value: map })
    await syncDisabledToDaemon()
  } catch {}
  if (force) toast('已重新扫描', { type: 'success' })
  render()
}

async function render() {
  const body = container.querySelector('#con-body')
  const disabled = await getDisabled()
  body.innerHTML = ''
  for (const g of GROUPS) {
    const list = items.filter(i => i.kind === g.kind)
    const sec = h('section', 'con-group')
    sec.appendChild(h('h2', null, `${g.icon} ${g.label} <span class="con-count">${list.length}</span>`))
    if (!list.length) {
      sec.appendChild(h('div', 'con-empty', g.kind === 'mcp' ? '未配置 MCP 服务' : `未发现 ${g.label}`))
      body.appendChild(sec)
      continue
    }
    for (const it of list) {
      const off = disabled.has(it.id)
      const row = h('div', 'con-row' + (off ? ' off' : ''))
      row.innerHTML = `
        <label class="switch"><input type="checkbox" ${off ? '' : 'checked'} /><span class="track"></span></label>
        <div class="con-main"><div class="con-name"></div><div class="con-desc"></div></div>
        <span class="con-src"></span><button class="con-view" title="查看文件">↗</button>`
      row.querySelector('.con-name').textContent = it.name
      row.querySelector('.con-desc').textContent = it.description || '—'
      row.querySelector('.con-src').textContent = it.source
      const cb = row.querySelector('input')
      cb.onchange = async () => {
        const cur = await getDisabled()
        if (cb.checked) cur.delete(it.id); else cur.add(it.id)
        await setDisabled(cur)
        row.classList.toggle('off', !cb.checked)
        if (it.kind === 'mcp') {
          try {
            const r = await api.request({ cmd: 'toggleMcp', name: it.name, enabled: cb.checked })
            toast(r.ok ? `MCP ${it.name} 已${cb.checked ? '启用' : '禁用'}` : 'MCP 开关未生效', { type: r.ok ? 'success' : 'warn' })
          } catch { toast('MCP 开关失败', { type: 'error' }) }
        } else {
          toast(`${it.name} 已${cb.checked ? '启用' : '硬禁用'}`, { type: 'success' })
        }
      }
      row.querySelector('.con-view').onclick = () => openInTree(it.path)
      sec.appendChild(row)
    }
    body.appendChild(sec)
  }
}

function openInTree(path) {
  if (!path) return
  window.dispatchEvent(new CustomEvent('ccui:openfile', { detail: { path } }))
  toast('已在文件面板打开', { type: 'info' })
}
