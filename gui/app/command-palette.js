// Ctrl+K 命令面板 — 可搜索、可执行
import { registerOverlay } from './modal.js'
import { ICONS } from './icons.js'

const ACTIONS = [
  { id: 'projects', label: '项目管理', hint: '最近工作区 / 打开文件夹', keys: ['project', '项目', '工作区', 'folder'], run: () => switchView('projects') },
  { id: 'open-project', label: '打开项目文件夹', hint: '切换工作区', keys: ['open', '打开'], run: () => { switchView('projects'); import('./project-registry.js').then(m => m.pickAndOpenProject()) } },
  { id: 'chat', label: '对话', hint: '主界面', keys: ['chat'], run: () => switchView('chat') },
  { id: 'new', label: '新对话', hint: '清空并开始', keys: ['new', '对话'], run: () => window.dispatchEvent(new CustomEvent('ccui:new-convo')) },
  { id: 'console', label: '控制台', hint: 'Skills / Agents / Rules / MCP', keys: ['console', '控制台'], run: () => switchView('console') },
  { id: 'studio', label: '数据工作室', hint: '搜索 / 导出 / 分支树', keys: ['studio', '数据'], run: () => switchView('studio') },
  { id: 'map', label: '项目结构图', hint: '目录 + import 边 · Agent 记忆', keys: ['map', 'graph', '结构', '脑图'], run: () => switchView('map') },
  { id: 'brief-lib', label: '简报库', hint: '曾存下的任务规格', keys: ['brief', '简报'], run: () => switchView('brief') },
  { id: 'focus-goal', label: '钉住这次要做', hint: 'Ctrl+Shift+B · 发送框上方任务钉', keys: ['任务', '目标', '这次要做', '钉住'], run: () => { switchView('chat'); window.dispatchEvent(new CustomEvent('ccui:focus-goal')) } },
  { id: 'align-check', label: '核对进度', hint: 'Ctrl+Shift+A · 对照当前目标是否偏离', keys: ['核对', '进度', 'align', '目标', '这次要做'], run: () => { switchView('chat'); window.dispatchEvent(new CustomEvent('ccui:align-check')) } },
  { id: 'review', label: '变更审查', hint: 'Ctrl+Shift+R · 批处理允许/拒绝', keys: ['review', '审查', '变更', 'permission', 'diff', '待处理'], run: () => window.ccui?.openReviewWindow?.() },
  { id: 'settings', label: '设置', hint: '连接 / 路由 / 风格', keys: ['settings', '设置'], run: () => switchView('settings') },
  { id: 'presets', label: '参数预设', hint: 'Ctrl+1~9 切换', keys: ['preset', '预设'], run: () => switchView('presets') },
  { id: 'templates', label: '提示词模板', hint: '输入 / 唤起', keys: ['template', '模板'], run: () => switchView('templates') },
  { id: 'theme', label: '主题编辑器', hint: '颜色 / 圆角 / CSS', keys: ['theme', '主题'], run: () => switchView('theme') },
  { id: 'orchestrate', label: '+ Compare 三路变异', hint: 'Lane A/B/C 独立 Thread', keys: ['orch', '编排', 'compare', '并行', '变异'], run: () => { switchView('chat'); window.dispatchEvent(new CustomEvent('ccui:start-compare')) } },
  { id: 'branch-edit', label: '编辑上一条并分叉', hint: 'Ctrl+Shift+E', keys: ['branch', '分支', '编辑', '分叉'], run: () => { switchView('chat'); import('./views/chat.js').then(m => m.editLastUserMessage()) } },
  { id: 'collab', label: '协作空间', hint: 'WebSocket 房间', keys: ['collab', '协作'], run: () => switchView('collab') },
  { id: 'files', label: '文件面板', hint: '浏览项目文件', keys: ['file', '文件'], run: () => document.getElementById('treeToggle')?.click() },
  { id: 'theme-toggle', label: '切换明暗主题', hint: '', keys: ['dark', 'light', '明暗'], run: () => document.getElementById('themeToggle')?.click() },
  { id: 'welcome', label: '重看欢迎引导', hint: '', keys: ['welcome', '引导'], run: () => import('./views/settings.js').then(m => m.showWelcome()) },
  { id: 'palette', label: '命令面板', hint: 'Ctrl+K', keys: ['help', '命令'], run: () => {} },
]

let switchViewFn = () => {}
let root = null
let active = 0
let filtered = ACTIONS

export function initCommandPalette(switchView) {
  switchViewFn = switchView
  if (root) return
  root = document.createElement('div')
  root.className = 'cmd-palette'
  root.innerHTML = `
    <div class="cmd-back">
      <div class="cmd-box">
        <input class="cmd-input" placeholder="搜索命令…" autocomplete="off" spellcheck="false" />
        <ul class="cmd-list"></ul>
        <div class="cmd-foot">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
      </div>
    </div>`
  document.body.appendChild(root)
  const input = root.querySelector('.cmd-input')
  input.addEventListener('input', () => filter(input.value))
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % filtered.length; renderList() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + filtered.length) % filtered.length; renderList() }
    else if (e.key === 'Enter') { e.preventDefault(); runActive() }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  })
  root.querySelector('.cmd-back').addEventListener('click', e => { if (e.target.classList.contains('cmd-back')) close() })
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open() }
  })
}

function switchView(name) { switchViewFn(name) }

function filter(q) {
  const s = q.trim().toLowerCase()
  filtered = !s ? ACTIONS : ACTIONS.filter(a =>
    a.label.toLowerCase().includes(s) ||
    a.hint.toLowerCase().includes(s) ||
    a.keys.some(k => k.includes(s))
  )
  active = 0
  renderList()
}

function renderList() {
  const ul = root.querySelector('.cmd-list')
  ul.innerHTML = ''
  filtered.forEach((a, i) => {
    const li = document.createElement('li')
    li.className = 'cmd-item' + (i === active ? ' active' : '')
    li.innerHTML = `<span class="cmd-label">${a.label}</span><span class="cmd-hint">${a.hint}</span>`
    li.onclick = () => { active = i; runActive() }
    ul.appendChild(li)
  })
}

function runActive() {
  const a = filtered[active]
  if (!a) return
  close()
  a.run()
}

let unregister = null
function open() {
  root.classList.add('open')
  active = 0
  filtered = ACTIONS
  const input = root.querySelector('.cmd-input')
  input.value = ''
  renderList()
  requestAnimationFrame(() => input.focus())
  unregister = registerOverlay(root, close)
}

function close() {
  root.classList.remove('open')
  unregister?.()
  unregister = null
}
