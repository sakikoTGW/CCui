/**
 * ModelRouter — 模型分级路由（框架核心机制）
 *
 * 目标：发挥强模型能力的同时，把简单任务交给弱模型，省钱提速。
 * 与编排天然契合：强模型当协调者(coordinator)、弱模型当执行者(worker)。
 *
 * 注入点：每次发起一轮对话(ask)前，由 route() 决定 userSpecifiedModel；
 * 子 agent 各自带 model，可独立分级。纯逻辑、无引擎依赖，可单测。
 */

export type ModelTier = 'strong' | 'weak'

/** 路由模式：auto 自动分级；strong-only/weak-only 兜底强制 */
export type RoutingMode = 'auto' | 'strong-only' | 'weak-only'

/**
 * 任务类型 — 决定默认走强还是弱模型。
 * 难活（规划/编排/复杂推理/最终审查）→ 强；简单活（检索/格式/摘要/分类/抽取）→ 弱。
 */
export type TaskType =
  | 'plan'
  | 'orchestrate'
  | 'reason'
  | 'review'
  | 'edit'
  | 'search'
  | 'format'
  | 'summarize'
  | 'classify'
  | 'extract'
  | 'chat'

const STRONG_TASKS: ReadonlySet<TaskType> = new Set<TaskType>([
  'plan',
  'orchestrate',
  'reason',
  'review',
])

const WEAK_TASKS: ReadonlySet<TaskType> = new Set<TaskType>([
  'search',
  'format',
  'summarize',
  'classify',
  'extract',
])

export type ModelRouterConfig = {
  strongModel: string
  weakModel: string
  mode: RoutingMode
  /** complexity ≥ 此阈值 → 升级强模型（0..1） */
  complexityThreshold: number
  /** 上下文 token ≥ 此值 → 升级强模型（大上下文弱模型易翻车） */
  largeContextTokens: number
}

export const DEFAULT_ROUTER_CONFIG: ModelRouterConfig = {
  strongModel: 'deepseek-v4-pro',
  weakModel: 'deepseek-v4-flash',
  mode: 'auto',
  complexityThreshold: 0.6,
  largeContextTokens: 60_000,
}

export type RoutingRequest = {
  taskType?: TaskType
  /** 预估复杂度 0..1，可由调用方/分类器给出 */
  estimatedComplexity?: number
  /** 当前上下文 token 估计 */
  contextTokens?: number
  /** 显式指定模型，最高优先级（用户/agent 覆盖） */
  pinnedModel?: string
  /** 高风险操作（动钱/schema/删除等），强制强模型复核 */
  isHighRisk?: boolean
}

export type RoutingDecision = {
  model: string
  tier: ModelTier
  reason: string
}

/** 每 1M token 价格（USD），占位默认值，需按实际计费校准 */
export type ModelPrice = { inputPerMTok: number; outputPerMTok: number }

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'deepseek-v4-pro': { inputPerMTok: 0.56, outputPerMTok: 1.68 },
  'deepseek-v4-flash': { inputPerMTok: 0.07, outputPerMTok: 0.28 },
}

export type UsageRecord = {
  model: string
  tier: ModelTier
  taskType?: TaskType
  inputTokens: number
  outputTokens: number
  costUsd: number
  timestamp: number
}

/** 用量汇聚接口（驾驶舱/可观测层实现，写回事件总线） */
export interface UsageSink {
  record(entry: UsageRecord): void
}

export class ModelRouter {
  private config: ModelRouterConfig
  private prices: Record<string, ModelPrice>
  private sink?: UsageSink

  constructor(opts?: {
    config?: Partial<ModelRouterConfig>
    prices?: Record<string, ModelPrice>
    sink?: UsageSink
  }) {
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...opts?.config }
    this.prices = { ...DEFAULT_PRICES, ...opts?.prices }
    this.sink = opts?.sink
  }

  getConfig(): Readonly<ModelRouterConfig> {
    return this.config
  }

  setConfig(patch: Partial<ModelRouterConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  /** 决定本次调用用哪个模型 */
  route(req: RoutingRequest = {}): RoutingDecision {
    const { strongModel, weakModel, mode } = this.config

    if (req.pinnedModel) {
      const tier = req.pinnedModel === weakModel ? 'weak' : 'strong'
      return { model: req.pinnedModel, tier, reason: 'pinned' }
    }

    // 高风险永远走强模型（即便 weak-only 也升级，安全优先）
    if (req.isHighRisk) {
      return { model: strongModel, tier: 'strong', reason: 'high-risk escalate' }
    }

    if (mode === 'strong-only') {
      return { model: strongModel, tier: 'strong', reason: 'mode=strong-only' }
    }
    if (mode === 'weak-only') {
      return { model: weakModel, tier: 'weak', reason: 'mode=weak-only' }
    }

    // auto 分级
    if (req.taskType && STRONG_TASKS.has(req.taskType)) {
      return { model: strongModel, tier: 'strong', reason: `task=${req.taskType}` }
    }
    if (
      req.contextTokens !== undefined &&
      req.contextTokens >= this.config.largeContextTokens
    ) {
      return {
        model: strongModel,
        tier: 'strong',
        reason: `large-context ${req.contextTokens}`,
      }
    }
    if (
      req.estimatedComplexity !== undefined &&
      req.estimatedComplexity >= this.config.complexityThreshold
    ) {
      return {
        model: strongModel,
        tier: 'strong',
        reason: `complexity ${req.estimatedComplexity}`,
      }
    }
    if (req.taskType && WEAK_TASKS.has(req.taskType)) {
      return { model: weakModel, tier: 'weak', reason: `task=${req.taskType}` }
    }

    // 无明确信号 → 保守走强模型（宁可贵不可错）
    return { model: strongModel, tier: 'strong', reason: 'default-conservative' }
  }

  /** 估算单次调用成本（USD） */
  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const price = this.prices[model]
    if (!price) return 0
    return (
      (inputTokens / 1_000_000) * price.inputPerMTok +
      (outputTokens / 1_000_000) * price.outputPerMTok
    )
  }

  /** 记录一次用量，回写 sink（驾驶舱/可观测） */
  recordUsage(args: {
    model: string
    tier: ModelTier
    taskType?: TaskType
    inputTokens: number
    outputTokens: number
  }): UsageRecord {
    const costUsd = this.estimateCost(
      args.model,
      args.inputTokens,
      args.outputTokens,
    )
    const entry: UsageRecord = {
      ...args,
      costUsd,
      timestamp: Date.now(),
    }
    this.sink?.record(entry)
    return entry
  }
}
