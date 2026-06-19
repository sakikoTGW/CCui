import { z } from 'zod'

/**
 * Command — renderer → daemon 的唯一命令面。
 * 单一真相：daemon 注册表与 renderer api 层都从这里推类型。
 * 新增命令只改这里，漏改一端 → 编译失败。
 */

/** 编排 lane 规格。 */
export const LaneSpecSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  sessionId: z.string().optional(),
})
export type LaneSpec = z.infer<typeof LaneSpecSchema>

/** 资源映射（控制台禁用项回填）。 */
export const ResourceMapSchema = z.record(
  z.string(),
  z.object({ kind: z.string(), name: z.string(), path: z.string().optional() }),
)
export type ResourceMap = z.infer<typeof ResourceMapSchema>

const reqId = z.string().optional()
const sessionId = z.string().optional()

export const HydrateItemSchema = z.object({
  t: z.string(),
  text: z.string().optional(),
  sdk: z.unknown().optional(),
})

export const CommandSchema = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('ping'), reqId }),
  z.object({ cmd: z.literal('send'), text: z.string(), taskType: z.string().optional(), model: z.string().optional(), systemPrompt: z.string().optional(), sessionId }),
  z.object({ cmd: z.literal('respondPermission'), id: z.string(), allow: z.boolean(), updatedInput: z.record(z.string(), z.unknown()).optional() }),
  z.object({ cmd: z.literal('setRouter'), patch: z.record(z.string(), z.unknown()) }),
  z.object({ cmd: z.literal('setAllowedTools'), tools: z.array(z.string()), reqId }),
  z.object({ cmd: z.literal('interrupt'), sessionId }),
  z.object({ cmd: z.literal('interruptOrchestrate') }),
  z.object({ cmd: z.literal('reset'), sessionId }),
  z.object({ cmd: z.literal('hydrate'), sessionId, items: z.array(HydrateItemSchema).optional(), engineMessages: z.array(z.unknown()).optional() }),
  z.object({ cmd: z.literal('getMessages'), sessionId, reqId }),
  z.object({ cmd: z.literal('setEnv'), patch: z.record(z.string(), z.string()) }),
  z.object({ cmd: z.literal('setDisabledResources'), ids: z.array(z.string()), map: ResourceMapSchema.optional(), reqId }),
  z.object({ cmd: z.literal('listResources'), reqId }),
  z.object({ cmd: z.literal('toggleMcp'), name: z.string(), enabled: z.boolean(), reqId }),
  z.object({ cmd: z.literal('listDir'), path: z.string().optional(), reqId }),
  z.object({ cmd: z.literal('readFile'), path: z.string(), reqId }),
  z.object({ cmd: z.literal('projectGraph'), refresh: z.boolean().optional(), reqId }),
  z.object({ cmd: z.literal('getProjectInfo'), reqId }),
  z.object({ cmd: z.literal('getRecall'), reqId }),
  z.object({ cmd: z.literal('orchestrate'), prompt: z.string(), lanes: z.array(LaneSpecSchema), crossReview: z.boolean().optional(), synthesize: z.boolean().optional(), reqId }),
])

export type Command = z.infer<typeof CommandSchema>

/** 按 cmd 取出对应命令的精确类型，便于 handler 标注。 */
export type CommandOf<K extends Command['cmd']> = Extract<Command, { cmd: K }>

export type CommandKind = Command['cmd']
