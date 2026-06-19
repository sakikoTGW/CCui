// 项目管理视图已迁移到 React 孤岛 ../../dist/islands.js。
// 此文件仅保留薄 shim：动态挂载/卸载 React ProjectsView。
let unmount = null

export async function mountProjects(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountProjects(c)
}
