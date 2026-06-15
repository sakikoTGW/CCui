/**
 * 终端进度条 — 解析子进程 CCUI_PROGRESS:n:label 行并渲染
 */
import type { Writable } from 'node:stream'

const BAR_WIDTH = 32

export type StartupProgressBar = {
  update: (percent: number, label: string) => void
  tick: () => void
  finish: (label?: string) => void
  stop: () => void
}

export function createStartupProgressBar(
  stream: Writable = process.stderr,
): StartupProgressBar {
  let percent = 0
  let label = '启动中…'
  let stopped = false
  let indeterminate = true

  const render = (): void => {
    if (stopped) return
    const filled = Math.round((percent / 100) * BAR_WIDTH)
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
    stream.write(`\r[${bar}] ${String(percent).padStart(3)}% ${label}   `)
  }

  const timer = setInterval(() => {
    if (!indeterminate || stopped) return
    if (percent < 28) {
      percent += 1
      render()
    }
  }, 400)

  return {
    update(nextPercent: number, nextLabel: string) {
      indeterminate = false
      percent = Math.min(100, Math.max(percent, Math.round(nextPercent)))
      label = nextLabel
      render()
    },
    tick() {
      if (!indeterminate || percent >= 28) return
      percent += 1
      render()
    },
    finish(doneLabel = '就绪') {
      stopped = true
      clearInterval(timer)
      percent = 100
      label = doneLabel
      render()
      stream.write('\n')
    },
    stop() {
      stopped = true
      clearInterval(timer)
      stream.write('\n')
    },
  }
}

export function feedProgressLine(
  line: string,
  bar: StartupProgressBar,
): 'ready' | 'progress' | 'ignore' {
  const trimmed = line.trim()
  if (trimmed === 'CCUI_READY') {
    bar.finish('REPL 已就绪')
    return 'ready'
  }
  if (!trimmed.startsWith('CCUI_PROGRESS:')) return 'ignore'
  const rest = trimmed.slice('CCUI_PROGRESS:'.length)
  const colon = rest.indexOf(':')
  if (colon <= 0) return 'ignore'
  const pct = Number.parseInt(rest.slice(0, colon), 10)
  const text = rest.slice(colon + 1)
  if (!Number.isFinite(pct) || !text) return 'ignore'
  bar.update(pct, text)
  return 'progress'
}
