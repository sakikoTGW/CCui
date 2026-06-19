// 提示词模板引擎 + 模板管理视图
// 1) 对话输入框键入 "/" 弹模板菜单，选中插入带 {{变量}} 的模板
// 2) 动态变量 {{date}} {{time}} {{clipboard}} {{selected_text}} 自动求值
// 3) 未填占位用 [[var]] 标记，Tab 在占位间跳转
// 管理视图(列表/增删改)已迁移到 React 孤岛 ../../dist/islands.js。
// 此文件仅保留对话输入框的模板引擎(/ 菜单 + 占位跳转)与 getTemplates。
import { store } from '../store.js'
import { db } from '../db.js'

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

const DEFAULT_TEMPLATES = [
  { id: 'tpl_review', name: '代码审查', body: '请审查以下代码的 bug、安全和性能问题：\n\n{{selected_text}}' },
  { id: 'tpl_explain', name: '解释代码', body: '用通俗语言解释这段代码做什么：\n\n{{clipboard}}' },
  { id: 'tpl_commit', name: '生成提交信息', body: '基于当前改动生成一条 Conventional Commits 提交信息。日期：{{date}}' },
  { id: 'tpl_refactor', name: '重构建议', body: '请给出重构建议，目标：{{目标}}。约束：{{约束}}' },
]

export async function getTemplates() {
  let list = []
  try { list = await db.getAll('templates') } catch {}
  if (!list.length) {
    for (const t of DEFAULT_TEMPLATES) { try { await db.put('templates', { ...t, createdAt: Date.now() }) } catch {} }
    list = DEFAULT_TEMPLATES.map(t => ({ ...t }))
  }
  store.set({ templates: list })
  return list
}

// 求值动态变量；用户自定义变量 {{xxx}} 转为 [[xxx]] 占位
async function expand(body) {
  const now = new Date()
  let clip = ''
  try { clip = await navigator.clipboard.readText() } catch {}
  const selected = (window.getSelection && String(window.getSelection())) || ''
  const dynamic = {
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    clipboard: clip,
    selected_text: selected,
  }
  return body.replace(/\{\{(\s*[\w\u4e00-\u9fa5]+\s*)\}\}/g, (_, raw) => {
    const key = raw.trim()
    if (key in dynamic) return dynamic[key]
    return `[[${key}]]` // 待填占位
  })
}

// 把模板插入到 textarea，并定位到第一个 [[占位]]
async function insertTemplate(textarea, body) {
  const text = await expand(body)
  textarea.value = text
  textarea.dispatchEvent(new Event('input'))
  focusNextPlaceholder(textarea, 0)
  textarea.classList.toggle('has-placeholder', /\[\[.+?\]\]/.test(text))
}

function focusNextPlaceholder(textarea, from) {
  const m = /\[\[(.+?)\]\]/g
  m.lastIndex = from
  const found = m.exec(textarea.value)
  if (found) {
    textarea.focus()
    textarea.setSelectionRange(found.index, found.index + found[0].length)
    return true
  }
  return false
}

// 绑定到对话输入框：/ 菜单 + Tab 跳占位
export function attachTemplateEngine(textarea) {
  let menu = null
  const closeMenu = () => { if (menu) { menu.remove(); menu = null } }

  textarea.addEventListener('keydown', async e => {
    // Tab：跳到下一个占位（有占位时拦截）
    if (e.key === 'Tab' && /\[\[.+?\]\]/.test(textarea.value)) {
      e.preventDefault()
      const end = textarea.selectionEnd || 0
      if (!focusNextPlaceholder(textarea, end)) focusNextPlaceholder(textarea, 0)
      return
    }
    if (menu) {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return }
      if (e.key === 'Enter') {
        const act = menu.querySelector('.tpl-item.active')
        if (act) { e.preventDefault(); act.click(); return }
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [...menu.querySelectorAll('.tpl-item')]
        let i = items.findIndex(x => x.classList.contains('active'))
        items[i]?.classList.remove('active')
        i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
        items[i]?.classList.add('active')
        items[i]?.scrollIntoView({ block: 'nearest' })
        return
      }
    }
  })

  async function openTplMenu(query = '') {
    const list = await getTemplates()
    const q = query.toLowerCase()
    const filtered = q ? list.filter(t => t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)) : list
    if (!menu) {
      menu = h('div', 'tpl-menu')
      const comp = textarea.closest('.composer-inner')?.parentElement || textarea.closest('.composer') || textarea.parentElement
      comp.style.position = 'relative'
      comp.appendChild(menu)
    }
    menu.innerHTML = ''
    if (!filtered.length) menu.appendChild(h('div', 'tpl-empty', q ? '无匹配模板' : '暂无模板'))
    filtered.forEach((t, idx) => {
      const item = h('div', 'tpl-item' + (idx === 0 ? ' active' : ''))
      item.innerHTML = `<span class="tpl-name"></span><span class="tpl-prev"></span>`
      item.querySelector('.tpl-name').textContent = t.name
      item.querySelector('.tpl-prev').textContent = t.body.slice(0, 36).replace(/\n/g, ' ')
      item.onclick = async () => { closeMenu(); await insertTemplate(textarea, t.body) }
      menu.appendChild(item)
    })
  }

  textarea.addEventListener('input', async () => {
    textarea.classList.toggle('has-placeholder', /\[\[.+?\]\]/.test(textarea.value))
    const val = textarea.value
    if (/^\//.test(val)) {
      await openTplMenu(val.slice(1))
    } else if (menu) {
      closeMenu()
    }
  })

  textarea.addEventListener('blur', () => setTimeout(closeMenu, 150))
}

// ---------- 模板管理视图(React 孤岛) ----------
let unmountTpl = null
export async function mountTemplates(c) {
  if (unmountTpl) { try { unmountTpl() } catch {} unmountTpl = null }
  const mod = await import('../../dist/islands.js')
  unmountTpl = mod.mountTemplates(c)
}
