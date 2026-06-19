// 渲染进程单一状态源 —— 引擎为 zustand vanilla（real zustand，相对引 node_modules
// ESM，免 importmap）。对外保持历史 { get, set, subscribe } 适配器（subscribe 立即
// 触发），让 62 处 vanilla 调用零改动；同时保留 zustand 原生 getState/setState/
// subscribe，供 React 孤岛用 zustand `useStore(window.ccuiStore, selector)` 做
// 分片选择器订阅（见 src/shell/store.ts）。两世界共享同一实例（renderer 挂 window）。
import { createStore as zustandCreate } from '../node_modules/zustand/esm/vanilla.mjs'

/**
 * 包一层：在 zustand store 上补 { get, set, subscribe } 历史语义。
 * - get():   = getState()
 * - set(p):  对象 → 浅合并(merge)；函数 → 返回值整体替换(replace)，与旧实现一致
 * - subscribe(fn): 注册即以当前 state 立即回调一次（旧实现语义），再随变更回调
 */
function withLegacyApi(api) {
  const origSubscribe = api.subscribe.bind(api)
  api.get = () => api.getState()
  api.set = patch => {
    if (typeof patch === 'function') api.setState(patch(api.getState()), true)
    else api.setState(patch, false)
  }
  api.subscribe = fn => {
    fn(api.getState())
    return origSubscribe(s => fn(s))
  }
  return api
}

export function createStore(initial) {
  return withLegacyApi(zustandCreate(() => ({ ...initial })))
}

export const store = createStore({
  view: 'chat',
  busy: false,
  daemonStatus: 'starting',
  sessionRailCollapsed: localStorage.getItem('ccui:session-rail') === '1',
  inspectorCollapsed: localStorage.getItem('ccui:inspector') === '1',
  model: 'deepseek-v4-pro',
  tier: 'strong',
  routeReason: '',
  usage: { input: 0, output: 0 },
  totalCost: 0,
  presets: [],
  activePresetId: null,
  templates: [],
  conversations: [],
  currentConversationId: null,
  theme: 'light',
  codingStyle: null,
  comparePending: false,
  activeSessionId: 'main',
  orchBusy: false,
  briefMode: localStorage.getItem('ccui:brief-mode') === '1',
  briefDiscoveryPending: false,
  reviewPending: 0,
  projectName: 'CCui',
  projectPath: '',
})
