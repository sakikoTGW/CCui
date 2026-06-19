import {
  parseManifest,
  collectPlugins,
  createPluginBridge,
  buildPluginSrcdoc,
  type HostMessage,
  type PluginManifest,
} from '@ccui/plugin-sdk'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))

// ---------- manifest ----------
const m1 = parseManifest(JSON.stringify({
  id: 'hello', name: 'Hello', version: '0.1.0',
  ui: { kind: 'view', title: 'Hi', entry: 'index.html' },
  permissions: ['toast'],
}))
ok('合法清单解析', m1.ok === true && m1.ok && m1.manifest.id === 'hello')
ok('默认 permissions 为空数组', parseManifest(JSON.stringify({ id: 'a', name: 'A', version: '1' })).ok === true)

const mBadId = parseManifest(JSON.stringify({ id: 'Bad Id', name: 'X', version: '1' }))
ok('非法 id 被拒', mBadId.ok === false)
ok('坏 JSON 被拒', parseManifest('{ not json').ok === false)
ok('缺 name 被拒', parseManifest(JSON.stringify({ id: 'a', version: '1' })).ok === false)

// ---------- discovery ----------
const disc = collectPlugins([
  { dir: 'plugins/a', text: JSON.stringify({ id: 'dup', name: 'A', version: '1' }) },
  { dir: 'plugins/b', text: JSON.stringify({ id: 'dup', name: 'B', version: '1' }) },
  { dir: 'plugins/c', text: '{ broken' },
  { dir: 'plugins/d', text: JSON.stringify({ id: 'ok', name: 'D', version: '1' }) },
])
ok('发现去重保留首个', disc.records.length === 2 && disc.records[0].manifest.id === 'dup')
ok('坏清单 + 重复 id 进 errors', disc.errors.length === 2)

// ---------- bridge ----------
function makeBridge(manifest: Partial<PluginManifest>) {
  const posts: HostMessage[] = []
  const calls: { toast: string[]; emit: Array<[string, unknown]>; daemon: Array<Record<string, unknown>> } = {
    toast: [], emit: [], daemon: [],
  }
  const handlers = new Map<string, (p: unknown) => void>()
  const full: PluginManifest = {
    id: 'p', name: 'P', version: '1', permissions: [], ...manifest,
  } as PluginManifest
  const bridge = createPluginBridge({
    manifest: full,
    post: msg => posts.push(msg),
    toast: msg => calls.toast.push(msg),
    emit: (e, p) => calls.emit.push([e, p]),
    on: (e, h) => { handlers.set(e, h); return () => handlers.delete(e) },
    getState: () => ({ view: 'chat', theme: 'light' }),
    daemonRequest: async cmd => { calls.daemon.push(cmd); return { ok: true, echo: cmd } },
  })
  return { bridge, posts, calls, handlers }
}

// handshake
{
  const { bridge, posts } = makeBridge({ id: 'h', permissions: ['toast'] })
  bridge.handleMessage({ t: 'ccui:hello', pluginId: 'h' })
  const ready = posts.find(p => p.t === 'ccui:ready')
  ok('hello → ready 回握', !!ready && (ready as { permissions: string[] }).permissions[0] === 'toast')
}

// toast denied / allowed
{
  const { bridge, posts, calls } = makeBridge({ permissions: [] })
  bridge.handleMessage({ t: 'ccui:rpc', id: 1, method: 'toast', args: { message: 'x' } })
  await tick()
  const res = posts.find(p => p.t === 'ccui:rpc:res') as { ok: boolean; error?: string } | undefined
  ok('无 toast 权限被拒', !!res && res.ok === false && /permission denied/.test(res.error || ''))
  ok('被拒时不触发 toast', calls.toast.length === 0)
}
{
  const { bridge, posts, calls } = makeBridge({ permissions: ['toast'] })
  bridge.handleMessage({ t: 'ccui:rpc', id: 2, method: 'toast', args: { message: 'hi' } })
  await tick()
  const res = posts.find(p => p.t === 'ccui:rpc:res') as { ok: boolean } | undefined
  ok('有 toast 权限放行', !!res && res.ok === true && calls.toast[0] === 'hi')
}

