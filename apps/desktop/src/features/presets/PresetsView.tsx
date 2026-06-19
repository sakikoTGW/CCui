import { useEffect, useRef, useState } from 'react'
import { idb, uid, type Identified } from '../../data/idb'
import { getStore, toast } from '../../shell/store-bridge'

const MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash']

export interface Preset extends Identified {
  id: string
  name: string
  model: string
  temperature?: number
  systemPrompt?: string
  createdAt?: number
  updatedAt?: number
}

async function loadPresets(): Promise<{ list: Preset[]; activeId: string | null }> {
  const list = await idb.getAll<Preset>('presets')
  list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  let activeId = getStore()?.get().activePresetId ?? null
  const s = await idb.get<{ id: string; value: string }>('settings', 'activePreset')
  if (s) activeId = s.value
  getStore()?.set({ presets: list, activePresetId: activeId })
  return { list, activeId }
}

function download(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function PresetsView() {
  const [list, setList] = useState<Preset[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ open: boolean; preset: Preset | null }>({ open: false, preset: null })
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const refresh = () => loadPresets().then(({ list, activeId }) => { setList(list); setActiveId(activeId) })
  useEffect(() => {
    refresh()
    // 同步外部(如 Ctrl+数字 热键)对 activePresetId 的修改
    const store = getStore()
    return store?.subscribe((s) => setActiveId(s.activePresetId))
  }, [])

  const apply = async (p: Preset) => {
    getStore()?.set({ activePresetId: p.id })
    await idb.put('settings', { id: 'activePreset', value: p.id })
    setActiveId(p.id)
    toast(`已激活预设「${p.name}」`, { type: 'success' })
  }
  const duplicate = async (p: Preset) => {
    await idb.put<Preset>('presets', { ...p, id: uid('p'), name: `${p.name} 副本`, createdAt: Date.now(), updatedAt: Date.now() })
    toast('已复制', { type: 'success' })
    refresh()
  }
  const remove = async (p: Preset) => {
    setConfirmId(null)
    await idb.delete('presets', p.id)
    toast('已删除', { type: 'success' })
    refresh()
  }
  const exportOne = (p: Preset) => download(`preset-${p.name}.json`, { type: 'ccui-preset', preset: p })
  const exportAll = () => {
    if (!list?.length) { toast('暂无预设可导出', { type: 'warn' }); return }
    download('ccui-presets.json', { type: 'ccui-presets', presets: list })
    toast(`已导出 ${list.length} 个预设`, { type: 'success' })
  }
  const importPresets = () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'application/json'
    inp.onchange = async () => {
      const file = inp.files?.[0]
      if (!file) return
      try {
        const data = JSON.parse(await file.text())
        const arr: Preset[] = data.presets || (data.preset ? [data.preset] : [])
        if (!arr.length) throw new Error('文件中没有预设')
        let n = 0
        for (const p of arr) {
          if (!p?.name) continue
          await idb.put<Preset>('presets', { ...p, id: uid('p'), createdAt: Date.now(), updatedAt: Date.now() })
          n++
        }
        toast(`已导入 ${n} 个预设`, { type: 'success' })
        refresh()
      } catch (e) {
        toast(`导入失败：${(e as Error).message}`, { type: 'error' })
      }
    }
    inp.click()
  }

  return (
    <>
      <div className="view-head">
        <h1>参数预设</h1>
        <div className="vh-actions">
          <button className="btn-ghost" onClick={importPresets}>导入</button>
          <button className="btn-ghost" onClick={exportAll}>导出</button>
          <button className="btn-primary" onClick={() => setEditing({ open: true, preset: null })}>+ 新建预设</button>
        </div>
      </div>
      <div className="preset-body">
        {list === null ? (
          <div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        ) : list.length === 0 ? (
          <div className="empty-state">
            <h2>还没有任何预设</h2>
            <p>预设可保存模型、system prompt 等配置，对话时用 Ctrl+数字 快速切换。</p>
            <button className="btn-primary" onClick={() => setEditing({ open: true, preset: null })}>创建第一个预设</button>
          </div>
        ) : (
          <div className="preset-grid">
            {list.map((p, i) => (
              <div className={'preset-card' + (p.id === activeId ? ' active' : '')} key={p.id} tabIndex={0}>
                <div className="pc-top">
                  <span className="pc-badge">{i < 9 ? 'Ctrl+' + (i + 1) : ''}</span>
                  <div className="pc-acts">
                    <button className="pc-icon" title="复制" onClick={() => duplicate(p)}>⧉</button>
                    <button className="pc-icon" title="导出" onClick={() => exportOne(p)}>↧</button>
                    {confirmId === p.id ? (
                      <>
                        <button className="pc-icon" title="确认删除" onClick={() => remove(p)}>✓</button>
                        <button className="pc-icon" title="取消" onClick={() => setConfirmId(null)}>✕</button>
                      </>
                    ) : (
                      <button
                        className="pc-icon"
                        title="删除"
                        onClick={() => {
                          if (p.id === activeId) { toast('请先切换到其他预设再删除当前激活项', { type: 'warn' }); return }
                          setConfirmId(p.id)
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
                <div className="pc-name">{p.name}</div>
                <div className="pc-meta">{p.model} · temp {p.temperature ?? 1}</div>
                <div className="pc-prompt">{p.systemPrompt || '（无 system prompt）'}</div>
                <div className="pc-foot">
                  <button className="btn-ghost" onClick={() => setEditing({ open: true, preset: p })}>编辑</button>
                  <button className="btn-apply" onClick={() => apply(p)}>{p.id === activeId ? '已激活' : '激活'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing.open && (
        <PresetEditor
          preset={editing.preset}
          existing={list ?? []}
          onClose={() => setEditing({ open: false, preset: null })}
          onSaved={() => { setEditing({ open: false, preset: null }); refresh() }}
        />
      )}
    </>
  )
}

function PresetEditor({
  preset,
  existing,
  onClose,
  onSaved,
}: {
  preset: Preset | null
  existing: Preset[]
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !preset
  const [name, setName] = useState(preset?.name ?? '')
  const [model, setModel] = useState(preset?.model ?? MODELS[0])
  const [temp, setTemp] = useState(preset?.temperature ?? 1)
  const [sys, setSys] = useState(preset?.systemPrompt ?? '')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setErr('名称不能为空'); return }
    if (existing.find((p) => p.name === trimmed && p.id !== preset?.id)) { setErr('已存在同名预设'); return }
    setSaving(true)
    try {
      await idb.put<Preset>('presets', {
        id: preset?.id ?? uid('p'),
        name: trimmed,
        model,
        temperature: temp,
        systemPrompt: sys.trim(),
        createdAt: preset?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      })
      toast(isNew ? '预设已创建' : '预设已更新', { type: 'success' })
      onSaved()
    } catch (e) {
      setSaving(false)
      setErr(`保存失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="modal-overlay show" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">{isNew ? '新建预设' : '编辑预设'}</div>
        <label>名称<input ref={nameRef} type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <span className="field-err">{err}</span>
        <label>模型
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>Temperature <span>{temp}</span>
          <input type="range" min={0} max={2} step={0.1} value={temp} onChange={(e) => setTemp(parseFloat(e.target.value))} />
        </label>
        <label>System Prompt<textarea rows={5} placeholder="可选，定义助手的角色与风格" value={sys} onChange={(e) => setSys(e.target.value)} /></label>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  )
}
