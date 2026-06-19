// 主题编辑器视图已迁移到 React 孤岛 ../../dist/islands.js。
// 保留启动期 restoreCustomStyle(vanilla，被 renderer boot 调用)。
import { db } from '../db.js'

let unmount = null
export async function mountThemeEditor(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountThemeEditor(c)
}

// 应用启动时恢复已保存的自定义 CSS + 圆角
export async function restoreCustomStyle() {
  try {
    const css = await db.get('settings', 'customCss')
    if (css?.value) { const el = document.createElement('style'); el.id = 'user-custom-css'; el.textContent = css.value; document.head.appendChild(el) }
    const r = await db.get('settings', 'radius')
    if (r?.value) document.documentElement.style.setProperty('--radius', `${r.value}px`)
  } catch {}
}
