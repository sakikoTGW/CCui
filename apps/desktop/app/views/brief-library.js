// 简报库视图已迁移到 React 孤岛 ../../dist/islands.js。
let unmount = null

export async function mountBriefLibrary(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountBriefLibrary(c)
}
