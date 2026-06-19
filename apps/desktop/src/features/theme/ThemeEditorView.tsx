import { useEffect, useRef, useState } from 'react'
import { idb } from '../../data/idb'
import { getStore, toast } from '../../shell/store-bridge'
import { confirmPopover, hostTheme } from '../../shell/host'

const FIELDS: { key: string; label: string }[] = [
  { key: '--bg', label: '背景' },
  { key: '--surface', label: '卡片面' },
  { key: '--surface-2', label: '次级面' },
  { key: '--border', label: '边框' },
  { key: '--text', label: '正文' },
  { key: '--text-2', label: '次要文字' },
  { key: '--accent', label: '强调色' },
]

type Vars = Record<string, string>

function toHex(v: string): string {
  v = String(v || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('')
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('')
  return '#000000'
}

function currentVars(): Vars {
  const cs = getComputedStyle(document.documentElement)
  const v: Vars = {}
  for (const f of FIELDS) v[f.key] = cs.getPropertyValue(f.key).trim() || '#000000'
  v['--radius'] = cs.getPropertyValue('--radius').trim() || '12px'
  return v
}

// 把用户 CSS 限定到 #th-preview 作用域，避免预览阶段污染全局
function scopeCssToPreview(css: string): string {
  if (!css.trim()) return ''
  return css.replace(/(^|\})\s*([^{}]+)\{/g, (_m, brace, sel) => {
    const scoped = String(sel).split(',').map((s) => `#th-preview ${s.trim()}`).join(', ')
    return `${brace} ${scoped} {`
  })
}

export function ThemeEditorView() {
  const [vars, setVars] = useState<Vars>(() => currentVars())
  const [radius, setRadius] = useState<number>(() => parseInt(currentVars()['--radius']) || 12)
  const [css, setCss] = useState('')
  const [name, setName] = useState('自定义主题')
  const previewRef = useRef<HTMLDivElement>(null)
  const previewStyleRef = useRef<HTMLStyleElement | null>(null)

  // 载入已保存草稿
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const saved = await idb.get<{ id: string; vars?: Vars; name?: string }>('settings', 'theme')
        const cssRow = await idb.get<{ id: string; value: string }>('settings', 'customCss')
        if (!alive) return
        if (saved?.vars) {
          setVars((v) => ({ ...v, ...saved.vars }))
          if (saved.name) setName(saved.name)
        }
        if (cssRow?.value) setCss(cssRow.value)
      } catch { /* 用当前计算值兜底 */ }
    })()
    return () => { alive = false }
  }, [])

  // 实时预览：仅作用于 #th-preview 容器
  useEffect(() => {
    const p = previewRef.current
    if (!p) return
    for (const f of FIELDS) p.style.setProperty(f.key, vars[f.key])
    p.style.setProperty('--radius', `${radius}px`)
    if (!previewStyleRef.current) {
      const el = document.createElement('style')
      el.id = 'theme-preview-css'
      document.head.appendChild(el)
      previewStyleRef.current = el
    }
    previewStyleRef.current.textContent = scopeCssToPreview(css)
  }, [vars, radius, css])

  // 卸载清理预览样式
  useEffect(() => () => { previewStyleRef.current?.remove(); previewStyleRef.current = null }, [])

  const setVar = (key: string, value: string) => setVars((v) => ({ ...v, [key]: value }))

  const pickBuiltin = (v: string) => {
    const b = hostTheme()?.builtins[v]
    if (b) setVars((cur) => ({ ...cur, ...b }))
  }

  const resetBtn = useRef<HTMLButtonElement>(null)
  const onReset = () => {
    confirmPopover(resetBtn.current, '重置主题为默认浅色？未保存的自定义将丢失', () => {
      const light = hostTheme()?.builtins.light
      if (light) setVars((v) => ({ ...v, ...light }))
      setCss('')
      setRadius(12)
      toast('已重置', { type: 'success' })
    })
  }

  const save = async () => {
    await hostTheme()?.applyTheme(name, vars)
    document.documentElement.style.setProperty('--radius', `${radius}px`)
    let globalEl = document.getElementById('user-custom-css') as HTMLStyleElement | null
    if (!globalEl) {
      globalEl = document.createElement('style')
      globalEl.id = 'user-custom-css'
      document.head.appendChild(globalEl)
    }
    globalEl.textContent = css
    try {
      await idb.put('settings', { id: 'theme', name, vars })
      await idb.put('settings', { id: 'customCss', value: css })
      await idb.put('settings', { id: 'radius', value: radius })
    } catch { /* 持久化失败不阻断应用 */ }
    if (previewStyleRef.current) previewStyleRef.current.textContent = ''
    getStore()?.set({ theme: name })
    toast('主题已应用并保存', { type: 'success' })
  }

  const exportTheme = () => {
    const obj = { type: 'ccui-theme', name, vars, css, radius }
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `theme-${name}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('主题已导出', { type: 'success' })
  }
  const importTheme = () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'application/json'
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f) return
      try {
        const data = JSON.parse(await f.text())
        if (data.vars) setVars((v) => ({ ...v, ...data.vars }))
        if (data.css != null) setCss(data.css)
        if (data.radius) setRadius(data.radius)
        if (data.name) setName(data.name)
        toast('主题已导入，点击应用保存', { type: 'success' })
      } catch (e) {
        toast(`导入失败：${(e as Error).message}`, { type: 'error' })
      }
    }
    inp.click()
  }

  return (
    <>
      <div className="view-head">
        <h1>主题编辑器</h1>
        <div className="vh-actions">
          <button className="btn-ghost" ref={resetBtn} onClick={onReset}>重置</button>
          <button className="btn-ghost" onClick={importTheme}>导入</button>
          <button className="btn-ghost" onClick={exportTheme}>导出</button>
          <button className="btn-primary" onClick={save}>应用并保存</button>
        </div>
      </div>
      <div className="theme-body">
        <div className="theme-controls">
          <div className="tc-group" id="tc-colors">
            {FIELDS.map((f) => (
              <label className="color-row" key={f.key}>
                <span>{f.label}</span>
                <input type="color" value={toHex(vars[f.key])} onChange={(e) => setVar(f.key, e.target.value)} />
              </label>
            ))}
          </div>
          <div className="tc-group">
            <label>
              圆角 <span>{radius}px</span>
              <input type="range" min={0} max={22} step={1} value={radius} onChange={(e) => setRadius(parseInt(e.target.value))} />
            </label>
            <label>
              预设主题
              <select defaultValue="" onChange={(e) => pickBuiltin(e.target.value)}>
                <option value="">— 选择内置 —</option>
                <option value="light">浅色</option>
                <option value="dark">暗色</option>
              </select>
            </label>
          </div>
          <div className="tc-group">
            <label>自定义 CSS（高级，实时预览）</label>
            <textarea rows={8} placeholder=".bubble.md { font-size: 15px; }" spellCheck={false} value={css} onChange={(e) => setCss(e.target.value)} />
          </div>
        </div>
        <div className="theme-preview" id="th-preview" ref={previewRef}>
          <div className="msg user"><div className="role">你</div><div className="bubble">这是一条用户消息预览</div></div>
          <div className="msg assistant">
            <div className="role">CCui</div>
            <div className="bubble md"><p>这是助手回复，含 <code>inline code</code>。</p><pre><code>const x = 42</code></pre></div>
          </div>
          <div className="toolcard">
            <div className="head">
              <span className="ico">
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
              </span>
              <span className="name">Read</span>
              <span className="arg">src/index.ts</span>
              <span className="spin done">12ms</span>
            </div>
          </div>
          <button className="btn-primary" style={{ marginTop: 8 }}>主操作按钮</button>
        </div>
      </div>
    </>
  )
}
