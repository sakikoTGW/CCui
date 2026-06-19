// Markdown 解析 + 代码高亮。无业务状态，仅依赖 ctx.els 做"重刷可见代码块"。
import { marked } from '../../../node_modules/marked/lib/marked.esm.js'
import hljs from '../../../vendor/hljs.js'
import { ctx } from './ctx.js'

// 语言已在 vendor/hljs.js bundle 内注册
marked.setOptions({ breaks: true, gfm: true })

export function rehighlightCodeBlock(codeEl) {
  if (!codeEl) return
  const langClass = [...codeEl.classList].find(c => c.startsWith('language-'))
  const text = codeEl.textContent || ''
  codeEl.removeAttribute('data-highlighted')
  codeEl.className = langClass || ''
  codeEl.textContent = text
  try { hljs.highlightElement(codeEl) } catch {}
}

export function renderMarkdown(el, text) {
  el.innerHTML = marked.parse(text || '')
  el.querySelectorAll('script').forEach(s => s.remove())
  el.querySelectorAll('pre code').forEach(rehighlightCodeBlock)
}

export function rehighlightVisibleCode() {
  ctx.els?.messages?.querySelectorAll('pre code').forEach(rehighlightCodeBlock)
}
