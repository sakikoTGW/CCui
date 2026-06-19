import { useEffect, useState } from 'react'
import type { Personalize, ChromePrefs } from '../../ipc/bridge'
import { idb } from '../../data/idb'
import { getStore, toast } from '../../shell/store-bridge'
import { hostPerms, hostPersonalize, hostChrome, hostWelcome, hostStudio } from '../../shell/host'
import { bus } from '../../shell/bus'

const APP_VERSION = '0.1.0'
const FONT_FALLBACK = ['PingFang SC', 'PingFang TC', 'Microsoft YaHei UI', '微软雅黑', 'Segoe UI', 'SimSun', 'Arial']

interface Conn { baseUrl?: string; apiKey?: string; model?: string }
interface Router { mode: string; strongModel: string; weakModel: string }
interface Style { lang?: string; fmt?: string; rules?: string; enabled?: boolean }

function mask(k?: string): string {
  if (!k) return ''
  if (k.length <= 8) return '••••'
  return k.slice(0, 5) + '••••••••' + k.slice(-4)
}
function isDark() {
  return document.documentElement.dataset.theme === 'dark'
}
function downloadBlob(content: string, name: string, type: string) {
  const blob = new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export function SettingsView() {
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')

  const [conn, setConn] = useState<Conn>({})
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)

  const [router, setRouter] = useState<Router>({ mode: 'auto', strongModel: 'deepseek-v4-pro', weakModel: 'deepseek-v4-flash' })
  const [style, setStyle] = useState<Style>({})
  const [chrome, setChrome] = useState<ChromePrefs>({})
  const [live2d, setLive2d] = useState('')

  const [allowed, setAllowed] = useState<Set<string>>(new Set())
  const [appr, setAppr] = useState<Personalize | null>(null)
  const [textMode, setTextMode] = useState<'light' | 'dark'>(isDark() ? 'dark' : 'light')
  const [fontOpts, setFontOpts] = useState<{ value: string; label: string }[]>([{ value: '', label: '默认（苹方）' }])

  // 载入
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [connRow, routerRow, styleRow, l2dRow] = await Promise.all([
          idb.get('settings', 'connection'),
          idb.get('settings', 'router'),
          idb.get('settings', 'codingStyle'),
          idb.get('settings', 'live2dModel'),
        ])
        if (!alive) return
        const c = (connRow?.value as Conn) || {}
        setConn(c); setBaseUrl(c.baseUrl || ''); setModel(c.model || '')
        setRouter((routerRow?.value as Router) || { mode: 'auto', strongModel: 'deepseek-v4-pro', weakModel: 'deepseek-v4-flash' })
        setStyle((styleRow?.value as Style) || {})
        setLive2d((l2dRow?.value as string) || '')
        setChrome(hostChrome()?.get() || {})
        setAllowed(new Set(await hostPerms()?.get() ?? []))
        setAppr(hostPersonalize()?.get() ?? null)
        setPhase('ok')
      } catch (e) {
        if (alive) { setErrMsg((e as Error).message); setPhase('error') }
      }
    })()
    return () => { alive = false }
  }, [])

  // 字体异步枚举
  useEffect(() => {
    let alive = true
    window.ccui.listFonts?.().then((list) => {
      if (!alive) return
      const fonts = (list as string[] | undefined)?.length ? (list as string[]) : FONT_FALLBACK
      const prefer = ['PingFang SC', 'PingFang TC', 'Microsoft YaHei UI', '微软雅黑', 'Segoe UI']
      const sorted = [...new Set([...prefer.filter((f) => fonts.includes(f)), ...fonts])]
      setFontOpts([{ value: '', label: '默认（苹方）' }, ...sorted.map((n) => ({ value: n, label: n }))])
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  // 实时外观预览（与 vanilla 一致：编辑即全局应用，保存才落库）
  useEffect(() => {
    if (appr) hostPersonalize()?.apply(appr)
  }, [appr])

  if (phase === 'loading') return <div className="settings-body" />
  if (phase === 'error') return <div className="error-state">读取本地配置失败：{errMsg}<br />请检查浏览器存储是否被清除。</div>

  const toggleTool = (t: string) =>
    setAllowed((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n })

  const savePerms = async () => {
    try { await hostPerms()?.save([...allowed]); toast('工具权限已保存', { type: 'success' }) }
    catch (e) { toast(`保存失败：${(e as Error).message}`, { type: 'error' }) }
  }

  const saveConn = async () => {
    const bu = baseUrl.trim()
    if (bu && !/^https?:\/\//.test(bu)) return toast('Base URL 需以 http(s):// 开头', { type: 'error' })
    const next: Conn = { ...conn }
    if (bu) next.baseUrl = bu
    if (model.trim()) next.model = model.trim()
    if (keyInput.trim()) next.apiKey = keyInput.trim()
    try {
      await idb.put('settings', { id: 'connection', value: next })
      setConn(next)
      const patch: Record<string, string> = {}
      if (next.baseUrl) patch.ANTHROPIC_BASE_URL = next.baseUrl
      if (next.apiKey) patch.ANTHROPIC_API_KEY = next.apiKey
      if (next.model) patch.DEEPSEEK_MODEL = next.model
      window.ccui.setEnv(patch)
      window.ccui.reset()
      setKeyInput('')
      toast('连接配置已保存并下发（新对话生效）', { type: 'success' })
    } catch (e) { toast(`保存失败：${(e as Error).message}`, { type: 'error' }) }
  }

  const saveRouter = async () => {
    try {
      await idb.put('settings', { id: 'router', value: router })
      window.ccui.setRouter(router as unknown as Record<string, unknown>)
      toast('路由策略已生效', { type: 'success' })
    } catch (e) { toast(`保存失败：${(e as Error).message}`, { type: 'error' }) }
  }

  const saveStyle = async () => {
    try {
      await idb.put('settings', { id: 'codingStyle', value: style })
      getStore()?.set({ codingStyle: style })
      toast(style.enabled ? '风格记忆已启用' : '偏好已保存', { type: 'success' })
    } catch (e) { toast(`保存失败：${(e as Error).message}`, { type: 'error' }) }
  }

  const saveChromePrefs = async () => {
    try {
      const res = await hostChrome()?.save(chrome)
      if (res?.chrome) setChrome(res.chrome)
      toast(res?.degraded ? '窗口外观已本地更新（主进程同步稍后重试）' : '窗口外观已更新', { type: 'success' })
    } catch (e) { toast(`保存失败：${(e as Error).message}`, { type: 'error' }) }
  }

  const saveLive2d = async () => {
    try {
      await idb.put('settings', { id: 'live2dModel', value: live2d.trim() })
      toast('Live2D 配置已保存（重启后加载外部模型）', { type: 'success' })
    } catch (e) { toast(`保存失败：${(e as Error).message}`, { type: 'error' }) }
  }

  const exportAll = async () => {
    const payload = await hostStudio()?.exportAll()
    downloadBlob(JSON.stringify(payload, null, 2), `ccui-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json')
    toast('已导出全部数据', { type: 'success' })
  }
  const replayWelcome = async () => {
    await idb.put('settings', { id: 'onboarded', value: false }).catch(() => {})
    hostWelcome()?.()
  }

  // ---- 外观 helpers ----
  const defaultAccent = isDark() ? '#e08a6b' : '#d97757'
  const patchAppr = (fn: (a: Personalize) => Personalize) => setAppr((a) => (a ? fn(a) : a))
  const setBg = (patch: Partial<Personalize['bg']>) => patchAppr((a) => ({ ...a, bg: { ...a.bg, ...patch } }))
  const textParts = hostPersonalize()?.textParts ?? []
  const getDefaultTextColor = (k: string, m: 'light' | 'dark') => hostPersonalize()?.getDefaultTextColor(k, m) ?? '#000000'

  const onPickBgFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2.5 * 1024 * 1024) return toast('图片请小于 2.5MB', { type: 'warn' })
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = rej
      r.readAsDataURL(file)
    })
    setBg({ mode: 'image', image: data })
  }

  const resetAppearance = async () => {
    const def = hostPersonalize()?.defaults()
    if (def) { await hostPersonalize()?.save(def); setAppr(hostPersonalize()?.get() ?? def); setTextMode(isDark() ? 'dark' : 'light') }
    toast('已恢复默认外观', { type: 'success' })
  }
  const saveAppearance = async () => {
    if (!appr) return
    try { await hostPersonalize()?.save(appr); toast('外观已保存并应用', { type: 'success' }) }
    catch (e) { toast(`保存失败：${(e as Error).message}`, { type: 'error' }) }
  }

  const bgMode = appr?.bg.mode ?? 'default'

  return (
    <>
      <div className="view-head"><h1>设置</h1></div>
      <div className="settings-body">

        <section className="set-card">
          <h2>工具权限</h2>
          <p className="set-hint">{hostPerms()?.explain}</p>
          <div className="perm-groups">
            {(hostPerms()?.groups ?? []).map((g) => (
              <div className="perm-grp" key={g.id}>
                <h3 className="perm-grp-title">{g.label}</h3>
                <div className="perm-grid">
                  {g.tools.map((t) => (
                    <label className="perm-item" key={t}>
                      <input type="checkbox" checked={allowed.has(t)} onChange={() => toggleTool(t)} /><span>{t}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="set-actions">
            <button className="btn-primary" onClick={savePerms}>保存权限</button>
            <button className="btn-ghost" onClick={() => document.querySelector<HTMLElement>('.act[data-view="console"]')?.click()}>打开控制台 (Skills/MCP)</button>
          </div>
        </section>

        <section className="set-card">
          <h2>连接配置</h2>
          <p className="set-hint">无需改 .env 文件。保存后对<strong>新对话</strong>生效。</p>
          <label className="set-row"><span>API 地址 (Base URL)</span>
            <input type="text" placeholder="https://api.deepseek.com/anthropic" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
          <label className="set-row"><span>API Key</span>
            <input type={keyVisible ? 'text' : 'password'} placeholder="sk-..." value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
            <button className="set-eye" title="显示/隐藏" onClick={() => setKeyVisible((v) => !v)}>👁</button></label>
          <div className="set-keyhint">{conn.apiKey ? `当前已保存：${mask(conn.apiKey)}` : '尚未设置 Key（将使用 .env 中的默认值）'}</div>
          <label className="set-row"><span>默认模型</span>
            <input type="text" placeholder="deepseek-v4-flash" value={model} onChange={(e) => setModel(e.target.value)} /></label>
          <div className="set-actions"><button className="btn-primary" onClick={saveConn}>保存连接</button></div>
        </section>

        <section className="set-card">
          <h2>模型路由策略</h2>
          <p className="set-hint">控制强/弱模型的分派。auto = 按任务自动选，省钱又靠谱。</p>
          <label className="set-row"><span>路由模式</span>
            <select value={router.mode} onChange={(e) => setRouter((r) => ({ ...r, mode: e.target.value }))}>
              <option value="auto">auto（按任务自动）</option>
              <option value="strong-only">强模型优先</option>
              <option value="weak-only">弱模型优先</option>
            </select></label>
          <label className="set-row"><span>强模型</span><input type="text" value={router.strongModel} onChange={(e) => setRouter((r) => ({ ...r, strongModel: e.target.value }))} /></label>
          <label className="set-row"><span>弱模型</span><input type="text" value={router.weakModel} onChange={(e) => setRouter((r) => ({ ...r, weakModel: e.target.value }))} /></label>
          <div className="set-actions"><button className="btn-primary" onClick={saveRouter}>保存路由</button></div>
        </section>

        <section className="set-card">
          <h2>编码风格记忆</h2>
          <p className="set-hint">这些偏好会作为系统提示注入每轮对话（粉色龙 #14）。</p>
          <label className="set-row"><span>语言偏好</span><input type="text" placeholder="中文注释，变量用英文" value={style.lang || ''} onChange={(e) => setStyle((s) => ({ ...s, lang: e.target.value }))} /></label>
          <label className="set-row"><span>缩进/格式</span><input type="text" placeholder="2 空格，单引号，无分号" value={style.fmt || ''} onChange={(e) => setStyle((s) => ({ ...s, fmt: e.target.value }))} /></label>
          <label className="set-row top"><span>自定义约定</span>
            <textarea rows={4} placeholder="例：优先函数式；不写无意义注释；错误必须处理" value={style.rules || ''} onChange={(e) => setStyle((s) => ({ ...s, rules: e.target.value }))} /></label>
          <label className="set-check"><input type="checkbox" checked={!!style.enabled} onChange={(e) => setStyle((s) => ({ ...s, enabled: e.target.checked }))} /> 启用风格记忆（注入对话）</label>
          <div className="set-actions"><button className="btn-primary" onClick={saveStyle}>保存偏好</button></div>
        </section>

        <section className="set-card" id="set-appearance">
          <h2>外观个性化</h2>
          <p className="set-hint">自定义强调色与画布背景。与顶栏明暗切换叠加生效；完整调色请用
            <a href="#" className="set-inline-link" onClick={(e) => { e.preventDefault(); bus.emit('switch-view', 'theme') }}>主题编辑器</a>。
          </p>
          {appr && (
            <>
              <div className="appear-preview" aria-hidden="true">
                <span className="ap-dot" /><span className="ap-chip">强调色预览</span><button type="button" className="ap-btn">按钮</button>
              </div>
              <label className="set-row color-row-set">
                <span>强调色</span>
                <input type="color" value={appr.accent || defaultAccent} onChange={(e) => patchAppr((a) => ({ ...a, accent: e.target.value }))} />
                <button type="button" className="btn-ghost" onClick={() => patchAppr((a) => ({ ...a, accent: null }))}>恢复默认</button>
              </label>
              <label className="set-row"><span>背景模式</span>
                <select value={bgMode} onChange={(e) => setBg({ mode: e.target.value as Personalize['bg']['mode'] })}>
                  <option value="default">默认渐变</option>
                  <option value="color">纯色</option>
                  <option value="image">图片</option>
                </select></label>
              {bgMode === 'color' && (
                <label className="set-row"><span>背景颜色</span>
                  <input type="color" value={appr.bg.color || '#f5f5f7'} onChange={(e) => setBg({ color: e.target.value })} /></label>
              )}
              {bgMode === 'image' && (
                <>
                  <label className="set-row"><span>图片地址</span>
                    <input type="text" placeholder="https://... 或选择本地图片" value={appr.bg.image || ''} onChange={(e) => setBg({ image: e.target.value })} /></label>
                  <div className="set-row"><span>本地图片</span>
                    <div className="set-bg-file">
                      <label className="btn-ghost">选择文件…<input type="file" accept="image/*" hidden onChange={(e) => onPickBgFile(e.target.files?.[0])} /></label>
                      <span className="set-bg-filehint">{appr.bg.image?.startsWith('data:') ? '已使用本地图片' : '未选择'}</span>
                    </div>
                  </div>
                  <label className="set-row">遮罩浓度 <span>{Math.round((appr.bg.overlay ?? 0.42) * 100)}%</span>
                    <input type="range" min={0} max={85} step={1} value={Math.round((appr.bg.overlay ?? 0.42) * 100)} onChange={(e) => setBg({ overlay: Number(e.target.value) / 100 })} /></label>
                  <label className="set-row">背景模糊 <span>{appr.bg.blur || 0}px</span>
                    <input type="range" min={0} max={20} step={1} value={appr.bg.blur || 0} onChange={(e) => setBg({ blur: Number(e.target.value) })} /></label>
                </>
              )}
              <label className="set-row"><span>界面字体</span>
                <select value={appr.fontFamily || ''} onChange={(e) => patchAppr((a) => ({ ...a, fontFamily: e.target.value || null }))}>
                  {fontOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select></label>
              <label className="set-check"><input type="checkbox" checked={appr.adaptiveText !== false} onChange={(e) => patchAppr((a) => ({ ...a, adaptiveText: e.target.checked }))} /> 文字随背景自适应（提高可读性）</label>
              <h3 className="set-sub">文字颜色</h3>
              <p className="set-hint">按浅色/深色界面分别设置各区域颜色；留空或恢复默认则跟随主题。</p>
              <label className="set-row"><span>编辑配色</span>
                <select value={textMode} onChange={(e) => setTextMode(e.target.value as 'light' | 'dark')}>
                  <option value="light">浅色界面</option>
                  <option value="dark">深色界面</option>
                </select></label>
              <div className="set-text-colors">
                {textParts.map((part) => {
                  const bucket = appr.textColors?.[textMode] || {}
                  const custom = bucket[part.key]
                  const isCustom = typeof custom === 'string' && !!custom
                  const displayVal = isCustom ? custom : getDefaultTextColor(part.key, textMode)
                  const setText = (val: string | undefined) =>
                    patchAppr((a) => {
                      const tc = { light: { ...(a.textColors?.light || {}) }, dark: { ...(a.textColors?.dark || {}) } }
                      if (val === undefined) delete tc[textMode][part.key]
                      else tc[textMode][part.key] = val
                      return { ...a, textColors: tc }
                    })
                  return (
                    <label className="set-row color-row-set set-text-color-row" key={part.key}>
                      <span>{part.label}</span>
                      <input type="color" value={displayVal} onChange={(e) => setText(e.target.value)} />
                      <button type="button" className="btn-ghost" disabled={!isCustom} onClick={() => setText(undefined)}>恢复默认</button>
                    </label>
                  )
                })}
              </div>
              <div className="set-actions">
                <button className="btn-ghost" onClick={resetAppearance}>恢复默认外观</button>
                <button className="btn-primary" onClick={saveAppearance}>保存并应用</button>
              </div>
            </>
          )}
        </section>

        <section className="set-card">
          <h2>窗口与状态栏</h2>
          <p className="set-hint">不使用系统标题栏，可自定义状态栏显示项。</p>
          <label className="set-check"><input type="checkbox" checked={chrome.showProject !== false} onChange={(e) => setChrome((c) => ({ ...c, showProject: e.target.checked }))} /> 显示项目名</label>
          <label className="set-check"><input type="checkbox" checked={chrome.showSession !== false} onChange={(e) => setChrome((c) => ({ ...c, showSession: e.target.checked }))} /> 显示会话标题</label>
          <label className="set-check"><input type="checkbox" checked={chrome.showTheme !== false} onChange={(e) => setChrome((c) => ({ ...c, showTheme: e.target.checked }))} /> 显示主题切换</label>
          <label className="set-check"><input type="checkbox" checked={chrome.showConnection !== false} onChange={(e) => setChrome((c) => ({ ...c, showConnection: e.target.checked }))} /> 显示连接状态</label>
          <div className="set-actions"><button className="btn-primary" onClick={saveChromePrefs}>保存并应用</button></div>
        </section>

        <section className="set-card">
          <h2>Live2D 全局助手</h2>
          <p className="set-hint">右下角悬浮助手，对话/编排 busy 时自动切换动作。可填 model.json 路径（Cubism 2/3）供后续加载。</p>
          <label className="set-row"><span>模型路径/URL</span>
            <input type="text" placeholder="https://.../model.json 或本地路径" value={live2d} onChange={(e) => setLive2d(e.target.value)} /></label>
          <div className="set-actions"><button className="btn-primary" onClick={saveLive2d}>保存</button></div>
        </section>

        <section className="set-card about">
          <h2>关于 CCui</h2>
          <div className="about-grid">
            <div><span className="ab-k">版本</span><span className="ab-v">v{APP_VERSION}</span></div>
            <div><span className="ab-k">内核</span><span className="ab-v">Bun core daemon (Claude Code 引擎)</span></div>
            <div><span className="ab-k">外壳</span><span className="ab-v">Electron + 原生 ES Modules</span></div>
            <div><span className="ab-k">模型</span><span className="ab-v">DeepSeek (Anthropic 兼容)</span></div>
            <div><span className="ab-k">存储</span><span className="ab-v">IndexedDB 本地优先</span></div>
          </div>
          <p className="about-credit">本地优先 · 你的数据只在你机器上。致谢 Anthropic Claude Code、DeepSeek、Electron、marked、highlight.js。</p>
          <div className="set-actions">
            <button className="btn-ghost" onClick={replayWelcome}>重看新手引导</button>
            <button className="btn-ghost" onClick={exportAll}>导出全部数据</button>
          </div>
        </section>
      </div>
    </>
  )
}
