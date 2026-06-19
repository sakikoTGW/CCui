/**
 * AgentSession — headless 会话封装（M0 核心）
 *
 * 把现有 Ink/REPL 引擎剥离成可被 GUI(daemon) 调用的会话：
 *   - 基于现成的 headless 入口 `ask()`（print/SDK 同款），不依赖 React/Ink
 *   - 集成 ModelRouter：每轮按任务分派强/弱模型（userSpecifiedModel 注入）
 *   - 事件回调风格（assistant 文本 / 工具 / 权限请求 / 用量 / 结束），贴合 IPC
 *   - 权限走 out-of-band：behavior=ask 时发 permission_request，等前端 respondPermission
 *
 * 注意：core 引擎依赖 `bun:bundle` 的 feature()，必须在 Bun 运行时跑（daemon = Bun 子进程）。
 */
import {
  ask,
  createStore,
  type Store,
  getDefaultAppState,
  type AppState,
  assembleToolPool,
  hasPermissionsToUseTool,
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
  type FileStateCache,
  type CanUseToolFn,
  type Message,
  type PermissionDecision,
} from '@ccui/engine-api'
import { ModelRouter, type TaskType } from './modelRouter.js'
import { getFilteredCommands } from './resourceFilters.js'

type SDKMessage = { type: string; [k: string]: unknown }

export type GuiEvent =
  | { type: 'route'; model: string; tier: 'strong' | 'weak'; reason: string }
  | { type: 'message'; sdk: SDKMessage }
  | { type: 'delta'; kind: 'text' | 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'permission_request'; id: string; toolName: string; input: unknown; message: string }
  | { type: 'usage'; model: string; inputTokens: number; outputTokens: number; costUsd: number }
  | { type: 'done' }
  | { type: 'interrupted' }
  | { type: 'error'; error: string }

type EventListener = (e: GuiEvent) => void

export type AgentSessionOptions = {
  cwd?: string
  router?: ModelRouter
  /** 自动批准 ask 类权限（demo/无人值守用；GUI 默认 false，走前端确认） */
  autoApprove?: boolean
  /** 单轮最大迭代数，防工具失败导致失控循环 */
  maxTurns?: number
}

export class AgentSession {
  readonly cwd: string
  readonly router: ModelRouter
  private autoApprove: boolean
  private maxTurns: number
  private store: Store<AppState>
  private readFileState: FileStateCache
  private messages: Message[] = []
  private commands: Awaited<ReturnType<typeof getFilteredCommands>> = []
  private listeners = new Set<EventListener>()
  private pendingPermissions = new Map<
    string,
    (decision: PermissionDecision) => void
  >()
  private initialized = false
  private abortController: AbortController | null = null
  private allowedTools = new Set<string>()

