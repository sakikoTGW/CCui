# 模块索引

> 各目录职责、关键文件、对外 API 一览。

---

## src/app/ — 应用入口层

| 文件 | 职责 |
|------|------|
| `main.tsx` | Commander CLI 主程序 (~4600 行)，flags 解析、trust dialog、launchRepl |
| `replLauncher.tsx` | 懒加载 App + REPL 并渲染 |
| `interactiveHelpers.tsx` | renderAndRun、exitWithError、showSetupScreens |
| `dialogLaunchers.tsx` | 各类对话框启动器 (resume、teleport、settings) |
| `projectOnboardingState.ts` | 项目 onboarding 状态 |

**对外**：`main()` 被 entrypoints/cli.tsx 动态 import。

---

## src/core/ — 核心业务层

| 文件 | 职责 |
|------|------|
| `query.ts` | REPL 主循环 async generator，API 流式 + tool orchestration |
| `QueryEngine.ts` | SDK/headless 引擎，submitMessage 多轮会话 |
| `tools.ts` | getTools() / assembleToolPool()，feature 条件加载 |
| `Tool.ts` | Tool 接口、ToolUseContext、CanUseToolFn |
| `context.ts` | getSystemContext / getUserContext 注入 |
| `setup.ts` | 会话初始化：cwd、worktree、UDS、hooks snapshot |
| `history.ts` | 输入历史 addToHistory / expandPastedTextRefs |
| `tasks.ts` / `Task.ts` | 后台任务抽象 |
| `cost-tracker.ts` | 费用追踪 getTotalCost / saveCurrentSessionCosts |
| `costHook.ts` | useCostSummary React hook |

---

## src/entrypoints/ — 进程入口

| 文件 | 职责 |
|------|------|
| `cli.tsx` | 最外层 bootstrap，fast-path 分流 |
| `init.ts` | enableConfigs、telemetry、graceful shutdown |
| `mcp.ts` | MCP server 模式 (StdioServerTransport) |
| `agentSdkTypes.js` | SDKMessage 协议类型 |

---

## src/commands/ — 斜杠命令

- `registry.ts` — 命令注册中心 COMMANDS 数组 + getCommands()
- `*/index.ts` — 各命令定义 (type, name, load)
- `*/xxx.tsx` — local-jsx 命令 UI
- `*.ts` — local/prompt 命令逻辑

**命令数量**：~80 builtin + dynamic (skills/plugins/MCP)

---

## src/components/ — UI 组件 (389 files)

| 子目录 | 职责 |
|--------|------|
| `design-system/` | ThemedBox、ThemedText、ThemeProvider |
| `permissions/` | Tool 确认、plan mode、auto mode (51 files) |
| `PromptInput/` | 主输入框 |
| `agents/` | Agent 编辑器、wizard |
| `diff/` | Diff 对话框 |
| `mcp/` | MCP 相关 UI |
| `Spinner/` | 加载动画 |
| `ClaudeCodeHint/` | 命令提示菜单 |

**根组件**：`App.tsx` — Provider 嵌套壳

---

## src/screens/ — 顶层屏幕

| 文件 | 职责 |
|------|------|
| `REPL.tsx` | 主交互屏幕 (~5000 行) |
| `Doctor.tsx` | doctor 子命令诊断 UI |
| `ResumeConversation.tsx` | 恢复会话选择 |

---

## src/ink/ — 终端渲染引擎 (96+1 files)

| 子目录/文件 | 职责 |
|-------------|------|
| `facade.ts` | 公共 API，自动包裹 ThemeProvider |
| `root.ts` | createRoot、render |
| `hooks/` | useInput、useTerminalSize、useSearchHighlight |
| `components/` | Box、Text、AppContext |
| `events/` | 键盘/鼠标事件 |
| `termio/` | 终端 IO、dec 序列 |

---

## src/bridge/ — Remote Control (31 files)

| 文件 | 职责 |
|------|------|
| `bridgeMain.ts` | remote-control 主进程 |
| `replBridge.ts` | initBridgeCore、ReplBridgeHandle |
| `initReplBridge.ts` | REPL 内 bridge 初始化 |
| `bridgeApi.ts` | HTTP API client |
| `inboundMessages.ts` | 入站消息解析 |
| `sessionRunner.ts` | session 子进程管理 |
| `types.ts` | BridgeConfig、WorkSecret |

---

## src/cli/ — CLI 辅助 (19 files)

| 子目录 | 职责 |
|--------|------|
| `transports/` | WebSocket、SSE、Hybrid 传输 |
| `handlers/` | auth、mcp、plugins、agents 子 CLI |
| `print.ts` | `-p` 模式 NDJSON 输出 |
| `structuredIO.ts` | 结构化 IO 协议 |
| `remoteIO.ts` | 远程 SDK 双向流 |

---

