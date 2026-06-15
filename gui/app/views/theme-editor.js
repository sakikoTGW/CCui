// 可视化主题编辑器：调色/字体/圆角/气泡 + 自定义 CSS 实时预览 + 导出导入分享
import { store } from '../store.js'
import { db, uid } from '../db.js'
import { toast, confirmPopover } from '../ui.js'
import { applyTheme, BUILTIN_THEMES } from '../ui.js'
import { ICONS } from '../icons.js'
import { mountCcSelect } from '../cc-select.js'

let container = null
let draft = null
let customStyleEl = null

const FIELDS = [
  { key: '--bg', label: '背景', type: 'color' },
  { key: '--surface', label: '卡片面', type: 'color' },
  { key: '--surface-2', label: '次级面', type: 'color' },
  { key: '--border', label: '边框', type: 'color' },
  { key: '--text', label: '正文', type: 'color' },
  { key: '--text-2', label: '次要文字', type: 'color' },
  { key: '--accent', label: '强调色', type: 'color' },
]

function currentVars() {
  const cs = getComputedStyle(document.documentElement)
  const v = {}
  for (const f of FIELDS) v[f.key] = cs.getPropertyValue(f.key).trim() || '#000000'
  v['--radius'] = (cs.getPropertyValue('--radius').trim() || '12px')
  return v
}

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

export async function mountThemeEditor(c) {
  container = c
  draft = { name: '自定义主题', vars: currentVars(), css: '', radius: parseInt(currentVars()['--radius']) || 12 }
  try {
    const saved = await db.get('settings', 'theme')
    if (saved?.vars) { draft.vars = { ...draft.vars, ...saved.vars }; draft.name = saved.name || draft.name }
    const css = await db.get('settings', 'customCss')
    if (css?.value) draft.css = css.value
  } catch {}

  container.innerHTML = `
    <div class="view-head"><h1>主题编辑器</h1>
      <div class="vh-actions">
        <button class="btn-ghost" id="th-reset">重置</button>
        <button class="btn-ghost" id="th-import">导入</button>
        <button class="btn-ghost" id="th-export">导出</button>
        <button class="btn-primary" id="th-save">应用并保存</button>
      </div>
    </div>
    <div class="theme-body">
      <div class="theme-controls">
        <div class="tc-group" id="tc-colors"></div>
        <div class="tc-group">
          <label>圆角 <span id="th-radius-v"></span><input type="range" id="th-radius" min="0" max="22" step="1" /></label>
          <label>预设主题
            <select id="th-builtin"><option value="">— 选择内置 —</option><option value="light">浅色</option><option value="dark">暗色</option></select>
          </label>
        </div>
        <div class="tc-group">
          <label>自定义 CSS（高级，实时预览）</label>
          <textarea id="th-css" rows="8" placeholder=".bubble.md { font-size: 15px; }" spellcheck="false"></textarea>
        </div>
      </div>
      <div class="theme-preview" id="th-preview">
        <div class="msg user"><div class="role">你</div><div class="bubble">这是一条用户消息预览</div></div>
        <div class="msg assistant"><div class="role">CCui</div><div class="bubble md"><p>这是助手回复，含 <code>inline code</code>。</p><pre><code>const x = 42</code></pre></div></div>
        <div class="toolcard"><div class="head"><span class="ico">${ICONS.tool}</span><span class="name">Read</span><span class="arg">src/index.ts</span><span class="spin done">12ms</span></div></div>
        <button class="btn-primary" style="margin-top:8px">主操作按钮</button>
      </div>
    </div>`

  const colors = container.querySelector('#tc-colors')
  for (const f of FIELDS) {
    const row = h('label', 'color-row')
    row.innerHTML = `<span>${f.label}</span><input type="color" data-key="${f.key}" />`
    const inp = row.querySelector('input')
    inp.value = toHex(draft.vars[f.key])
    inp.oninput = () => { draft.vars[f.key] = inp.value; preview() }
    colors.appendChild(row)
  }

  const radius = container.querySelector('#th-radius')
  radius.value = draft.radius
  container.querySelector('#th-radius-v').textContent = `${draft.radius}px`
  radius.oninput = () => { draft.radius = parseInt(radius.value); container.querySelector('#th-radius-v').textContent = `${draft.radius}px`; preview() }

  const cssEl = container.querySelector('#th-css')
  cssEl.value = draft.css
  cssEl.oninput = () => { draft.css = cssEl.value; preview() }

  mountCcSelect('th-builtin', {
    variant: 'form',
    menuPlacement: 'below',
    onChange: v => {
      const b = BUILTIN_THEMES[v]
      if (b) { draft.vars = { ...draft.vars, ...b }; syncColorInputs(); preview() }
    },
  })

  container.querySelector('#th-reset').onclick = e => {
    confirmPopover(e.target, '重置主题为默认浅色？未保存的自定义将丢失', () => {
      draft.vars = { ...BUILTIN_THEMES.light }; draft.css = ''; draft.radius = 12
      cssEl.value = ''; radius.value = 12; syncColorInputs(); preview()
      toast('已重置', { type: 'success' })
    })
  }
  container.querySelector('#th-export').onclick = exportTheme
  container.querySelector('#th-import').onclick = importTheme
  container.querySelector('#th-save').onclick = save

  preview()
}

