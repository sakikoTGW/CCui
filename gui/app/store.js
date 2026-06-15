// 极简响应式 store — 发布订阅，无第三方依赖
function createStore(initial) {
  let state = initial
  const subs = new Set()
  return {
    get: () => state,
    set(patch) {
      state = typeof patch === 'function' ? patch(state) : { ...state, ...patch }
      for (const fn of subs) fn(state)
    },
    subscribe(fn) {
      subs.add(fn)
      fn(state)
      return () => subs.delete(fn)
    },
  }
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

export { createStore }
