/**
 * @ccui/engine-api — 上游 Claude Code 引擎的唯一接触面（门面 / 防腐层）。
 *
 * 为什么存在：
 *   `src/` 是会持续 `git pull` 同步的上游源码（~1986 文件）。CCui 自有代码
 *   （daemon / 未来 GUI / 插件）若直接深引 `src/core/...`、`src/utils/...`，
 *   上游每次挪文件/改名都会在 CCui 各处崩。把这层接触面收敛到本文件后：
 *     - 上游 churn 只砸这一处 → 修一行全线通（故障隔离）。
 *     - CCui 侧只认 `@ccui/engine-api`，不认上游内部目录结构。
 *     - 想换引擎实现，也只需替换本门面。
 *
 * 约束：本文件是唯一允许深引 `src/*` 引擎内部的地方（CCui 自有的 src/ccui
 *   走 @ccui/engine-memory）。新增引擎依赖时，先在这里 re-export。
 */

// 核心查询循环（headless ask）
export { ask } from 'src/core/QueryEngine.js'

// 引擎状态容器
export { createStore } from 'src/state/store.js'
export type { Store } from 'src/state/store.js'
export { getDefaultAppState } from 'src/state/AppStateStore.js'
export type { AppState } from 'src/state/AppStateStore.js'

// 工具池装配
export { assembleToolPool } from 'src/tools.js'

// 权限判定
export { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js'
export type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'

// 文件状态缓存
export {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from 'src/utils/fileStateCache.js'
export type { FileStateCache } from 'src/utils/fileStateCache.js'

// 命令 / 记忆 / agent 资源缓存
export { getCommands, clearCommandsCache } from 'src/commands/registry.js'
export { clearMemoryFileCaches } from 'src/utils/claudemd.js'
export { clearAgentDefinitionsCache } from 'src/tools/AgentTool/loadAgentsDir.js'

// bootstrap 全局状态
export {
  setOriginalCwd,
  setProjectRoot,
  setSessionTrustAccepted,
} from 'src/bootstrap/state.js'

// 配置读写
export {
  checkHasTrustDialogAccepted,
  enableConfigs,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from 'src/utils/config.js'

// 引擎类型（避免与 @ccui/protocol 的 Command 混淆，引擎侧用 EngineCommand）
export type { Command as EngineCommand } from 'src/types/command.js'
export type { Message } from 'src/types/message.js'
export type { PermissionDecision } from 'src/types/permissions.js'
