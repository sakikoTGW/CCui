// 视图切换 — opacity + 轻微位移/缩放交叉过渡（合成器属性，无重排闪屏）
// 进入视图 transform 比淡入略长 60ms，等待时长取其上限，收尾后再撤堆叠层
export const VIEW_FADE_MS = 300

/** @typedef {{ el: HTMLElement|null, mounted: boolean, mount: (el: HTMLElement) => unknown, keepAlive?: boolean }} ViewDef */

/**
 * @param {Record<string, ViewDef>} views
 * @param {HTMLElement|null} host
 * @param {string} name
 * @param {{ fromName: string, fromEl: HTMLElement|null, reduceMotion: boolean, onLayoutPrepare?: (name: string) => void, onLayout: (name: string) => void, onReady?: (name: string) => void }} ctx
 */
export async function runViewTransition(views, host, name, ctx) {
  const def = views[name]
  if (!def || !host) return { name, el: null }

  if (!def.el) {
    def.el = document.createElement('div')
    def.el.className = `view view-${name}`
    host.appendChild(def.el)
  }

  if (!def.mounted || !def.keepAlive) {
    def.el.style.display = 'none'
    def.el.classList.remove('is-current', 'is-leaving')
    await Promise.resolve(def.mount(def.el))
    def.mounted = true
  }

  const fromEl = ctx.fromEl
  const sameEl = fromEl === def.el

  for (const v of Object.values(views)) {
    if (!v.el || v.el === def.el || v.el === fromEl) continue
    v.el.style.display = 'none'
    v.el.classList.remove('is-current', 'is-leaving')
  }

  def.el.style.display = ''

  ctx.onLayoutPrepare?.(name)

  if (ctx.reduceMotion || !fromEl || sameEl) {
    if (fromEl && !sameEl) {
      fromEl.classList.remove('is-current', 'is-leaving')
      fromEl.style.display = 'none'
    }
    host.classList.remove('view-stack')
    def.el.classList.remove('is-leaving')
    def.el.classList.add('is-current')
    ctx.onLayout(name)
    ctx.onReady?.(name)
    return { name, el: def.el }
  }

  host.classList.add('view-stack')

  fromEl.style.display = ''
  fromEl.classList.remove('is-current')
  fromEl.classList.add('is-leaving')

  def.el.classList.remove('is-leaving')
  def.el.classList.remove('is-current')
  void def.el.offsetWidth
  def.el.classList.add('is-current')

  await new Promise(resolve => setTimeout(resolve, VIEW_FADE_MS))

  fromEl.classList.remove('is-leaving')
  fromEl.style.display = 'none'
  host.classList.remove('view-stack')

  ctx.onLayout(name)
  ctx.onReady?.(name)
  return { name, el: def.el }
}

/**
 * 空闲时预挂载视图，首次进入不再阻塞交叉淡入
 * @param {Record<string, ViewDef>} views
 * @param {HTMLElement|null} host
 * @param {string} name
 */
export async function warmView(views, host, name) {
  const def = views[name]
  if (!def || !host || def.mounted) return
  if (!def.el) {
    def.el = document.createElement('div')
    def.el.className = `view view-${name}`
    def.el.style.display = 'none'
    host.appendChild(def.el)
  }
  try {
    await Promise.resolve(def.mount(def.el))
    def.mounted = true
    def.el.style.display = 'none'
    def.el.classList.remove('is-current', 'is-leaving')
  } catch {
    def.el.remove()
    def.el = null
    def.mounted = false
  }
}
