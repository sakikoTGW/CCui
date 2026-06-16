// 背景视差 — 鼠标驱动双层偏移，合成器 transform，无布局抖动
const LERP = 0.075
const BASE_MAX = 14
const GLOW_MAX = 30

let targetX = 0
let targetY = 0
let currentX = 0
let currentY = 0
let raf = 0
let wired = false
let enabled = true

function schedule() {
  if (!enabled || raf) return
  raf = requestAnimationFrame(tick)
}

function tick() {
  raf = 0
  const base = document.querySelector('.app-bg-base')
  const glow = document.querySelector('.app-bg-glow')
  if (!base) return

  currentX += (targetX - currentX) * LERP
  currentY += (targetY - currentY) * LERP

  const bx = currentX * BASE_MAX
  const by = currentY * BASE_MAX
  base.style.transform = `translate3d(${bx.toFixed(2)}px, ${by.toFixed(2)}px, 0)`

  if (glow && !glow.hidden) {
    const gx = currentX * GLOW_MAX
    const gy = currentY * GLOW_MAX
    glow.style.transform = `translate3d(${gx.toFixed(2)}px, ${gy.toFixed(2)}px, 0)`
  }

  if (Math.abs(targetX - currentX) > 0.002 || Math.abs(targetY - currentY) > 0.002) schedule()
}

function setTarget(nx, ny) {
  targetX = nx
  targetY = ny
  schedule()
}

export function resetBgParallax() {
  setTarget(0, 0)
}

export function initBgParallax() {
  if (wired) return
  wired = true

  window.addEventListener('ccui:parallax-pause', e => {
    enabled = e.detail !== true
    if (!enabled) resetBgParallax()
  })

  const app = document.getElementById('appRoot')
  if (!app) return

  app.addEventListener('mousemove', e => {
    const rect = app.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
    setTarget(nx, ny)
  })

  app.addEventListener('mouseleave', () => resetBgParallax())
}
