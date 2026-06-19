// 扩展（插件宿主）视图为 React 孤岛 ../../dist/islands.js。
// 此文件仅薄 shim：动态挂载/卸载 React PluginHost。
let unmount = null

export async function mountPlugins(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountPlugins(c)
}