  constructor(opts: AgentSessionOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd()
    this.router = opts.router ?? new ModelRouter()
    this.autoApprove = opts.autoApprove ?? false
    this.maxTurns = opts.maxTurns ?? 32
    this.store = createStore(getDefaultAppState())
    this.readFileState = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    )
  }

  onEvent(cb: EventListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(e: GuiEvent): void {
    for (const l of this.listeners) l(e)
  }

  async init(): Promise<void> {
    if (this.initialized) return
    const { bootstrapGuiDev } = await import('./bootstrap.js')
    await bootstrapGuiDev(this.cwd)
    this.commands = await getFilteredCommands(this.cwd)
    this.initialized = true
  }

  /** 控制台硬过滤变更后刷新命令列表 */
  async reloadCommands(): Promise<void> {
    if (!this.initialized) return
    this.commands = await getFilteredCommands(this.cwd)
  }

  /** 重置对话历史（用于新分支/新会话从干净上下文开始） */
  resetHistory(): void {
    this.interrupt()
    this.messages = []
    this.readFileState = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    )
  }

  /**
   * GUI 续接：优先恢复引擎侧全量 messages；旧数据则从 items 逐条重建。
   */
  async hydrateFromGui(payload: {
    engineMessages?: Message[]
    items?: Array<{ t: string; text?: string; sdk?: Message }>
  }): Promise<void> {
    this.resetHistory()
    const { engineMessages, items } = payload || {}
    if (engineMessages?.length) {
      this.messages = structuredClone(engineMessages)
      return
    }
    if (!items?.length) return
    const { createUserMessage } = await import('../utils/messages.js')
    for (const it of items) {
      if (it.t === 'user' && typeof it.text === 'string' && it.text.length) {
        this.messages.push(createUserMessage({ content: it.text }))
      } else if (
        it.t === 'msg' &&
        it.sdk &&
        (it.sdk.type === 'assistant' || it.sdk.type === 'user')
      ) {
        this.messages.push(structuredClone(it.sdk))
      }
    }
  }

  /** 导出引擎侧完整上下文（供 GUI 持久化） */
  exportMessages(): Message[] {
    return structuredClone(this.messages)
  }

  /** 中断当前进行中的一轮（停止按钮） */
  interrupt(): void {
    this.abortController?.abort()
    for (const [, resolve] of this.pendingPermissions) {
      resolve({ behavior: 'deny', message: '已中断', decisionReason: { type: 'other', reason: 'interrupted' } })
    }
    this.pendingPermissions.clear()
  }

  /** GUI：始终允许的工具名列表 */
  setAllowedTools(tools: string[]): void {
    this.allowedTools = new Set(tools)
  }

  /** 前端对一次 permission_request 的回应 */
  respondPermission(id: string, decision: PermissionDecision): void {
    const resolve = this.pendingPermissions.get(id)
    if (resolve) {
      this.pendingPermissions.delete(id)
      resolve(decision)
    }
  }

  private canUseTool: CanUseToolFn = async (
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseId,
    forceDecision,
  ) => {
    if (forceDecision !== undefined) return forceDecision
    const decision = await hasPermissionsToUseTool(
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseId,
    )
    if (decision.behavior !== 'ask') return decision

    if (this.allowedTools.has(tool.name)) {
      return { behavior: 'allow', updatedInput: input as Record<string, unknown> }
    }

    const message =
      'message' in decision ? decision.message : `允许使用 ${tool.name}?`
    this.emit({
      type: 'permission_request',
      id: toolUseId,
      toolName: tool.name,
      input,
      message,
    })

    if (this.autoApprove) {
      return { behavior: 'allow', updatedInput: input as Record<string, unknown> }
    }
    return new Promise<PermissionDecision>(resolve => {
      this.pendingPermissions.set(toolUseId, resolve)
    })
  }

  /** 发送一条用户消息，事件通过 onEvent 推送 */
  async send(
    text: string,
    opts: { taskType?: TaskType; model?: string; systemPrompt?: string } = {},
  ): Promise<void> {
    await this.init()

    const state = this.store.getState()
    const contextTokens = estimateTokens(this.messages)
    const decision = this.router.route({
      taskType: opts.taskType,
      contextTokens,
      pinnedModel: opts.model,
    })
    this.emit({
      type: 'route',
      model: decision.model,
      tier: decision.tier,
      reason: decision.reason,
    })

    const tools = assembleToolPool(state.toolPermissionContext, state.mcp.tools)

    this.abortController = new AbortController()
    const signal = this.abortController.signal
    let lastUsage: { inputTokens: number; outputTokens: number } | null = null
    try {
      for await (const sdk of ask({
        commands: this.commands,
        prompt: text,
        cwd: this.cwd,
        tools,
        mcpClients: [],
        canUseTool: this.canUseTool,
        userSpecifiedModel: decision.model,
        appendSystemPrompt: opts.systemPrompt,
        includePartialMessages: true,
        maxTurns: this.maxTurns,
        mutableMessages: this.messages,
        abortController: this.abortController,
        getAppState: () => this.store.getState(),
        setAppState: f => this.store.setState(f),
        getReadFileCache: () => this.readFileState,
        setReadFileCache: c => {
          this.readFileState = c
        },
      }) as AsyncGenerator<SDKMessage>) {
        // 流式增量：stream_event 单独走 delta，不当 message 持久化
        if (sdk.type === 'stream_event') {
          const ev = (sdk as { event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } } }).event
          if (ev?.type === 'content_block_delta' && ev.delta) {
            if (ev.delta.type === 'text_delta' && ev.delta.text) {
              this.emit({ type: 'delta', kind: 'text', text: ev.delta.text })
            } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
              this.emit({ type: 'delta', kind: 'thinking', text: ev.delta.thinking })
            }
          }
          continue
        }

        this.emit({ type: 'message', sdk })

        const text = extractAssistantText(sdk)
        if (text) this.emit({ type: 'text', text })

        const usage = extractUsage(sdk)
        if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
          lastUsage = usage
        }
      }
      if (lastUsage) {
        const rec = this.router.recordUsage({
          model: decision.model,
          tier: decision.tier,
          taskType: opts.taskType,
          inputTokens: lastUsage.inputTokens,
          outputTokens: lastUsage.outputTokens,
        })
        this.emit({
          type: 'usage',
          model: decision.model,
          inputTokens: lastUsage.inputTokens,
          outputTokens: lastUsage.outputTokens,
          costUsd: rec.costUsd,
        })
      }
      this.emit({ type: 'done' })
    } catch (err) {
      const aborted =
        signal.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      if (aborted) {
        this.emit({ type: 'interrupted' })
      } else {
        this.emit({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      this.abortController = null
    }
  }
}

function estimateTokens(messages: Message[]): number {
  let chars = 0
  for (const m of messages) chars += JSON.stringify(m).length
  return Math.ceil(chars / 4)
}

function extractAssistantText(sdk: SDKMessage): string | null {
  if (sdk.type !== 'assistant') return null
  const msg = (sdk.message ?? sdk) as { content?: unknown }
  const content = msg.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' && (b as { type?: string }).type === 'text',
      )
      .map(b => b.text)
    return parts.length ? parts.join('') : null
  }
  return null
}

function extractUsage(
  sdk: SDKMessage,
): { inputTokens: number; outputTokens: number } | null {
  const usage = (sdk.usage ??
    (sdk.message as { usage?: unknown } | undefined)?.usage) as
    | { input_tokens?: number; output_tokens?: number }
    | undefined
  if (!usage) return null
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  }
}