## src/services/ — 外部服务 (130 files)

| 子目录 | 文件数 | 职责 |
|--------|--------|------|
| `api/` | 20 | Anthropic API、bootstrap、retry |
| `mcp/` | 23 | MCP 连接、registry |
| `compact/` | 11 | 上下文压缩 |
| `analytics/` | 9 | GrowthBook、Datadog |
| `lsp/` | 7 | LSP client |
| `oauth/` | 5 | OAuth 认证 |
| `remoteManagedSettings/` | 5 | 企业远程设置 |

---

## src/tools/ — LLM Tools (184 files)

每个 Tool 一个目录，典型结构：

```
tools/BashTool/
  BashTool.tsx      — Tool 定义 + execute
  UI.tsx            — 结果渲染
  bashPermissions.ts
  utils.ts
```

---

## src/utils/ — 基础设施 (564 files)

| 子目录 | 职责 |
|--------|------|
| `config.js` | 全局/项目配置读写 |
| `messages.js` | 消息创建/规范化 |
| `permissions/` | 权限检查、denial tracking |
| `processUserInput/` | 用户输入解析 |
| `sessionStorage.js` | transcript 持久化 |
| `model/` | 模型选择与 override |
| `hooks/` | user hooks 执行 |
| `plugins/` | plugin 加载 |
| `skills/` | skill 加载 |
| `bash/` | bash 解析与权限 |

---

## src/hooks/ — React Hooks (104 files)

| 关键 Hook | 职责 |
|-----------|------|
| `useReplBridge.tsx` | REPL bridge 连接 |
| `useCanUseTool.tsx` | Tool 权限门控 |
| `useRemoteSession.ts` | 远程 session |
| `useDirectConnect.ts` | cc:// Direct Connect |
| `useMergedTools.ts` | 合并 MCP + builtin tools |
| `useMergedCommands.ts` | 合并 dynamic commands |

---

## src/state/ — 全局状态 (6 files)

| 文件 | 职责 |
|------|------|
| `AppState.tsx` | AppStateProvider + MailboxProvider |
| `AppStateStore.ts` | AppState 类型定义 |
| `onChangeAppState.js` | 状态变更回调 |

---

## src/bootstrap/ — 进程状态 (1 file)

`state.ts` — sessionId、cwd、cost、model、interactive 标志

---

## src/types/ — 共享类型 (11 files)

| 文件 | 内容 |
|------|------|
| `command.ts` | Command 联合类型 |
| `message.ts` | Message 联合类型 |
| `permissions.ts` | PermissionMode、PermissionResult |
| `tools.ts` | ToolProgress 类型 |
| `textInputTypes.ts` | PromptInput 模式 |

---

## src/context/ — React Context (9 files)

| 文件 | 职责 |
|------|------|
| `stats.tsx` | StatsProvider |
| `fpsMetrics.tsx` | FpsMetricsProvider |
| `notifications.tsx` | 通知系统 |
| `QueuedMessageContext.tsx` | 消息队列 |
| `promptOverlayContext.tsx` | Prompt 覆盖层 |

---

## 其他目录

| 目录 | 文件数 | 说明 |
|------|--------|------|
| `constants/` | 21 | prompts、spinnerVerbs、systemPromptSections |
| `skills/` | 20 | bundled skills + loadSkillsDir |
| `plugins/` | 2 | bundled plugins 脚手架 |
| `tasks/` | 12 | LocalAgent、RemoteAgent、Teammate |
| `remote/` | 4 | RemoteSessionManager、SessionsWebSocket |
| `server/` | 3 | Direct Connect manager |
| `vim/` | 5 | Vim 模式 motions/operators |
| `voice/` | 1 | 语音模式开关 |
| `buddy/` | 6 | Companion 精灵 UI |
| `assistant/` | 1 | Kairos assistant 模式 |
| `keybindings/` | 14 | 快捷键 schema |
| `migrations/` | 11 | 配置迁移 |
| `native-ts/` | 4 | file-index、color-diff 原生加速 |
| `query/` | 4 | tokenBudget、stopHooks、deps、config |
| `memdir/` | 8 | 自动记忆目录 |
| `schemas/` | 1 | JSON schema |
| `upstreamproxy/` | 2 | 上游代理 |
| `coordinator/` | 1 | Coordinator 模式 |
| `moreright/` | 1 | MoreRight UI 扩展 |
| `outputStyles/` | 1 | 输出风格 |

---

## 根目录 Shim 文件

工程化后以下文件为向后兼容重导出，实际实现在 `app/` 或 `core/`：

```
src/main.tsx          → app/main.tsx
src/query.ts          → core/query.ts
src/tools.ts          → core/tools.ts
src/Tool.ts           → core/Tool.ts
src/commands.ts       → commands/registry.ts
src/ink.ts            → ink/facade.ts
... (共 18 个)
```
