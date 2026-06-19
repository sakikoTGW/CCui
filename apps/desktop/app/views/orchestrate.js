// Compare 跳转面板已迁移到 React 孤岛。并行编排 API(runCompare 等)仍在 parallel.js。
let unmount = null

export async function mountOrchestrate(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountOrchestrate(c)
}
