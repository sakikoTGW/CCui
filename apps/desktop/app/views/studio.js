// 数据工作室视图已迁移到 React 孤岛 ../../dist/islands.js。
// 分支树/遮罩/打开会话/全量导出经 window.ccuiStudio 桥复用 vanilla。
let unmount = null

export async function mountStudio(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountStudio(c)
}