// bus.emit whitelist
{
  const { bridge, posts, calls } = makeBridge({ permissions: ['bus:emit'] })
  bridge.handleMessage({ t: 'ccui:rpc', id: 3, method: 'bus.emit', args: { event: 'evil-event', payload: 1 } })
  await tick()
  const res = posts.find(p => p.t === 'ccui:rpc:res') as { ok: boolean; error?: string } | undefined
  ok('非白名单事件被拒', !!res && res.ok === false && /not allowed/.test(res.error || ''))
  ok('被拒事件不触发 emit', calls.emit.length === 0)

  bridge.handleMessage({ t: 'ccui:rpc', id: 4, method: 'bus.emit', args: { event: 'switch-view', payload: 'chat' } })
  await tick()
  ok('白名单事件放行', calls.emit.some(([e, p]) => e === 'switch-view' && p === 'chat'))
}

// daemon whitelist
{
  const { bridge, posts, calls } = makeBridge({ permissions: ['daemon:request'] })
  bridge.handleMessage({ t: 'ccui:rpc', id: 5, method: 'daemon.request', args: { cmd: { cmd: 'send', text: 'rm' } } })
  await tick()
  const denied = posts.find(p => p.t === 'ccui:rpc:res') as { ok: boolean; error?: string } | undefined
  ok('非白名单 daemon 命令被拒', !!denied && denied.ok === false && calls.daemon.length === 0)

  bridge.handleMessage({ t: 'ccui:rpc', id: 6, method: 'daemon.request', args: { cmd: { cmd: 'getProjectInfo' } } })
  await tick()
  ok('白名单 daemon 命令放行', calls.daemon.some(c => c.cmd === 'getProjectInfo'))
}

// store.get
{
  const { bridge, posts } = makeBridge({ permissions: ['store:read'] })
  bridge.handleMessage({ t: 'ccui:rpc', id: 7, method: 'store.get', args: {} })
  await tick()
  const res = posts.find(p => p.t === 'ccui:rpc:res') as { ok: boolean; result?: { view?: string } } | undefined
  ok('store.get 返回快照', !!res && res.ok === true && res.result?.view === 'chat')
}

// sub + event forward
{
  const { bridge, posts, handlers } = makeBridge({ permissions: ['bus:on'] })
  bridge.handleMessage({ t: 'ccui:sub', event: 'theme-changed' })
  ok('订阅白名单事件挂上', handlers.has('theme-changed'))
  handlers.get('theme-changed')?.({ theme: 'dark' })
  const ev = posts.find(p => p.t === 'ccui:event') as { event: string; payload: { theme: string } } | undefined
  ok('宿主事件转发给访客', !!ev && ev.event === 'theme-changed' && ev.payload.theme === 'dark')

  bridge.handleMessage({ t: 'ccui:sub', event: 'evil' })
  ok('非白名单订阅被忽略', !handlers.has('evil'))
}

// dispose 清理订阅
{
  const { bridge, handlers } = makeBridge({ permissions: ['bus:on'] })
  bridge.handleMessage({ t: 'ccui:sub', event: 'project-changed' })
  ok('dispose 前订阅在', handlers.has('project-changed'))
  bridge.dispose()
  ok('dispose 后订阅清理', !handlers.has('project-changed'))
}

// srcdoc 注入
{
  const doc = buildPluginSrcdoc('hello', '<!doctype html><html><head><title>x</title></head><body>hi</body></html>')
  ok('srcdoc 注入 window.ccui', doc.includes('window.ccui=createCcuiPlugin("hello")'))
  ok('srcdoc 注入进 head', doc.indexOf('createCcuiPlugin') < doc.indexOf('<body>'))
  const noHead = buildPluginSrcdoc('h2', '<body>hi</body>')
  ok('无 head 时前置注入', noHead.startsWith('<script>'))
}

console.log(`\nplugin-sdk: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