function syncColorInputs() {
  for (const f of FIELDS) {
    const inp = container.querySelector(`input[data-key="${f.key}"]`)
    if (inp) inp.value = toHex(draft.vars[f.key])
  }
}

// 实时预览：仅作用于编辑器内的 preview 容器，避免误改全局直到保存
function preview() {
  const p = container.querySelector('#th-preview')
  if (!p) return
  for (const f of FIELDS) p.style.setProperty(f.key, draft.vars[f.key])
  p.style.setProperty('--radius', `${draft.radius}px`)
  // 自定义 CSS 注入（限定到 preview 容器作用域时较难，这里全局注入一个临时 style，仅预览阶段）
  ensureCustomStyle().textContent = scopeCssToPreview(draft.css)
}

function ensureCustomStyle() {
  if (!customStyleEl) { customStyleEl = document.createElement('style'); customStyleEl.id = 'theme-preview-css'; document.head.appendChild(customStyleEl) }
  return customStyleEl
}
// 简单作用域：把用户 CSS 限定在 #th-preview 下，避免污染整个应用预览阶段
function scopeCssToPreview(css) {
  if (!css.trim()) return ''
  return css.replace(/(^|\})\s*([^{}]+)\{/g, (m, brace, sel) => {
    const scoped = sel.split(',').map(s => `#th-preview ${s.trim()}`).join(', ')
    return `${brace} ${scoped} {`
  })
}

async function save() {
  await applyTheme(draft.name, draft.vars)
  document.documentElement.style.setProperty('--radius', `${draft.radius}px`)
  // 全局自定义 CSS
  let globalEl = document.getElementById('user-custom-css')
  if (!globalEl) { globalEl = document.createElement('style'); globalEl.id = 'user-custom-css'; document.head.appendChild(globalEl) }
  globalEl.textContent = draft.css
  try {
    await db.put('settings', { id: 'theme', name: draft.name, vars: draft.vars })
    await db.put('settings', { id: 'customCss', value: draft.css })
    await db.put('settings', { id: 'radius', value: draft.radius })
  } catch {}
  if (customStyleEl) customStyleEl.textContent = ''
  store.set({ theme: draft.name })
  toast('主题已应用并保存', { type: 'success' })
}

function exportTheme() {
  const obj = { type: 'ccui-theme', name: draft.name, vars: draft.vars, css: draft.css, radius: draft.radius }
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `theme-${draft.name}.json`; a.click(); URL.revokeObjectURL(a.href)
  toast('主题已导出', { type: 'success' })
}
function importTheme() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json'
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return
    try {
      const data = JSON.parse(await f.text())
      if (data.vars) draft.vars = { ...draft.vars, ...data.vars }
      if (data.css != null) draft.css = data.css
      if (data.radius) draft.radius = data.radius
      if (data.name) draft.name = data.name
      mountThemeEditor(container) // 重渲染填充
      toast('主题已导入，点击应用保存', { type: 'success' })
    } catch (e) { toast(`导入失败：${e.message}`, { type: 'error' }) }
  }
  inp.click()
}

// #rrggbb 容错（rgb()/命名色 → 退回黑）
function toHex(v) {
  v = String(v || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map(c => c + c).join('')
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (m) return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('')
  return '#000000'
}

// 应用启动时恢复已保存的自定义 CSS + 圆角
export async function restoreCustomStyle() {
  try {
    const css = await db.get('settings', 'customCss')
    if (css?.value) { const el = document.createElement('style'); el.id = 'user-custom-css'; el.textContent = css.value; document.head.appendChild(el) }
    const r = await db.get('settings', 'radius')
    if (r?.value) document.documentElement.style.setProperty('--radius', `${r.value}px`)
  } catch {}
}
