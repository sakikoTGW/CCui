/**
 * @ccui/plugin-sdk — 宿主侧入口（manifest 校验 + 协议 + 宿主桥）。
 * 访客侧 SDK 在 "@ccui/plugin-sdk/guest"（纯 JS，供 iframe 直载）。
 */
export * from './manifest'
export * from './protocol'
export * from './host'
