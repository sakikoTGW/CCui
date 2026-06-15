// 文件面板：右侧抽屉，懒加载目录树 + 文件预览（含代码高亮）
import { marked } from '../../node_modules/marked/lib/marked.esm.js'
import hljs from '../../vendor/hljs.js'
import { api } from '../api.js'
import { toast } from '../ui.js'
import { ICONS } from '../icons.js'

let panel = null
let treeEl = null
let previewEl = null
let crumbEl = null
let rootPath = ''
let openDirs = new Set()
let selectedPath = null
const dirCache = new Map() // path -> entries

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

export function initFileTree() {
  panel = h('aside', 'filepanel')
  panel.innerHTML = `
    <div class="fp-head">
      <span class="fp-title">文件</span>
      <button class="fp-refresh" title="刷新"></button>
      <button class="fp-close" title="关闭"></button>
    </div>
    <div class="fp-crumb" id="fpCrumb"></div>
    <div class="fp-body">
      <div class="fp-tree" id="fpTree"></div>
      <div class="fp-preview" id="fpPreview"><div class="fp-empty">选择左侧文件预览</div></div>
    </div>`
  document.body.appendChild(panel)
  treeEl = panel.querySelector('#fpTree')
  previewEl = panel.querySelector('#fpPreview')
  crumbEl = panel.querySelector('#fpCrumb')
  panel.querySelector('.fp-refresh').innerHTML = ICONS.refresh
  panel.querySelector('.fp-close').innerHTML = ICONS.close
  panel.querySelector('.fp-close').onclick = close
  panel.querySelector('.fp-refresh').onclick = () => { dirCache.clear(); loadRoot(true) }

  document.getElementById('treeToggle')?.addEventListener('click', toggle)
  document.addEventListener('mousedown', onOutsidePointer)
  window.addEventListener('ccui:openfile', e => { open(); revealAndPreview(e.detail?.path) })
  window.addEventListener('ccui:hljs-theme', () => {
    previewEl?.querySelectorAll('pre code').forEach(rehighlightCodeBlock)
  })
  window.addEventListener('ccui:theme-changed', () => {
    previewEl?.querySelectorAll('pre code').forEach(rehighlightCodeBlock)
  })
  window.addEventListener('ccui:project-changed', () => {
    rootPath = ''
    dirCache.clear()
    openDirs = new Set()
    selectedPath = null
    if (panel?.classList.contains('open')) loadRoot(true)
  })
}

function onOutsidePointer(e) {
  if (!panel?.classList.contains('open')) return
  const t = e.target
  if (!(t instanceof Node)) return
  if (panel.contains(t)) return
  if (t instanceof Element && t.closest('#treeToggle')) return
  close()
}

function toggle() {
  const btn = document.getElementById('treeToggle')
  if (panel.classList.contains('open')) close()
  else open()
}
function open() {
  panel.classList.add('open')
  document.getElementById('treeToggle')?.classList.add('nav-util-on')
  if (!rootPath) loadRoot()
}
function close() {
  panel.classList.remove('open')
  document.getElementById('treeToggle')?.classList.remove('nav-util-on')
}

async function loadRoot(force) {
  try {
    const res = await api.request({ cmd: 'listDir' })
    rootPath = res.root || res.path
    dirCache.set(res.path, res.entries)
    openDirs = new Set([res.path])
    crumbEl.textContent = rootPath
    renderTree()
    if (force) toast('已刷新文件树', { type: 'success' })
  } catch (e) {
    treeEl.innerHTML = `<div class="fp-empty">加载失败：${e.message}</div>`
  }
}

async function ensureDir(path) {
  if (dirCache.has(path)) return dirCache.get(path)
  const res = await api.request({ cmd: 'listDir', path })
  dirCache.set(path, res.entries)
  return res.entries
}

function renderTree() {
  treeEl.innerHTML = ''
  renderLevel(rootPath, 0)
}

function renderLevel(dirPath, depth) {
  const entries = dirCache.get(dirPath) || []
  for (const e of entries) {
    const node = h('div', 'fp-node' + (e.path === selectedPath ? ' sel' : ''))
    node.style.paddingLeft = `${10 + depth * 14}px`
    const isOpen = openDirs.has(e.path)
    const ic = e.type === 'dir' ? `<span class="tw ${isOpen ? 'open' : ''}">›</span>${ICONS.folder}` : ICONS.file
    node.innerHTML = `<span class="ic">${ic}</span><span class="nm"></span>`
    node.querySelector('.nm').textContent = e.name
    node.onclick = async () => {
      if (e.type === 'dir') {
        if (openDirs.has(e.path)) openDirs.delete(e.path)
        else { openDirs.add(e.path); await ensureDir(e.path) }
        renderTree()
      } else {
        selectedPath = e.path
        renderTree()
        preview(e.path)
      }
    }
    treeEl.appendChild(node)
    if (e.type === 'dir' && isOpen) renderLevel(e.path, depth + 1)
  }
}

const EXT_LANG = { js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript', json: 'json', md: 'markdown', mdc: 'markdown', css: 'css', html: 'xml', sh: 'bash', py: 'python', rs: 'rust', go: 'go', yml: 'yaml', yaml: 'yaml', sql: 'sql', toml: 'ini' }

function rehighlightCodeBlock(codeEl) {
  if (!codeEl) return
  const langClass = [...codeEl.classList].find(c => c.startsWith('language-'))
  const text = codeEl.textContent || ''
  codeEl.removeAttribute('data-highlighted')
  codeEl.className = langClass || ''
  codeEl.textContent = text
  try { hljs.highlightElement(codeEl) } catch {}
}

async function preview(path) {
  previewEl.innerHTML = '<div class="fp-empty">加载中…</div>'
  crumbEl.textContent = path
  try {
    const res = await api.request({ cmd: 'readFile', path }, 20000)
    const ext = (path.split('.').pop() || '').toLowerCase()
    if (ext === 'md' || ext === 'mdc') {
      const div = h('div', 'bubble md')
      div.style.padding = '14px 18px'
      div.innerHTML = marked.parse(res.content || '')
      div.querySelectorAll('pre code').forEach(rehighlightCodeBlock)
      previewEl.innerHTML = ''
      previewEl.appendChild(div)
    } else {
      const pre = h('pre')
      const code = h('code')
      code.textContent = res.content || ''
      const lang = EXT_LANG[ext]
      if (lang) { code.className = `language-${lang}`; rehighlightCodeBlock(code) }
      pre.appendChild(code)
      previewEl.innerHTML = ''
      previewEl.appendChild(pre)
    }
    if (res.truncated) previewEl.appendChild(h('div', 'fp-empty', res.tooLarge ? '（文件过大，仅显示前 200KB）' : '（已截断）'))
  } catch (e) {
    previewEl.innerHTML = `<div class="fp-empty">读取失败：${e.message}</div>`
  }
}

// 由控制台「查看文件」触发：展开父目录链并预览
async function revealAndPreview(path) {
  if (!path) return
  if (!rootPath) await loadRoot()
  // 若在根目录树范围内，逐级展开父链
  if (rootPath && path.startsWith(rootPath)) {
    const rest = path.slice(rootPath.length).replace(/^[\\/]/, '')
    const parts = rest.split(/[\\/]/)
    let cur = rootPath
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur + (cur.endsWith('\\') || cur.endsWith('/') ? '' : '\\') + parts[i]
      openDirs.add(cur)
      try { await ensureDir(cur) } catch {}
    }
    selectedPath = path
    renderTree()
  }
  preview(path)
}
