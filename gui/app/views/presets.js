// 参数预设管理器 — 生产级：loading/empty/error/动画/快捷键/确认/键盘可达/导出导入
import { store } from '../store.js'
import { db, uid } from '../db.js'
import { toast, confirmPopover } from '../ui.js'
import { ICONS } from '../icons.js'
import { mountCcSelect } from '../cc-select.js'

const MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash']
let container = null
let editing = null // 正在编辑的预设对象（null=未打开编辑）

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

export async function mountPresets(c) {
  container = c
  container.innerHTML = `
    <div class="view-head">
      <h1>参数预设</h1>
      <div class="vh-actions">
        <button class="btn-ghost" id="importPreset">导入</button>
        <button class="btn-ghost" id="exportPreset">导出</button>
        <button class="btn-primary" id="addPreset">+ 新建预设</button>
      </div>
    </div>
    <div class="preset-body" id="presetBody"></div>`

  container.querySelector('#addPreset').onclick = () => openEditor(null)
  container.querySelector('#exportPreset').onclick = exportPresets
  container.querySelector('#importPreset').onclick = importPresets
  await render()
}

async function loadPresets() {
  let list = []
  try { list = await db.getAll('presets') } catch (e) { throw e }
  list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  let activeId = store.get().activePresetId
  try {
    const s = await db.get('settings', 'activePreset')
    if (s) activeId = s.value
  } catch {}
  store.set({ presets: list, activePresetId: activeId })
  return list
}

async function render() {
  const body = container.querySelector('#presetBody')
  // loading 骨架
  body.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'
  let list
  try {
    list = await loadPresets()
  } catch (e) {
    body.innerHTML = ''
    body.appendChild(h('div', 'error-state', `加载失败：${e.message}<br><button class="btn-ghost" id="retry">重试</button>`))
    body.querySelector('#retry').onclick = render
    return
  }

  body.innerHTML = ''
  if (!list.length) {
    const empty = h('div', 'empty-state', `
      <div class="es-art">${ICONS.presets}</div>
      <h2>还没有任何预设</h2>
      <p>预设可保存模型、system prompt 等配置，对话时用 Ctrl+数字 快速切换。</p>
      <button class="btn-primary" id="createFirst">创建第一个预设</button>`)
    body.appendChild(empty)
    body.querySelector('#createFirst').onclick = () => openEditor(null)
    return
  }

  const activeId = store.get().activePresetId
  const grid = h('div', 'preset-grid')
  list.forEach((p, i) => {
    const card = h('div', 'preset-card')
    if (p.id === activeId) card.classList.add('active')
    card.dataset.id = p.id
    card.tabIndex = 0
    card.innerHTML = `
      <div class="pc-top">
        <span class="pc-badge">${i < 9 ? 'Ctrl+' + (i + 1) : ''}</span>
        <div class="pc-acts">
          <button class="pc-icon" data-act="copy" title="复制">⧉</button>
          <button class="pc-icon" data-act="export" title="导出">↧</button>
          <button class="pc-icon" data-act="del" title="删除">${ICONS.trash}</button>
        </div>
      </div>
      <div class="pc-name"></div>
      <div class="pc-meta"></div>
      <div class="pc-prompt"></div>
      <div class="pc-foot">
        <button class="btn-ghost" data-act="edit">编辑</button>
        <button class="btn-apply" data-act="apply">${p.id === activeId ? '已激活' : '激活'}</button>
      </div>`
    card.querySelector('.pc-name').textContent = p.name
    card.querySelector('.pc-meta').textContent = `${p.model} · temp ${p.temperature ?? 1}`
    card.querySelector('.pc-prompt').textContent = p.systemPrompt || '（无 system prompt）'

    card.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation()
        const act = btn.dataset.act
        if (act === 'edit') openEditor(p)
        else if (act === 'apply') applyPreset(p)
        else if (act === 'copy') duplicatePreset(p)
        else if (act === 'export') exportOne(p)
        else if (act === 'del') {
          if (p.id === activeId) { toast('请先切换到其他预设再删除当前激活项', { type: 'warn' }); return }
          confirmPopover(btn, `删除预设“${p.name}”？`, () => deletePreset(p))
        }
      }
    })
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter') applyPreset(p)
      else if (e.key === 'Delete' && p.id !== activeId) confirmPopover(card, `删除预设“${p.name}”？`, () => deletePreset(p))
    })
    grid.appendChild(card)
  })
  body.appendChild(grid)
}

