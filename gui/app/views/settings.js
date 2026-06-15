// 设置：连接配置（不用敲命令）+ 路由策略 + 编码风格记忆 + 关于
import { store } from '../store.js'
import { db } from '../db.js'
import { api } from '../api.js'
import { toast, applyPersonalize, savePersonalize, getPersonalize } from '../ui.js'
import { DEFAULT_PERSONALIZE, deriveAccentWeak } from '../theme-personalize.js'
import { ICONS } from '../icons.js'
import { registerOverlay } from '../modal.js'
import { PERM_TOOL_GROUPS, PERM_EXPLAIN, getAllowedTools, saveAllowedTools } from '../permissions.js'
import { getChromePrefs, saveChrome } from '../titlebar.js'
import { mountCcSelect } from '../cc-select.js'

const APP_VERSION = '0.1.0'

let container = null
/** @type {string[]|null} */
let cachedSystemFonts = null
const FONT_FALLBACK = ['PingFang SC', 'PingFang TC', 'Microsoft YaHei UI', '微软雅黑', 'Segoe UI', 'SimSun', 'Arial']

/** 后台预热字体列表，避免首次打开设置卡顿 */
export function preloadSystemFonts() {
  if (cachedSystemFonts) return Promise.resolve(cachedSystemFonts)
  if (!window.ccui?.listFonts) return Promise.resolve(FONT_FALLBACK)
  return window.ccui.listFonts()
    .then(list => { cachedSystemFonts = list?.length ? list : FONT_FALLBACK; return cachedSystemFonts })
    .catch(() => { cachedSystemFonts = FONT_FALLBACK; return cachedSystemFonts })
}

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}
function mask(k) {
  if (!k) return ''
  if (k.length <= 8) return '••••'
  return k.slice(0, 5) + '••••••••' + k.slice(-4)
}

