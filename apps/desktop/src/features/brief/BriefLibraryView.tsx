import { useEffect, useRef, useState } from 'react'
import { idb } from '../../data/idb'
import { toast } from '../../shell/store-bridge'
import { confirmPopover, hostBrief } from '../../shell/host'
import { bus } from '../../shell/bus'

interface BriefItem {
  id: string
  title?: string
  outcome?: string
  problem?: string
  domains?: string[]
  savedAt?: number
  updatedAt?: number
  [k: string]: unknown
}

const LIBRARY_ID = 'briefLibrary'

async function listLibrary(): Promise<BriefItem[]> {
  const row = await idb.get<{ id: string; value: BriefItem[] }>('settings', LIBRARY_ID).catch(() => undefined)
  return row?.value ?? []
}
async function deleteFromLibrary(id: string): Promise<void> {
  const lib = (await listLibrary()).filter((x) => x.id !== id)
  await idb.put('settings', { id: LIBRARY_ID, value: lib })
}

function applyBrief(b: BriefItem) {
  const n = hostBrief()?.normalize(b) ?? b
  bus.emit('switch-view', 'chat')
  bus.emit('apply-brief', n)
  toast('已载入 Brief 到 Composer', { type: 'success' })
}

export function BriefLibraryView() {
  const [items, setItems] = useState<BriefItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const delBtns = useRef(new Map<string, HTMLButtonElement>())

  const refresh = async () => {
    setItems(await listLibrary())
    setLoaded(true)
  }
  useEffect(() => {
    refresh()
  }, [])

  const onDelete = (b: BriefItem) => {
    confirmPopover(delBtns.current.get(b.id) ?? null, '删除此简报？', async () => {
      await deleteFromLibrary(b.id)
      toast('已删除', { type: 'success' })
      await refresh()
    })
  }

  const meta = (b: BriefItem) => {
    const labels = hostBrief()?.domainLabels(b.domains ?? []) ?? b.domains ?? []
    const pct = hostBrief()?.assess(b).pct ?? 0
    const when = new Date(b.savedAt || b.updatedAt || Date.now()).toLocaleString()
    return `${labels.join(' · ') || '—'} · ${pct}% · ${when}`
  }

  return (
    <>
      <div className="view-head">
        <h1>简报库</h1>
        <p className="vh-sub">Task Brief — 结构化任务规格，从 Composer 存库或在此复用到新 Thread。</p>
      </div>
      <div className="brief-lib-list">
        {loaded && items.length === 0 && (
          <div className="brief-lib-empty">暂无简报。在对话 Composer 开启 Brief 模式，填写后点「存库」。</div>
        )}
        {items.map((b) => (
          <div className="brief-lib-row" key={b.id}>
            <div className="bl-main">
              <div className="bl-title">{b.title || '未命名'}</div>
              <div className="bl-meta">{meta(b)}</div>
              <div className="bl-outcome">{b.outcome || b.problem || ''}</div>
            </div>
            <div className="bl-actions">
              <button type="button" className="btn-ghost bl-use" onClick={() => applyBrief(b)}>用到对话</button>
              <button
                type="button"
                className="btn-ghost bl-del"
                ref={(el) => { if (el) delBtns.current.set(b.id, el); else delBtns.current.delete(b.id) }}
                onClick={() => onDelete(b)}
              >删除</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
