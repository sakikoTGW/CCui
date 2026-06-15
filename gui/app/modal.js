// 统一浮层栈 + 全局 Esc 关闭
const stack = []

export function registerOverlay(el, closeFn) {
  stack.push({ el, close: closeFn })
  return () => {
    const i = stack.findIndex(x => x.el === el)
    if (i >= 0) stack.splice(i, 1)
  }
}

export function closeTopOverlay() {
  const top = stack[stack.length - 1]
  if (top) { top.close(); return true }
  return false
}

export function initGlobalEsc() {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (closeTopOverlay()) { e.preventDefault(); return }
    const fp = document.querySelector('.filepanel.open')
    if (fp) { fp.classList.remove('open'); document.getElementById('treeToggle')?.classList.remove('act-on'); e.preventDefault() }
  })
}

export function openModal(html, { onClose, className = '' } = {}) {
  const back = document.createElement('div')
  back.className = 'modal-overlay'
  back.innerHTML = `<div class="modal ${className}">${html}</div>`
  document.body.appendChild(back)
  requestAnimationFrame(() => back.classList.add('show'))
  const close = () => {
    back.classList.remove('show')
    back.addEventListener('transitionend', () => back.remove(), { once: true })
    unregister()
    onClose?.()
  }
  const unregister = registerOverlay(back, close)
  back.addEventListener('click', e => { if (e.target === back) close() })
  return { el: back.querySelector('.modal'), close, back }
}
