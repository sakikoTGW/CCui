/**
 * @ccui/protocol — renderer / daemon / indexer 共用的唯一 IPC 契约。
 *
 * 单一真相 = zod schema：
 *   - 类型由 z.infer 推出，前后端共享
 *   - 运行时由 parse/safeParse 校验，跨进程字段漂移变成错误而非静默错位
 */
export * from './errors.js'
export * from './commands.js'
export * from './events.js'
export * from './validate.js'
