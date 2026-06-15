#!/usr/bin/env bun
/**
 * 从 Zod schema 生成 SDK 类型文件（完整版需对接 TypeOverrideMap）。
 * 当前 dev 环境使用 hand-written stub；此脚本保留为后续完善入口。
 */
console.log('SDK types: using committed stubs in src/entrypoints/sdk/*.generated.ts')
console.log('Run typecheck after editing coreSchemas.ts / controlSchemas.ts')
