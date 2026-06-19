import { useEffect, useState } from 'react'
import { bus } from '../../shell/bus'

/**
 * 变更审查孤岛。队列单一真相在 vanilla review-queue（由 chat.js enqueue / 主进程
 * onReviewAction 维护），孤岛经 window.ccuiReview 桥读取与批处理，并订阅 typed bus
 * 的 `review-queue` 事件实时刷新——避免把 review-queue 模块打包进来导致状态分裂。
 */

interface ReviewItem {
  id: string
  kind: 'permission' | 'diff'
  toolName?: string
  message?: string
  path?: string
  oldStr?: string
  newStr?: string
  selected?: boolean
}

function reviewBridge() {
  return (globalThis as unknown as { ccuiReview?: Window['ccuiReview'] }).ccuiReview
}

function DiffBlock({ oldStr, newStr }: { oldStr?: string; newStr?: string }) {
  return (
    <div className="rv-diff">
      {oldStr &&
        String(oldStr).split('\n').slice(0, 80).map((line, i) => (
          <div className="del" key={`d${i}`}>- {line}</div>
        ))}
      {newStr &&
        String(newStr).split('\n').slice(0, 80).map((line, i) => (
          <div className="add" key={`a${i}`}>+ {line}</div>
        ))}
    </div>
  )
}

export function ReviewView() {
  const [queue, setQueue] = useState<ReviewItem[]>([])

  useEffect(() => {
    const sync = (items: ReviewItem[]) =>
      setQueue((items || []).map((x) => ({ ...x, selected: x.selected !== false })))
    sync((reviewBridge()?.getAll() as ReviewItem[]) ?? [])
    return bus.on('review-queue', (items) => sync((items as ReviewItem[]) ?? []))
  }, [])

  const respond = (ids: string[], allow: boolean, alwaysAllow = false) => {
    if (!ids.length) return
    reviewBridge()?.respondBatch(ids, allow, { alwaysAllow })
  }
  const selectedIds = () => queue.filter((x) => x.selected !== false).map((x) => x.id)
  const toggleSel = (id: string, sel: boolean) =>
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, selected: sel } : x)))
  const selectAll = () => {
    const allOn = queue.every((x) => x.selected !== false)
    setQueue((q) => q.map((x) => ({ ...x, selected: !allOn })))
  }

  const n = queue.length

  return (
    <div className="review-app">
      <header className="review-head">
        <div className="review-head-left">
          <h1>变更审查</h1>
          <span className="review-count">{n} 待处理</span>
        </div>
        <div className="review-head-actions">
          <button type="button" className="rv-btn" onClick={selectAll}>全选</button>
          <button type="button" className="rv-btn rv-primary" onClick={() => respond(selectedIds(), true)}>允许所选</button>
          <button type="button" className="rv-btn rv-danger" onClick={() => respond(selectedIds(), false)}>拒绝所选</button>
          <span className="review-sep" />
          <button type="button" className="rv-btn rv-primary" onClick={() => respond(queue.map((x) => x.id), true)}>全部允许</button>
          <button type="button" className="rv-btn rv-danger" onClick={() => respond(queue.map((x) => x.id), false)}>全部拒绝</button>
        </div>
      </header>
      <div className="review-empty" hidden={n > 0}>
        暂无待审查项。Agent 请求工具权限或产生文件 diff 时会出现在这里。
      </div>
      <div className="review-list">
        {queue.map((item) => {
          const sel = item.selected !== false
          const kindLabel = item.kind === 'diff' ? '文件变更' : '工具授权'
          const title = item.path || item.toolName || '—'
          return (
            <article className={`rv-card${sel ? ' rv-selected' : ''}`} key={item.id} data-id={item.id}>
              <div className="rv-card-head">
                <input type="checkbox" checked={sel} onChange={(e) => toggleSel(item.id, e.target.checked)} />
                <div className="rv-card-meta">
                  <div className="rv-kind">{kindLabel}</div>
                  <div className="rv-title">{title}</div>
                  {item.message && <div className="rv-msg">{item.message}</div>}
                </div>
                <div className="rv-card-actions">
                  <button type="button" className="rv-btn rv-primary" onClick={() => respond([item.id], true)}>
                    {item.kind === 'diff' ? '接受' : '允许'}
                  </button>
                  <button type="button" className="rv-btn rv-danger" onClick={() => respond([item.id], false)}>拒绝</button>
                </div>
              </div>
              {item.kind === 'diff' && (item.oldStr || item.newStr) && (
                <DiffBlock oldStr={item.oldStr} newStr={item.newStr} />
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
