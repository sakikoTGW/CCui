/**
 * Typed in-renderer event bus — the single transport for cross-cutting renderer
 * signals (switch-view, project-changed, review-queue, ...).
 *
 * Implemented as a thin TYPED wrapper over window CustomEvents (channel name
 * `ccui:<type>`). This is deliberate: during the vanilla→React migration both
 * worlds must interoperate. An island `bus.emit('switch-view','chat')` reaches
 * a legacy `window.addEventListener('ccui:switch-view')` and vice-versa, so
 * call sites can move to the typed API incrementally with zero regression.
 *
 * Compile-time payload safety + one place to grep/trace/intercept every signal
 * (the future plugin layer hooks here). Daemon traffic goes through ipc/client.ts.
 */

export interface BusEvents {
  /** 切换主视图（活动栏路由） */
  'switch-view': string
  /** 当前项目已切换（detail 可能携带项目信息，监听方多数只关心"变了"） */
  'project-changed': unknown
  /** 变更审查队列快照 */
  'review-queue': unknown[]
  /** 「始终允许」工具列表更新 */
  'perms-updated': string[]
  /** 请求布局自检（compact 回归） */
  'layout-check': void
  /** 新建对话 */
  'new-convo': void
  /** 进入 Compare 三路变异模式 */
  'start-compare': void
  /** 核对进度（对照目标是否偏离） */
  'align-check': void
  /** 聚焦「这次要做」目标编辑 */
  'focus-goal': void
  /** 应用一个 Task Brief（detail = brief 对象） */
  'apply-brief': unknown
  /** 在输入框前缀插入文本 */
  'insert-prompt': string
  /** 整体设置输入框文本 */
  'set-prompt': string
  /** 打开/预览文件（文件树） */
  'openfile': { path?: string }
  /** 审查窗对某条 diff 的接受/拒绝回流到对话 */
  'review-diff': { item?: unknown; allow?: boolean }
  /** 审查窗对某条权限请求的接受/拒绝回流到对话 */
  'review-perm': { permId?: unknown; allow?: boolean }
  /** 主题已切换（明暗/内置主题） */
  'theme-changed': { theme?: string }
  /** 代码高亮主题需要重刷 */
  'hljs-theme': void
  /** 外观个性化已变更（detail = Personalize） */
  'personalize-changed': unknown
  /** 背景视差暂停/恢复 */
  'parallax-pause': boolean
}

export type BusEvent = keyof BusEvents

type Handler<K extends BusEvent> = (payload: BusEvents[K]) => void

const PREFIX = 'ccui:'
const target: EventTarget | undefined = typeof window !== 'undefined' ? window : undefined

export const bus = {
  on<K extends BusEvent>(type: K, handler: Handler<K>): () => void {
    if (!target) return () => {}
    const wrapped = (e: Event) => {
      try {
        handler((e as CustomEvent).detail as BusEvents[K])
      } catch (err) {
        // never let one listener break others
        // eslint-disable-next-line no-console
        console.error(`bus handler for "${String(type)}" threw`, err)
      }
    }
    target.addEventListener(PREFIX + type, wrapped)
    return () => target.removeEventListener(PREFIX + type, wrapped)
  },
  emit<K extends BusEvent>(
    type: K,
    ...payload: BusEvents[K] extends void ? [] : [BusEvents[K]]
  ): void {
    if (!target) return
    const detail = (payload as unknown[])[0]
    target.dispatchEvent(new CustomEvent(PREFIX + type, { detail }))
  },
}

export type Bus = typeof bus