function openEditor(preset) {
  editing = preset
  const isNew = !preset
  const ov = h('div', 'modal-overlay')
  ov.innerHTML = `
    <div class="modal">
      <div class="modal-head">${isNew ? '新建预设' : '编辑预设'}</div>
      <label>名称<input id="f-name" type="text" maxlength="40" /></label>
      <span class="field-err" id="e-name"></span>
      <label>模型<select id="f-model">${MODELS.map(m => `<option>${m}</option>`).join('')}</select></label>
      <label>Temperature <span id="f-temp-v"></span><input id="f-temp" type="range" min="0" max="2" step="0.1" /></label>
      <label>System Prompt<textarea id="f-sys" rows="5" placeholder="可选，定义助手的角色与风格"></textarea></label>
      <div class="modal-foot">
        <button class="btn-ghost" id="m-cancel">取消</button>
        <button class="btn-primary" id="m-save">保存</button>
      </div>
    </div>`
  document.body.appendChild(ov)
  const $ = id => ov.querySelector(id)
  $('#f-name').value = preset?.name || ''
  $('#f-model').value = preset?.model || MODELS[0]
  mountCcSelect($('#f-model'), { variant: 'form', menuPlacement: 'below' })
  $('#f-temp').value = preset?.temperature ?? 1
  $('#f-temp-v').textContent = $('#f-temp').value
  $('#f-sys').value = preset?.systemPrompt || ''
  $('#f-temp').oninput = () => { $('#f-temp-v').textContent = $('#f-temp').value }
  setTimeout(() => $('#f-name').focus(), 30)

  const close = () => { ov.classList.remove('show'); ov.addEventListener('transitionend', () => ov.remove(), { once: true }) }
  requestAnimationFrame(() => ov.classList.add('show'))
  ov.addEventListener('mousedown', e => { if (e.target === ov) close() })
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc) } })
  $('#m-cancel').onclick = close
  $('#m-save').onclick = async () => {
    const name = $('#f-name').value.trim()
    $('#e-name').textContent = ''
    if (!name) { $('#e-name').textContent = '名称不能为空'; $('#f-name').focus(); return }
    const dup = store.get().presets.find(p => p.name === name && p.id !== preset?.id)
    if (dup) { $('#e-name').textContent = '已存在同名预设'; return }
    const saveBtn = $('#m-save'); saveBtn.disabled = true; saveBtn.textContent = '保存中…'
    const record = {
      id: preset?.id || uid('p'),
      name,
      model: $('#f-model').value,
      temperature: parseFloat($('#f-temp').value),
      systemPrompt: $('#f-sys').value.trim(),
      createdAt: preset?.createdAt || Date.now(),
      updatedAt: Date.now(),
    }
    try {
      await db.put('presets', record)
      toast(isNew ? '预设已创建' : '预设已更新', { type: 'success' })
      close(); render()
    } catch (e) {
      saveBtn.disabled = false; saveBtn.textContent = '保存'
      $('#e-name').textContent = `保存失败：${e.message}`
      toast('保存失败', { type: 'error' })
    }
  }
}

async function applyPreset(p) {
  store.set({ activePresetId: p.id })
  try { await db.put('settings', { id: 'activePreset', value: p.id }) } catch {}
  toast(`已激活预设「${p.name}」`, { type: 'success' })
  render()
}

async function duplicatePreset(p) {
  const copy = { ...p, id: uid('p'), name: `${p.name} 副本`, createdAt: Date.now(), updatedAt: Date.now() }
  await db.put('presets', copy)
  toast('已复制', { type: 'success' })
  render()
}

async function deletePreset(p) {
  const card = container.querySelector(`.preset-card[data-id="${p.id}"]`)
  if (card) { card.classList.add('removing'); await new Promise(r => setTimeout(r, 180)) }
  await db.delete('presets', p.id)
  toast('已删除', { type: 'success' })
  render()
}

// ---------- 导入导出 ----------
function download(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
function exportOne(p) { download(`preset-${p.name}.json`, { type: 'ccui-preset', preset: p }) }
function exportPresets() {
  const list = store.get().presets
  if (!list.length) { toast('暂无预设可导出', { type: 'warn' }); return }
  download('ccui-presets.json', { type: 'ccui-presets', presets: list })
  toast(`已导出 ${list.length} 个预设`, { type: 'success' })
}
function importPresets() {
  const inp = document.createElement('input')
  inp.type = 'file'; inp.accept = 'application/json'
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return
    try {
      const data = JSON.parse(await file.text())
      const arr = data.presets || (data.preset ? [data.preset] : [])
      if (!arr.length) throw new Error('文件中没有预设')
      let n = 0
      for (const p of arr) {
        if (!p || !p.name) continue
        await db.put('presets', { ...p, id: uid('p'), createdAt: Date.now(), updatedAt: Date.now() })
        n++
      }
      toast(`已导入 ${n} 个预设`, { type: 'success' })
      render()
    } catch (e) {
      toast(`导入失败：${e.message}`, { type: 'error' })
    }
  }
  inp.click()
}

// 全局快捷键 Ctrl+1..9 切换预设
export function initPresetHotkeys() {
  document.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.shiftKey || e.altKey) return
    const n = parseInt(e.key, 10)
    if (n >= 1 && n <= 9) {
      const list = store.get().presets
      const p = list[n - 1]
      if (p) { e.preventDefault(); applyPreset(p) }
    }
  })
}