export async function mountSettings(c) {
  container = c

  let conn = {}
  let router = {}
  let style = {}
  let chrome = getChromePrefs()
  try {
    const [connRow, routerRow, styleRow, chromeRow] = await Promise.all([
      db.get('settings', 'connection'),
      db.get('settings', 'router'),
      db.get('settings', 'codingStyle'),
      db.get('settings', 'windowChrome'),
    ])
    conn = connRow?.value || {}
    router = routerRow?.value || { mode: 'auto', strongModel: 'deepseek-v4-pro', weakModel: 'deepseek-v4-flash' }
    style = styleRow?.value || {}
    if (chromeRow?.value) chrome = { ...chrome, ...chromeRow.value }
  } catch (e) {
    container.innerHTML = `<div class="error-state">读取本地配置失败：${e.message}<br/>请检查浏览器存储是否被清除。</div>`
    return
  }

  container.innerHTML = `
    <div class="view-head"><h1>设置</h1></div>
    <div class="settings-body">

      <section class="set-card">
        <h2>工具权限</h2>
        <p class="set-hint">${PERM_EXPLAIN}</p>
        <div class="perm-groups" id="perm-groups"></div>
        <div class="set-actions">
          <button class="btn-primary" id="set-save-perms">保存权限</button>
          <button class="btn-ghost" id="set-open-console">打开控制台 (Skills/MCP)</button>
        </div>
      </section>

      <section class="set-card">
        <h2>连接配置</h2>
        <p class="set-hint">无需改 .env 文件。保存后对<strong>新对话</strong>生效。</p>
        <label class="set-row"><span>API 地址 (Base URL)</span>
          <input id="set-base" type="text" placeholder="https://api.deepseek.com/anthropic" /></label>
        <label class="set-row"><span>API Key</span>
          <input id="set-key" type="password" placeholder="sk-..." />
          <button class="set-eye" id="set-eye" title="显示/隐藏">${ICONS.eye}</button></label>
        <div class="set-keyhint" id="set-keyhint"></div>
        <label class="set-row"><span>默认模型</span>
          <input id="set-model" type="text" placeholder="deepseek-v4-flash" /></label>
        <div class="set-actions">
          <button class="btn-primary" id="set-save-conn">保存连接</button>
        </div>
      </section>

      <section class="set-card">
        <h2>模型路由策略</h2>
        <p class="set-hint">控制强/弱模型的分派。auto = 按任务自动选，省钱又靠谱。</p>
        <label class="set-row"><span>路由模式</span>
          <select id="set-mode">
            <option value="auto">auto（按任务自动）</option>
            <option value="strong-only">强模型优先</option>
            <option value="weak-only">弱模型优先</option>
          </select></label>
        <label class="set-row"><span>强模型</span><input id="set-strong" type="text" /></label>
        <label class="set-row"><span>弱模型</span><input id="set-weak" type="text" /></label>
        <div class="set-actions"><button class="btn-primary" id="set-save-router">保存路由</button></div>
      </section>

      <section class="set-card">
        <h2>编码风格记忆</h2>
        <p class="set-hint">这些偏好会作为系统提示注入每轮对话（粉色龙 #14）。</p>
        <label class="set-row"><span>语言偏好</span><input id="st-lang" type="text" placeholder="中文注释，变量用英文" /></label>
        <label class="set-row"><span>缩进/格式</span><input id="st-fmt" type="text" placeholder="2 空格，单引号，无分号" /></label>
        <label class="set-row top"><span>自定义约定</span>
          <textarea id="st-rules" rows="4" placeholder="例：优先函数式；不写无意义注释；错误必须处理"></textarea></label>
        <label class="set-check"><input id="st-on" type="checkbox" /> 启用风格记忆（注入对话）</label>
        <div class="set-actions"><button class="btn-primary" id="set-save-style">保存偏好</button></div>
      </section>

      <section class="set-card" id="set-appearance">
        <h2>外观个性化</h2>
        <p class="set-hint">自定义强调色与画布背景。与顶栏明暗切换叠加生效；完整调色请用<a href="#" id="set-open-theme" class="set-inline-link">主题编辑器</a>。</p>
        <div class="appear-preview" id="appear-preview" aria-hidden="true">
          <span class="ap-dot"></span>
          <span class="ap-chip">强调色预览</span>
          <button type="button" class="ap-btn">按钮</button>
        </div>
        <label class="set-row color-row-set">
          <span>强调色</span>
          <input id="set-accent" type="color" />
          <button type="button" class="btn-ghost set-accent-reset" id="set-accent-reset">恢复默认</button>
        </label>
        <label class="set-row"><span>背景模式</span>
          <select id="set-bg-mode">
            <option value="default">默认渐变</option>
            <option value="color">纯色</option>
            <option value="image">图片</option>
          </select>
        </label>
        <label class="set-row set-bg-color-row"><span>背景颜色</span>
          <input id="set-bg-color" type="color" /></label>
        <label class="set-row set-bg-image-row"><span>图片地址</span>
          <input id="set-bg-image" type="text" placeholder="https://... 或点击下方上传本地图片" /></label>
        <div class="set-row set-bg-image-row">
          <span>本地图片</span>
          <div class="set-bg-file">
            <button type="button" class="btn-ghost" id="set-bg-pick">选择文件…</button>
            <input id="set-bg-file" type="file" accept="image/*" hidden />
            <span class="set-bg-filehint" id="set-bg-filehint">未选择</span>
          </div>
        </div>
        <label class="set-row set-bg-image-row">遮罩浓度 <span id="set-bg-overlay-v"></span>
          <input id="set-bg-overlay" type="range" min="0" max="85" step="1" /></label>
        <label class="set-row set-bg-image-row">背景模糊 <span id="set-bg-blur-v"></span>
          <input id="set-bg-blur" type="range" min="0" max="20" step="1" /></label>
        <label class="set-row"><span>界面字体</span>
          <select id="set-font-family">
            <option value="">默认（苹方）</option>
          </select>
        </label>
        <p class="set-hint set-font-hint" id="set-font-hint">从本机已安装字体中选择；默认优先使用苹方（PingFang SC）。</p>
        <label class="set-check"><input id="set-adaptive-text" type="checkbox" checked /> 文字随背景自适应（提高可读性）</label>
        <div class="set-actions">
          <button class="btn-ghost" id="set-appearance-reset">恢复默认外观</button>
          <button class="btn-primary" id="set-save-appearance">保存并应用</button>
        </div>
      </section>

      <section class="set-card">
        <h2>窗口与状态栏</h2>
        <p class="set-hint">不使用系统标题栏，可自定义状态栏显示项。</p>
        <label class="set-check"><input id="set-chrome-project" type="checkbox" /> 显示项目名</label>
        <label class="set-check"><input id="set-chrome-session" type="checkbox" /> 显示会话标题</label>
        <label class="set-check"><input id="set-chrome-theme" type="checkbox" /> 显示主题切换</label>
        <label class="set-check"><input id="set-chrome-connection" type="checkbox" /> 显示连接状态</label>
        <div class="set-actions">
          <button class="btn-primary" id="set-save-chrome">保存并应用</button>
        </div>
      </section>

      <section class="set-card">
        <h2>Live2D 全局助手</h2>
        <p class="set-hint">右下角悬浮助手，对话/编排 busy 时自动切换动作。可填 model.json 路径（Cubism 2/3）供后续加载。</p>
        <label class="set-row"><span>模型路径/URL</span>
          <input id="set-l2d" type="text" placeholder="https://.../model.json 或本地路径" /></label>
        <div class="set-actions"><button class="btn-primary" id="set-save-l2d">保存</button></div>
      </section>

      <section class="set-card about">
        <h2>关于 CCui</h2>
        <div class="about-grid">
          <div><span class="ab-k">版本</span><span class="ab-v">v${APP_VERSION}</span></div>
          <div><span class="ab-k">内核</span><span class="ab-v">Bun core daemon (Claude Code 引擎)</span></div>
          <div><span class="ab-k">外壳</span><span class="ab-v">Electron + 原生 ES Modules</span></div>
          <div><span class="ab-k">模型</span><span class="ab-v">DeepSeek (Anthropic 兼容)</span></div>
          <div><span class="ab-k">存储</span><span class="ab-v">IndexedDB 本地优先</span></div>
        </div>
        <p class="about-credit">本地优先 · 你的数据只在你机器上。致谢 Anthropic Claude Code、DeepSeek、Electron、marked、highlight.js。</p>
        <div class="set-actions">
          <button class="btn-ghost" id="set-replay-welcome">重看新手引导</button>
          <button class="btn-ghost" id="set-export-all">导出全部数据</button>
        </div>
      </section>
    </div>`

  const $ = id => container.querySelector(id)

  // 权限
  const allowed = new Set(await getAllowedTools())
  const pg = $('#perm-groups')
  for (const g of PERM_TOOL_GROUPS) {
    const block = h('div', 'perm-grp')
    block.appendChild(h('h3', 'perm-grp-title', g.label))
    const grid = h('div', 'perm-grid')
    for (const t of g.tools) {
      const lbl = h('label', 'perm-item')
      lbl.innerHTML = `<input type="checkbox" data-tool="${t}" ${allowed.has(t) ? 'checked' : ''} /><span>${t}</span>`
      grid.appendChild(lbl)
    }
    block.appendChild(grid)
    pg.appendChild(block)
  }
  $('#set-save-perms').onclick = async () => {
    const picked = [...pg.querySelectorAll('input[data-tool]:checked')].map(i => i.dataset.tool)
    try {
      await saveAllowedTools(picked)
      toast('工具权限已保存', { type: 'success' })
    } catch (e) { toast(`保存失败：${e.message}`, { type: 'error' }) }
  }
  $('#set-open-console').onclick = () => {
    document.querySelector('.act[data-view="console"]')?.click()
  }

  // 填充连接
  $('#set-base').value = conn.baseUrl || ''
  $('#set-model').value = conn.model || ''
  $('#set-keyhint').textContent = conn.apiKey ? `当前已保存：${mask(conn.apiKey)}` : '尚未设置 Key（将使用 .env 中的默认值）'
  let keyVisible = false
  $('#set-eye').onclick = () => { keyVisible = !keyVisible; $('#set-key').type = keyVisible ? 'text' : 'password' }

  $('#set-save-conn').onclick = async () => {
    const baseUrl = $('#set-base').value.trim()
    const key = $('#set-key').value.trim()
    const model = $('#set-model').value.trim()
    if (baseUrl && !/^https?:\/\//.test(baseUrl)) { toast('Base URL 需以 http(s):// 开头', { type: 'error' }); return }
    const next = { ...conn }
    if (baseUrl) next.baseUrl = baseUrl
    if (model) next.model = model
    if (key) next.apiKey = key
    try {
      await db.put('settings', { id: 'connection', value: next })
      conn = next
      const patch = {}
      if (next.baseUrl) patch.ANTHROPIC_BASE_URL = next.baseUrl
      if (next.apiKey) patch.ANTHROPIC_API_KEY = next.apiKey
      if (next.model) patch.DEEPSEEK_MODEL = next.model
      api.setEnv(patch)
      api.reset()
      $('#set-key').value = ''
      $('#set-keyhint').textContent = next.apiKey ? `当前已保存：${mask(next.apiKey)}` : '尚未设置 Key'
      toast('连接配置已保存并下发（新对话生效）', { type: 'success' })
    } catch (e) { toast(`保存失败：${e.message}`, { type: 'error' }) }
  }

  // 填充路由
  $('#set-mode').value = router.mode || 'auto'
  const modeSelect = mountCcSelect('set-mode', { variant: 'form', menuPlacement: 'below' })
  $('#set-strong').value = router.strongModel || 'deepseek-v4-pro'
  $('#set-weak').value = router.weakModel || 'deepseek-v4-flash'
  $('#set-save-router').onclick = async () => {
    const next = { mode: modeSelect.getValue(), strongModel: $('#set-strong').value.trim(), weakModel: $('#set-weak').value.trim() }
    try {
      await db.put('settings', { id: 'router', value: next })
      router = next
      api.setRouter(next)
      toast('路由策略已生效', { type: 'success' })
    } catch (e) { toast(`保存失败：${e.message}`, { type: 'error' }) }
  }

  // 填充风格
  $('#st-lang').value = style.lang || ''
  $('#st-fmt').value = style.fmt || ''
  $('#st-rules').value = style.rules || ''
  $('#st-on').checked = !!style.enabled
  $('#set-save-style').onclick = async () => {
    const next = { lang: $('#st-lang').value.trim(), fmt: $('#st-fmt').value.trim(), rules: $('#st-rules').value.trim(), enabled: $('#st-on').checked }
    try {
      await db.put('settings', { id: 'codingStyle', value: next })
      style = next
      store.set({ codingStyle: next })
      toast(next.enabled ? '风格记忆已启用' : '偏好已保存', { type: 'success' })
    } catch (e) { toast(`保存失败：${e.message}`, { type: 'error' }) }
  }

  mountAppearanceSettings()

  $('#set-chrome-project').checked = chrome.showProject !== false
  $('#set-chrome-session').checked = chrome.showSession !== false
  $('#set-chrome-theme').checked = chrome.showTheme !== false
  $('#set-chrome-connection').checked = chrome.showConnection !== false
  $('#set-save-chrome').onclick = async () => {
    const next = {
      showProject: $('#set-chrome-project').checked,
      showSession: $('#set-chrome-session').checked,
      showTheme: $('#set-chrome-theme').checked,
      showConnection: $('#set-chrome-connection').checked,
    }
    try {
      const res = await saveChrome(next)
      chrome = res?.chrome || next
      toast(res?.degraded ? '窗口外观已本地更新（主进程同步稍后重试）' : '窗口外观已更新', { type: 'success' })
    } catch (e) { toast(`保存失败：${e.message}`, { type: 'error' }) }
  }

  const l2d = (await db.get('settings', 'live2dModel'))?.value || ''
  $('#set-l2d').value = l2d
  $('#set-save-l2d').onclick = async () => {
    const v = $('#set-l2d').value.trim()
    try {
      await db.put('settings', { id: 'live2dModel', value: v })
      toast('Live2D 配置已保存（重启后加载外部模型）', { type: 'success' })
    } catch (e) { toast(`保存失败：${e.message}`, { type: 'error' }) }
  }

  $('#set-replay-welcome').onclick = async () => { await db.put('settings', { id: 'onboarded', value: false }); showWelcome() }
  $('#set-export-all').onclick = async () => {
    const payload = await db.exportAll()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `ccui-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href)
    toast('已导出全部数据', { type: 'success' })
  }
}

function readAppearanceDraft() {
  const $ = id => container.querySelector(id)
  const cleared = $('#set-accent-reset')?.dataset.cleared === '1'
  const fontVal = $('#set-font-family')?.value?.trim()
  return {
    accent: cleared ? null : ($('#set-accent')?.value || null),
    bg: {
      mode: $('#set-bg-mode')?.value || 'default',
      color: $('#set-bg-color')?.value || '#f5f5f7',
      image: $('#set-bg-image')?.value?.trim() || '',
      overlay: (Number($('#set-bg-overlay')?.value) || 42) / 100,
      blur: Number($('#set-bg-blur')?.value) || 0,
    },
    fontFamily: fontVal || null,
    adaptiveText: $('#set-adaptive-text')?.checked !== false,
  }
}

function syncAppearanceRows() {
  const $ = id => container.querySelector(id)
  const mode = $('#set-bg-mode')?.value || 'default'
  container.querySelectorAll('.set-bg-color-row').forEach(el => { el.hidden = mode !== 'color' })
  container.querySelectorAll('.set-bg-image-row').forEach(el => { el.hidden = mode !== 'image' })
}

function updateAppearancePreview() {
  const $ = id => container.querySelector(id)
  const accent = $('#set-accent')?.value
  const preview = $('#appear-preview')
  if (preview && accent) {
    preview.style.setProperty('--preview-accent', accent)
    const dark = document.documentElement.dataset.theme === 'dark'
    const weak = deriveAccentWeak(accent, dark)
    if (weak) preview.style.setProperty('--preview-accent-weak', weak)
  }
}

function previewAppearance() {
  applyPersonalize(readAppearanceDraft())
  updateAppearancePreview()
}

async function getSystemFonts() {
  if (cachedSystemFonts) return cachedSystemFonts
  try {
    if (window.ccui?.listFonts) cachedSystemFonts = await window.ccui.listFonts()
  } catch {}
  if (!cachedSystemFonts?.length) cachedSystemFonts = FONT_FALLBACK
  return cachedSystemFonts
}

function buildFontOptions(fonts, current) {
  const prefer = ['PingFang SC', 'PingFang TC', 'Microsoft YaHei UI', '微软雅黑', 'Segoe UI']
  const sorted = [...new Set([...prefer.filter(f => fonts.includes(f)), ...fonts])]
  if (current && !sorted.includes(current)) sorted.unshift(current)
  return [
    { value: '', label: '默认（苹方）' },
    ...sorted.map(name => ({ value: name, label: name })),
  ]
}

function mountFontSelect(current) {
  const selectEl = container.querySelector('#set-font-family')
  if (!selectEl) return null

  selectEl.innerHTML = '<option value="">默认（苹方）</option>'
  if (current) {
    const opt = document.createElement('option')
    opt.value = current
    opt.textContent = current
    opt.selected = true
    selectEl.appendChild(opt)
  }

  const fontSelect = mountCcSelect('set-font-family', {
    variant: 'form',
    menuPlacement: 'below',
    onChange: () => previewAppearance(),
  })
  fontSelect?.setValue(current || '')

  const expand = () => {
    getSystemFonts().then(fonts => {
      if (!container.isConnected) return
      const options = buildFontOptions(fonts, current)
      selectEl.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('')
      if (current) selectEl.value = current
      fontSelect?.setOptions(options)
      fontSelect?.setValue(current || '')
    })
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(expand, { timeout: 1200 })
  else setTimeout(expand, 50)

  return fontSelect
}

function mountAppearanceSettings() {
  const $ = id => container.querySelector(id)
  const personalize = getPersonalize()

  const defaultAccent = document.documentElement.dataset.theme === 'dark' ? '#e08a6b' : '#d97757'
  const accentInput = $('#set-accent')
  if (accentInput) {
    accentInput.value = personalize.accent || defaultAccent
    accentInput.dataset.cleared = personalize.accent ? '0' : '1'
  }

  $('#set-bg-mode').value = personalize.bg.mode || 'default'
  $('#set-bg-color').value = personalize.bg.color || '#f5f5f7'
  $('#set-bg-image').value = personalize.bg.image || ''
  $('#set-bg-overlay').value = Math.round((personalize.bg.overlay ?? 0.42) * 100)
  $('#set-bg-blur').value = personalize.bg.blur || 0
  $('#set-adaptive-text').checked = personalize.adaptiveText !== false
  $('#set-bg-overlay-v').textContent = `${$('#set-bg-overlay').value}%`
  $('#set-bg-blur-v').textContent = `${$('#set-bg-blur').value}px`
  $('#set-bg-filehint').textContent = personalize.bg.image?.startsWith('data:') ? '已使用本地图片' : '未选择'

  const bgModeSelect = mountCcSelect('set-bg-mode', {
    variant: 'form',
    menuPlacement: 'below',
    onChange: () => { syncAppearanceRows(); previewAppearance() },
  })
  syncAppearanceRows()

  mountFontSelect(personalize.fontFamily || '')

  accentInput?.addEventListener('input', () => {
    $('#set-accent-reset').dataset.cleared = '0'
    previewAppearance()
  })
  $('#set-accent-reset')?.addEventListener('click', () => {
    $('#set-accent-reset').dataset.cleared = '1'
    accentInput.value = defaultAccent
    previewAppearance()
  })
  $('#set-bg-color')?.addEventListener('input', previewAppearance)
  $('#set-bg-image')?.addEventListener('input', previewAppearance)
  $('#set-bg-overlay')?.addEventListener('input', () => {
    $('#set-bg-overlay-v').textContent = `${$('#set-bg-overlay').value}%`
    previewAppearance()
  })
  $('#set-bg-blur')?.addEventListener('input', () => {
    $('#set-bg-blur-v').textContent = `${$('#set-bg-blur').value}px`
    previewAppearance()
  })
  $('#set-adaptive-text')?.addEventListener('change', previewAppearance)

  $('#set-bg-pick')?.addEventListener('click', () => $('#set-bg-file')?.click())
  $('#set-bg-file')?.addEventListener('change', async () => {
    const f = $('#set-bg-file').files?.[0]
    if (!f) return
    if (f.size > 2.5 * 1024 * 1024) {
      toast('图片请小于 2.5MB', { type: 'warn' })
      return
    }
    const data = await new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.onerror = rej
      r.readAsDataURL(f)
    })
    $('#set-bg-image').value = String(data)
    $('#set-bg-filehint').textContent = f.name
    bgModeSelect.setValue('image')
    syncAppearanceRows()
    previewAppearance()
  })

  $('#set-open-theme')?.addEventListener('click', e => {
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('ccui:switch-view', { detail: 'theme' }))
  })

  $('#set-appearance-reset')?.addEventListener('click', async () => {
    const def = DEFAULT_PERSONALIZE()
    await savePersonalize(def)
    mountSettings(container)
    toast('已恢复默认外观', { type: 'success' })
  })

  $('#set-save-appearance')?.addEventListener('click', async () => {
    try {
      await savePersonalize(readAppearanceDraft())
      toast('外观已保存并应用', { type: 'success' })
    } catch (e) { toast(`保存失败：${e.message}`, { type: 'error' }) }
  })

  updateAppearancePreview()
}

// 启动时把已保存配置下发 daemon + 加载风格到 store
export async function applySavedConfig() {
  try {
    const conn = (await db.get('settings', 'connection'))?.value
    if (conn) {
      const patch = {}
      if (conn.baseUrl) patch.ANTHROPIC_BASE_URL = conn.baseUrl
      if (conn.apiKey) patch.ANTHROPIC_API_KEY = conn.apiKey
      if (conn.model) patch.DEEPSEEK_MODEL = conn.model
      if (Object.keys(patch).length) api.setEnv(patch)
    }
    const router = (await db.get('settings', 'router'))?.value
    if (router) api.setRouter(router)
    const style = (await db.get('settings', 'codingStyle'))?.value
    if (style) store.set({ codingStyle: style })
  } catch {}
}

// 把风格记忆拼成系统提示前缀（供 chat 注入）
export function buildStylePrompt(style) {
  if (!style || !style.enabled) return ''
  const parts = []
  if (style.lang) parts.push(`语言偏好：${style.lang}`)
  if (style.fmt) parts.push(`格式约定：${style.fmt}`)
  if (style.rules) parts.push(`其他约定：${style.rules}`)
  if (!parts.length) return ''
  return `以下是用户的长期编码偏好，请在本次及后续输出中始终遵守：\n- ${parts.join('\n- ')}`
}

// ---------- 首次欢迎引导 ----------
export async function maybeWelcome() {
  try {
    const flag = await db.get('settings', 'onboarded')
    if (flag?.value) return
  } catch {}
  showWelcome()
}

export function showWelcome() {
  const back = h('div', 'modal-back')
  back.innerHTML = `
    <div class="modal welcome">
      <h2>欢迎使用 CCui</h2>
      <p class="wl-sub">一个本地优先、可深度定制的 AI 编码工作站。三步上手：</p>
      <ol class="wl-steps">
        <li><b>① 配好连接</b><br/>到「设置」填 API 地址与 Key，不用碰命令行。</li>
        <li><b>② 存个预设</b><br/>在「参数预设」保存常用模型 + 系统提示，<kbd>Ctrl+1~9</kbd> 秒切。</li>
        <li><b>③ 用模板提速</b><br/>输入框打 <code>/</code> 调出提示词模板，<code>{{变量}}</code> 自动填充。</li>
        <li><b>④ Task Brief + 探询分支</b><br/>Composer 开 <kbd>Brief</kbd>（<kbd>Ctrl+Shift+B</kbd>）结构化任务；说不清时 Enter 或点「探询」— Agent 给出 A/B/C 三条假设路径，选最接近的一条写入 Brief 后再发契约。</li>
        <li><b>⑤ 分支与变异</b><br/>悬停用户消息可编辑并<strong>分叉</strong>；<kbd>Ctrl+Shift+E</kbd> 编辑上一条；<kbd>+ Compare</kbd> 同题三路变异 Thread。</li>
        <li><b>⑥ 权限与变更审查</b><br/>工具默认每次询问；「设置 → 工具权限」可设「始终允许」。待审项会进入<strong>变更审查窗</strong>（活动栏 ✓ 图标 / <kbd>Ctrl+Shift+R</kbd>），支持全选批处理允许或拒绝。拖拽文件到输入框可附加 <code>@路径</code>。</li>
      </ol>
      <p class="wl-tip">编辑已发送的消息会自动建立<strong>对话分支</strong>，所有历史在「数据工作室」可搜索导出。</p>
      <div class="wl-actions">
        <button class="btn-ghost" id="wl-skip">跳过</button>
        <button class="btn-primary" id="wl-go">去设置连接</button>
      </div>
    </div>`
  document.body.appendChild(back)
  const close = () => { back.remove(); unregister() }
  const unregister = registerOverlay(back, () => done(false))
  const done = async (go) => {
    try { await db.put('settings', { id: 'onboarded', value: true }) } catch {}
    close()
    if (go) document.querySelector('.act[data-view="settings"]')?.click()
  }
  back.querySelector('#wl-skip').onclick = () => done(false)
  back.querySelector('#wl-go').onclick = () => done(true)
  back.onclick = e => { if (e.target === back) done(false) }
}
