# CCui 栈架构

> 本文档描述 CCui 在 vendored Claude Code 引擎(`src/`)之上自研的外壳架构。
> 上游引擎本身见 [ARCHITECTURE.md](ARCHITECTURE.md) / [MODULES.md](MODULES.md)。

CCui 的目标:让引擎**模块化、插件化、故障隔离、可观测**,并与上游 `git pull` 无冲突。

---

## 1. 四进程模型

```
┌────────────────────┐  ipcRenderer/ipcMain  ┌──────────────────┐  stdio NDJSON  ┌──────────────────┐
│ Electron Renderer  │ ───────────────────▶ │  Electron Main   │ ─────────────▶ │   Bun Daemon     │
│  apps/desktop      │ ◀─────────────────── │  apps/desktop    │ ◀───────────── │ services/daemon  │
│  (UI + React 孤岛) │                       │  main.js         │                │ (引擎会话)        │
└────────────────────┘                       └──────────────────┘                └────────┬─────────┘
                                                                                            │ in-proc
                                                                              ┌─────────────▼─────────────┐
                                                                              │  Claude Code Engine (src/) │
                                                                              │  经 engine-api / -memory   │
                                                                              └────────────────────────────┘
                                                          子进程(故障隔离) ┌──────────────────────────┐
                                                                            │ crates/ccui-indexer (Rust) │
                                                                            └──────────────────────────┘
```

- **Renderer ↔ Main**:Electron IPC,preload 暴露 `window.ccui`。
- **Main ↔ Daemon**:stdio NDJSON,每行一条 `packages/protocol` 校验过的消息。
- **Daemon ↔ Engine**:同进程,但只经门面包(见 §3)。
- **索引器**:独立 Rust 二进制,daemon 以子进程调用,崩溃不影响 daemon(见 §5)。

---

## 2. 协议(packages/protocol)

zod 定义的**单一真相**:`CommandSchema`(renderer→daemon)与事件/响应信封。

- daemon 的命令注册表(`services/daemon/handlers.ts`)按 `CommandKind` 强制全覆盖——漏写 handler 即编译失败。
- renderer 客户端(`apps/desktop/src/ipc/client.ts`)以 `reqId` 关联请求/响应,错误以 `CcuiError` 信封返回,**绝不静默吞错**。
- 新增命令只改 `packages/protocol/commands.ts` 一处。

---

## 3. 引擎门面边界

daemon **零深引** `src/`,所有上游接触面收窄到两个包:

| 包 | 作用 |
|----|------|
| `@ccui/engine-api` | 上游引擎的反腐层:re-export `ask` / store / 工具池 / 权限 / 配置 等 daemon 真正需要的窄接口 |
| `@ccui/engine-memory` | CCui 自有引擎扩展:`src/ccui/` 的记忆/结构/headroom/vault/ingest |

好处:上游 `git pull` 不会与 daemon 产生 import 冲突;边界清晰,易测。

---

## 4. 渲染层(apps/desktop)

Strangler-fig 渐进迁移:vanilla `renderer.js` 为宿主,迁移完成的功能是 **React 孤岛**。

- **孤岛**:`src/features/*` 经 `src/islands.ts` 的 `mount*` 挂载,每个孤岛包 `ErrorBoundary`(可选功能崩溃只炸自己,核心崩溃才上抛全屏)。
- **状态**:`app/store.js` 以 zustand vanilla 为引擎 + back-compat `get/set/subscribe` 适配器;React 侧用 `src/shell/store.ts` 的 `useCcuiStore` 选择器钩子共享同一实例。
- **事件总线**:`src/shell/bus.ts` + `app/bus.js` 以 window-event 薄封装打通「孤岛 ↔ vanilla」两个世界。
- **持久化**:`src/data/idb.ts` 提供 typed 按实体仓(presets/conversations/templates/settings)。
- **导航**:`app/nav.js` 的 `NAV_VIEWS` 数据驱动;视图在 `renderer.js` 的 `VIEWS` map 注册。

---

## 5. Rust 原生索引器(crates/ccui-indexer)

项目结构图扫描的热路径(原 TS 实现封顶 350 文件)替换为独立 Rust 二进制:

- `ignore` 并行(rayon)gitignore-aware walk + `regex` 抽取 import + `serde_json` 输出 ProjectGraph。
- 门面 `services/daemon/projectIndexer.ts`:**native 优先,缺失/失败回退 TS 慢路径**,子进程故障隔离。
- 构建:`bun run build:indexer`(无 cargo 时非致命跳过,daemon 用 TS 兜底)。

---

## 6. 插件系统(packages/plugin-sdk + plugins/)

第三方插件 = 一个目录 + `ccui.plugin.json`(zod 清单)。

- **隔离**:UI 插件渲染进 `sandbox="allow-scripts"`(无 same-origin)的 iframe,唯一通道是 postMessage。
- **能力门控**:清单 `permissions` 显式声明,宿主 `createPluginBridge` 按权限 + 协议白名单(可触发事件/可订阅事件/可调 daemon 只读命令)二次约束。
- **访客 SDK**:`window.ccui`(srcdoc 自动注入)或 `@ccui/plugin-sdk/guest`(打包型),提供 `toast/emit/on/getState/daemon`。
- **宿主**:`apps/desktop/src/features/plugins/PluginHost.tsx` 经 daemon 扫 `plugins/` 发现并渲染。
- 示例:`plugins/hello`。

---

## 7. 产品差异化

- **记忆召回可视**:`getRecall` 命令读引擎内存的召回日志(`engine-memory` 的 `recallLog`,hybridRecall 每轮 `recordRecall`);chat 把「本轮基于哪些记忆」作为可展开卡片渲染进对话流(候选/打分/命中理由/图谱关联),并随会话持久化。
- **对话内审查**:`chat/diff.js` 的 diff 卡自带 inline 接受/拒绝 + 入审查队列 + 跨视图 bus 联动。
- **错误隔离**:feature registry 标 criticality;两层 React error boundary;diag 上报桥写 `logs/`。

---

## 8. 验证手段

| 命令 | 覆盖 |
|------|------|
| `bun run test:unit` | 协议(9) + 插件 SDK(25)单测 |
| `bun run scripts/probe-plugin-discovery.ts` | 真实 daemon 端到端插件发现 |
| `bun run scripts/probe-recall.ts` | 真实 daemon `getRecall` 链路 |
| `bun run smoke` | CLI 路径自检 |
| `bun run human` | GUI 冷启动 ready + 布局验收(模拟人类) |
| `apps/desktop` `npm run typecheck` / `build:islands` | 类型 + 孤岛构建 |
