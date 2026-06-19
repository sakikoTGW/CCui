// 设置视图已迁移到 React 孤岛 ../../dist/islands.js。
// 权限/外观个性化(模块级 cached)/窗口外观等单一真相仍在 vanilla，
// 孤岛经 window.ccuiPerms / ccuiPersonalize / ccuiChrome / ccuiWelcome 桥读写。
// 本文件保留 boot 期需要的纯工具：字体预热 / 下发已存配置 / 风格提示 / 新手引导。
import { store } from '../store.js'
import { db } from '../db.js'
import { api } from '../api.js'
import { registerOverlay } from '../modal.js'

const FONT_FALLBACK = ['PingFang SC', 'PingFang TC', 'Microsoft YaHei UI', '微软雅黑', 'Segoe UI', 'SimSun', 'Arial']
/** @type {string[]|null} */
let cachedSystemFonts = null

function h(tag, cls, html) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html != null) el.innerHTML = html
  return el
}

/** 后台预热字体列表，避免首次打开设置卡顿 */
export function preloadSystemFonts() {
  if (cachedSystemFonts) return Promise.resolve(cachedSystemFonts)
  if (!window.ccui?.listFonts) return Promise.resolve(FONT_FALLBACK)
  return window.ccui.listFonts()
    .then(list => { cachedSystemFonts = list?.length ? list : FONT_FALLBACK; return cachedSystemFonts })
    .catch(() => { cachedSystemFonts = FONT_FALLBACK; return cachedSystemFonts })
}

let unmount = null

export async function mountSettings(c) {
  if (unmount) { try { unmount() } catch {} unmount = null }
  const mod = await import('../../dist/islands.js')
  unmount = mod.mountSettings(c)
}

// 启动时把已保存配置下发 daemon + 加载风格到 store
export async function applySavedConfig() {
  try {
    const conn = (await db.get('settings', 'connection'))?.value
    if (conn) {
      const patch = {}
      if (conn.baseUrl) patch.ANTHROPIC_BASE_URL = conn.baseUrl
      if (conn.apiKey) patch.ANTHROPIC_API_KEY = conn.apiKey
      if (conn.model) patch.DEEPSEEK_MODEL = conn.model
      if (Object.keys(patch).length) api.setEnv(patch)
    }
    const router = (await db.get('settings', 'router'))?.value
    if (router) api.setRouter(router)
    const style = (await db.get('settings', 'codingStyle'))?.value
    if (style) store.set({ codingStyle: style })
  } catch {}
}

// 把风格记忆拼成系统提示前缀（供 chat 注入）
export function buildStylePrompt(style) {
  if (!style || !style.enabled) return ''
  const parts = []
  if (style.lang) parts.push(`语言偏好：${style.lang}`)
  if (style.fmt) parts.push(`格式约定：${style.fmt}`)
  if (style.rules) parts.push(`其他约定：${style.rules}`)
  if (!parts.length) return ''
  return `以下是用户的长期编码偏好，请在本次及后续输出中始终遵守：\n- ${parts.join('\n- ')}`
}

// ---------- 首次欢迎引导 ----------
export async function maybeWelcome() {
  try {
    const flag = await db.get('settings', 'onboarded')
    if (flag?.value) return
  } catch {}
  showWelcome()
}

export function showWelcome() {
  const back = h('div', 'modal-back')
  back.innerHTML = `
    <div class="modal welcome">
      <h2>欢迎使用 CCui</h2>
      <p class="wl-sub">一个本地优先、可深度定制的 AI 编码工作站。三步上手：</p>
      <ol class="wl-steps">
        <li><b>① 配好连接</b><br/>到「设置」填 API 地址与 Key，不用碰命令行。</li>
        <li><b>② 存个预设</b><br/>在「参数预设」保存常用模型 + 系统提示，<kbd>Ctrl+1~9</kbd> 秒切。</li>
        <li><b>③ 用模板提速</b><br/>输入框打 <code>/</code> 调出提示词模板，<code>{{变量}}</code> 自动填充。</li>
        <li><b>④ Task Brief + 探询分支</b><br/>Composer 开 <kbd>Brief</kbd>（<kbd>Ctrl+Shift+B</kbd>）结构化任务；说不清时 Enter 或点「探询」— Agent 给出 A/B/C 三条假设路径，选最接近的一条写入 Brief 后再发契约。</li>
        <li><b>⑤ 分支与变异</b><br/>悬停用户消息可编辑并<strong>分叉</strong>；<kbd>Ctrl+Shift+E</kbd> 编辑上一条；<kbd>+ Compare</kbd> 同题三路变异 Thread。</li>
        <li><b>⑥ 权限与变更审查</b><br/>工具默认每次询问；「设置 → 工具权限」可设「始终允许」。待审项会进入<strong>变更审查窗</strong>（活动栏 ✓ 图标 / <kbd>Ctrl+Shift+R</kbd>），支持全选批处理允许或拒绝。拖拽文件到输入框可附加 <code>@路径</code>。</li>
      </ol>
      <p class="wl-tip">编辑已发送的消息会自动建立<strong>对话分支</strong>，所有历史在「数据工作室」可搜索导出。</p>
      <div class="wl-actions">
        <button class="btn-ghost" id="wl-skip">跳过</button>
        <button class="btn-primary" id="wl-go">去设置连接</button>
      </div>
    </div>`
  document.body.appendChild(back)
  const close = () => { back.remove(); unregister() }
  const unregister = registerOverlay(back, () => done(false))
  const done = async (go) => {
    try { await db.put('settings', { id: 'onboarded', value: true }) } catch {}
    close()
    if (go) document.querySelector('.act[data-view="settings"]')?.click()
  }
  back.querySelector('#wl-skip').onclick = () => done(false)
  back.querySelector('#wl-go').onclick = () => done(true)
  back.onclick = e => { if (e.target === back) done(false) }
}
