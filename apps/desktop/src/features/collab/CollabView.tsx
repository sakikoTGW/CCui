import { useEffect, useRef, useState } from 'react'
import type { CollabState } from '../../ipc/bridge'
import { confirmPopover, hostCollab } from '../../shell/host'

const EMPTY: CollabState = { status: '未连接', room: '', selfId: '', peers: [], logs: [] }

export function CollabView() {
  const [state, setState] = useState<CollabState>(() => hostCollab()?.getState() ?? EMPTY)
  const [roomInput, setRoomInput] = useState('')
  const leaveBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const core = hostCollab()
    if (!core) return
    setState(core.getState())
    return core.subscribe(setState)
  }, [])

  const connected = state.status !== '未连接' && state.status !== '已断开'

  const onJoin = () => {
    void hostCollab()?.join(roomInput)
  }
  const onLeave = () => {
    if (!connected) {
      hostCollab()?.leave()
      return
    }
    confirmPopover(leaveBtn.current, '离开当前协作房间？', () => hostCollab()?.leave())
  }

  return (
    <>
      <div className="view-head"><h1>协作空间</h1></div>
      <div className="collab-body">
        <section className="set-card">
          <h2>加入房间</h2>
          <p className="set-hint">同一 WiFi / 局域网内多人可实时同步对话与编辑。主机自动启动协作服务（端口 4177）。</p>
          <div className="collab-row">
            <input
              placeholder="房间号，如 ccui-dev"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
            />
            <button className="btn-primary" onClick={onJoin}>加入</button>
            <button className="btn-ghost" ref={leaveBtn} onClick={onLeave}>离开</button>
          </div>
          <div className="collab-status">{state.status}</div>
        </section>
        <section className="set-card">
          <h2>在线成员 <span>{state.peers.length}</span></h2>
          <ul className="collab-peers">
            {state.peers.map((p) => (
              <li key={p.userId}>{p.name}{p.userId === state.selfId ? ' (你)' : ''}</li>
            ))}
          </ul>
        </section>
        <section className="set-card">
          <h2>同步日志</h2>
          <div className="collab-log">
            {state.logs.map((l, i) => (
              <div className="cb-log-row" key={i}><span className="t">{l.t}</span> {l.msg}</div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
