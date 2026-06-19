// 变更审查视图已迁移到 React 孤岛 ../../dist/islands.js。
// 队列单一真相仍在 review-queue.js；孤岛经 window.ccuiReview 桥读写。
let unmount = null

export async function mountReview(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountReview(c)
}
