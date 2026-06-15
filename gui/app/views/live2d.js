// Live2D 全局助手 — 右下角悬浮，随 busy 状态切换动作
import { store } from '../store.js'

let root = null
let canvas = null
let ctx = null
let frame = 0
let mood = 'idle' // idle | think | talk
let unsub = null

const COLORS = {
  idle: ['#f3e4dd', '#d97757'],
  think: ['#e8eef8', '#5b7cfa'],
  talk: ['#fdf4f1', '#e08a6b'],
}

export function initLive2D() {
  if (root) return
  root = document.createElement('div')
  root.className = 'l2d-root l2d-hidden'
  root.innerHTML = `
    <canvas id="l2dCanvas" width="180" height="220"></canvas>
    <div class="l2d-tip" id="l2dTip">CCui 助手</div>
    <button class="l2d-hide" title="隐藏">−</button>`
  document.body.appendChild(root)
  canvas = root.querySelector('#l2dCanvas')
  ctx = canvas.getContext('2d')
  root.querySelector('.l2d-hide').onclick = e => {
    e.stopPropagation()
    root.classList.toggle('l2d-hidden')
    root.classList.remove('l2d-active')
  }
  root.onclick = e => {
    if (e.target === root || e.target === canvas) root.classList.toggle('l2d-hidden')
  }

  unsub = store.subscribe(s => {
    const next = s.busy || s.orchBusy ? (s.busy ? 'talk' : 'think') : 'idle'
    if (next !== mood) { mood = next; updateTip(s) }
    root?.classList.toggle('l2d-active', !!(s.busy || s.orchBusy))
  })
  requestAnimationFrame(tick)
  loadExternalModel().catch(() => {})
}

function updateTip(s) {
  const tip = root.querySelector('#l2dTip')
  if (!tip) return
  tip.textContent = s.busy ? '思考中…' : s.orchBusy ? '编排中…' : 'CCui 助手'
}

function tick() {
  frame++
  drawCharacter()
  requestAnimationFrame(tick)
}

function drawCharacter() {
  if (!ctx) return
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const [bg, accent] = COLORS[mood]
  // 身体
  ctx.fillStyle = bg
  ctx.beginPath()
  ctx.ellipse(w / 2, h - 30, 55, 70, 0, 0, Math.PI * 2)
  ctx.fill()
  // 头
  const bob = Math.sin(frame / 20) * (mood === 'idle' ? 3 : 6)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(w / 2, 78 + bob, 48, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  ctx.stroke()
  // 眼
  const blink = frame % 180 < 4
  ctx.fillStyle = '#333'
  if (blink) {
    ctx.fillRect(w / 2 - 22, 72 + bob, 14, 2)
    ctx.fillRect(w / 2 + 8, 72 + bob, 14, 2)
  } else {
    ctx.beginPath(); ctx.arc(w / 2 - 15, 74 + bob, mood === 'talk' ? 5 : 4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(w / 2 + 15, 74 + bob, mood === 'talk' ? 5 : 4, 0, Math.PI * 2); ctx.fill()
  }
  // 嘴
  ctx.strokeStyle = accent
  ctx.beginPath()
  if (mood === 'talk') {
    ctx.ellipse(w / 2, 92 + bob, 8, 5 + Math.sin(frame / 8) * 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.arc(w / 2, 90 + bob, 6, 0.1 * Math.PI, 0.9 * Math.PI)
    ctx.stroke()
  }
  // 状态环
  if (mood !== 'idle') {
    ctx.strokeStyle = accent + '66'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(w / 2, 78 + bob, 54, 0, (frame / 30) % (Math.PI * 2))
    ctx.stroke()
  }
}

/** 可选：加载外部 Live2D model.json（settings 配置路径时） */
async function loadExternalModel() {
  // 预留 cubism / pixi-live2d 接入点；当前为轻量 canvas 替身，保证零依赖可运行
  const cfg = await import('../db.js').then(m => m.db.get('settings', 'live2dModel')).catch(() => null)
  if (cfg?.value) {
    const tip = root.querySelector('#l2dTip')
    if (tip) tip.title = `模型：${cfg.value}`
  }
}

export function destroyLive2D() {
  if (unsub) unsub()
  root?.remove()
  root = null
}
