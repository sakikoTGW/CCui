/**
 * @ccui/engine-memory — CCui 自有引擎扩展的公共边界。
 *
 * 与 @ccui/engine-api（上游防腐层）相对：本包暴露的是 **CCui 自己写的**
 * 引擎能力——分层记忆栈、混合召回、记忆图、结构化(graphify)、headroom 压缩、
 * vault、ingest。物理文件暂留在 src/ccui/（受 git pull 上游影响小、且
 * "勿回退" 守护其位置），但消费方（daemon / 未来 GUI / 插件 / P10 召回可视化）
 * 一律从本边界导入，不再深引 src/ccui/...。
 *
 * 后续若把 src/ccui 物理迁出，只需改本文件的 re-export 源，外部零感知。
 */

// 分层栈初始化
export { initCcuiStack } from 'src/ccui/init.js'

// 记忆特性开关 / 限额
export {
  isCcuiMemoryEnabled,
  CCUI_DEFAULT_FEATURE_OVERRIDES,
  CCUI_MEMORY_LIMITS,
} from 'src/ccui/memory/config.js'

// CCui 各引擎子系统（命名空间分组，避免符号碰撞，给 P10/插件留稳定入口）
export * as memoryGraph from 'src/ccui/memory/memoryGraph.js'
export * as hybridRecall from 'src/ccui/memory/hybridRecall.js'
export * as recallLog from 'src/ccui/memory/recallLog.js'
export * as vectorIndex from 'src/ccui/memory/vectorIndex.js'
export * as incrementalExtract from 'src/ccui/memory/incrementalExtract.js'
export * as memoryInit from 'src/ccui/memory/init.js'
export * as structure from 'src/ccui/structure/graphify.js'
export * as headroom from 'src/ccui/headroom/compress.js'
export * as vault from 'src/ccui/vault/tolaria.js'
export * as ingest from 'src/ccui/ingest/markitdown.js'
