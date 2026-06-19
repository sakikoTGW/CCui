// Ctrl+Shift+B — 聚焦发送框上方的「这次要做」（Cursor 式任务钉，非独立向导）
export function bindGoalHotkey(handler) {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      handler()
    }
  })
}
