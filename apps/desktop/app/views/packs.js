// 整合包视图：薄 shim，动态挂载 React PackView（孤岛在 ../../dist/islands.js）。
let unmount = null

export async function mountPacks(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountPacks(c)
}
