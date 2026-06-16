// 启动屏 — 独立浮层，不修改 #appRoot 的 transition，避免挤掉边栏/页面动画
import { getPersonalize } from './theme-personalize.js'

const MIN_MS = 480
const FADE_MS = 480

let shownAt = performance.now()
let finishing = false

export function markBootSplashStart() {
  shownAt = performance.now()
}

async function waitForResources() {
  const jobs = []

  if (document.fonts?.ready) jobs.push(document.fonts.ready.catch(() => {}))

  const bg = getPersonalize()?.bg
  if (bg?.mode === 'image' && bg.image) {
    jobs.push(new Promise(resolve => {
      const img = new Image()
      if (!bg.image.startsWith('data:')) img.crossOrigin = 'anonymous'
      const t = setTimeout(resolve, 1600)
      img.onload = img.onerror = () => { clearTimeout(t); resolve() }
      img.src = bg.image
    }))
  }

  jobs.push(new Promise(resolve => {
    if (document.readyState === 'complete') resolve()
    else window.addEventListener('load', () => resolve(), { once: true })
  }))

  await Promise.race([
    Promise.all(jobs),
    new Promise(r => setTimeout(r, 2000)),
  ])
}

function waitTransition(el, ms) {
  return new Promise(resolve => {
    const done = () => resolve()
    el.addEventListener('transitionend', done, { once: true })
    setTimeout(done, ms + 60)
  })
}

/** 资源就绪后淡出启动层；不触碰 .app / #appRoot 样式 */
export async function finishBootSplash() {
  if (finishing) return
  finishing = true

  const splash = document.getElementById('bootSplash')
  if (!splash) return

  const elapsed = performance.now() - shownAt
  if (elapsed < MIN_MS) {
    await new Promise(r => setTimeout(r, MIN_MS - elapsed))
  }

  await waitForResources()

  splash.classList.add('is-hiding')
  splash.setAttribute('aria-hidden', 'true')

  await waitTransition(splash, FADE_MS)
  splash.remove()
}
