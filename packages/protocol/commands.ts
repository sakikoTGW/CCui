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
  z.object({ cmd: z.literal('respondPermission'), id: z.string(), allow: z.boolean(), sessionId, updatedInput: z.record(z.string(), z.unknown()).optional() }),
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
  z.object({ cmd: z.literal('captureProxy'), action: z.enum(['start', 'stop', 'status']), port: z.number().optional(), upstream: z.string().optional(), reqId }),
  z.object({ cmd: z.literal('captureList'), reqId }),
  z.object({ cmd: z.literal('addMcpServer'), name: z.string(), config: z.record(z.string(), z.unknown()), reqId }),
  z.object({ cmd: z.literal('removeMcpServer'), name: z.string(), reqId }),
  z.object({ cmd: z.literal('verifyMcp'), name: z.string(), reqId }),
  z.object({ cmd: z.literal('addSkillPath'), path: z.string(), reqId }),
  z.object({ cmd: z.literal('addRulePath'), path: z.string(), reqId }),
  z.object({ cmd: z.literal('setProjectRoot'), path: z.string(), reqId }),
  z.object({ cmd: z.literal('testApi'), reqId }),
  z.object({ cmd: z.literal('searchCode'), query: z.string(), limit: z.number().optional(), reqId }),
  z.object({ cmd: z.literal('buildCodeIndex'), reqId }),
  z.object({ cmd: z.literal('packList'), reqId }),
  z.object({ cmd: z.literal('packExport'), runtime: z.string().optional(), name: z.string().optional(), noHarness: z.boolean().optional(), reqId }),
  z.object({ cmd: z.literal('packRead'), path: z.string(), reqId }),
  z.object({ cmd: z.literal('packApply'), path: z.string().optional(), pack: z.record(z.string(), z.unknown()).optional(), reqId }),
  z.object({ cmd: z.literal('bundleExport'), workspace: z.unknown().optional(), reqId }),
  z.object({ cmd: z.literal('bundleImport'), bundle: z.record(z.string(), z.unknown()), reqId }),
  z.object({ cmd: z.literal('getProjectConfig'), reqId }),
  z.object({ cmd: z.literal('listRuntimes'), reqId }),
  z.object({ cmd: z.literal('packCatalog'), runtime: z.string().optional(), reqId }),
  z.object({ cmd: z.literal('packImportRuntime'), runtime: z.string(), reqId }),
  z.object({ cmd: z.literal('packInstallCatalog'), entryId: z.string(), reqId }),
  z.object({ cmd: z.literal('packInstallFile'), path: z.string(), reqId }),
  z.object({ cmd: z.literal('packInstallInline'), pack: z.record(z.string(), z.unknown()), filename: z.string().optional(), reqId }),
  z.object({ cmd: z.literal('packExportPortable'), runtime: z.string().optional(), name: z.string().optional(), reqId }),
  // —— 实例（PCL 启动器）——
  z.object({ cmd: z.literal('instanceList'), reqId }),
  z.object({ cmd: z.literal('instanceCreate'), name: z.string(), runtime: z.string(), reqId }),
  z.object({ cmd: z.literal('instanceDelete'), id: z.string(), reqId }),
  z.object({ cmd: z.literal('instanceActivate'), id: z.string(), reqId }),
  z.object({ cmd: z.literal('instanceInstallCatalog'), id: z.string(), entryId: z.string(), reqId }),
  z.object({ cmd: z.literal('instanceInstallFile'), id: z.string(), path: z.string(), reqId }),
  z.object({ cmd: z.literal('instanceInstallInline'), id: z.string(), pack: z.record(z.string(), z.unknown()), reqId }),
  z.object({ cmd: z.literal('instanceImportRuntime'), id: z.string(), runtime: z.string(), reqId }),
  z.object({ cmd: z.literal('instanceRemovePack'), id: z.string(), packName: z.string(), reqId }),
  z.object({ cmd: z.literal('instanceSetIntercept'), id: z.string(), enabled: z.boolean(), upstream: z.string().optional(), reqId }),
  z.object({ cmd: z.literal('packExportAstrbotPlugin'), path: z.string().optional(), pack: z.record(z.string(), z.unknown()).optional(), dest: z.string().optional(), reqId }),
  z.object({ cmd: z.literal('runtimeBaseUrl'), runtime: z.string(), baseUrl: z.string().optional(), revert: z.boolean().optional(), reqId }),
  // —— project-profile（项目心智 / 存档）——
  z.object({ cmd: z.literal('profileList'), reqId }),
  z.object({ cmd: z.literal('profileExport'), name: z.string().optional(), reqId }),
  z.object({ cmd: z.literal('profileImport'), path: z.string().optional(), profile: z.record(z.string(), z.unknown()).optional(), overwrite: z.boolean().optional(), reqId }),
  z.object({ cmd: z.literal('auditList'), limit: z.number().optional(), reqId }),
])

/** 按 cmd 取出对应命令的精确类型，便于 handler 标注。 */
export type CommandOf<K extends Command['cmd']> = Extract<Command, { cmd: K }>

export type CommandKind = Command['cmd']
