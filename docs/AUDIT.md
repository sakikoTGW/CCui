# CCui 产品体检报告（AUDIT）

> **版本**：v0.2（全程序复盘）
> **日期**：2026-06-22
> **方法**：5 路并行只读复盘，逐文件读真实代码 + 对照 Cursor / OpenAI Codex / 腾讯 WorkBuddy，每条带 `文件:行` 证据，不靠印象。
> **用途**：这是 backlog 的真相源。每修一条勾一条；新功能合并前先过第 4 节「『做完』的定义」。

---

## 0. 一句话结论

CCui 不是「做错了」，是**很多功能「看着有、用着糙、改着怕」**，且本轮全量复盘挖出一个更致命的事：**控制面（审查落盘经人审）在 daemon 层被架空——PRD 的北极星目前是假的**（见 R2）。

病根仍是**两个力的乘积**：

```
演示驱动的验收标准  ×  双栈高摩擦的架构
   （能跑就算完）        （做透太贵）
```

本轮新增第三个、也是最重的发现：连「能跑」的核心承诺（审查门禁）本身都是装饰。

---

## 1. 根因

### R1 双栈 + 多真相源

**现状**：前端一半 vanilla JS、一半 React，缝在一起，靠 10+ 个 `window.ccui*` 桥 + `bus` + IndexedDB 通信。

- 数量：**16 个 vanilla view 壳**（`apps/desktop/app/views/*.js`）vs **14 个 React feature**（`apps/desktop/src/features/**/*.tsx`），其中 **13/16 是「壳 → 动态 import React 孤岛」**。
- `AppShell.tsx` + `registry.ts` 是一套**并行/demo 导航，未进生产**；生产协调在 `renderer.js` 的 `VIEWS` 表 + `islands.ts`（`index.html:104` 只加载 `renderer.js`）。
- 状态四个真相源：IndexedDB（会话/主题）、vanilla 模块（审查队列）、Electron `userData`（项目列表/窗口）、daemon/引擎（transcript/sessionId）。
- 会话两本账要互相 hydrate：`apps/desktop/app/session-sync.js:6-11`（`items` vs `engineMessages`）。

**为什么是根因**：做一个功能要穿 vanilla + React + bridge + bus + idb + daemon 六层，把功能**做透**的边际成本极高 → 「做到能跑就停」成了理性选择 → **空壳和难用被系统性生产出来**。

### R2 控制面在 daemon 层被架空（本轮最重磅，直接否定 PRD 北极星）

PRD 北极星：「落盘改动默认经人审」。**实际实现是反的**：

- GUI 每条会话 `sessionId` 是 `thread_*` / `lane_*`，**都不是 `main`**；`getSession` 对非 main 会话创建 `autoApprove: true`，`canUseTool` emit `permission_request` 后**立即 `return allow`，不挂 Promise** → **文件直接写盘，不等人**。证据：`services/daemon/daemon.ts:28-35`、`agentSession.ts:203-205`、`apps/desktop/app/thread.js:12,26`、`chat.js:760`。
- diff「接受/拒绝」是 `tool_use` 渲染时的**事后 UI 标记**，不控落盘；「拒绝」只是发一条「请撤销…」用户消息，**无硬回滚**。证据：`apps/desktop/app/views/chat/diff.js:19-44`、`chat.js:185-204`、`review-queue.js:79-81`。
- `respondPermission` 只路由 `mainSession`，与活跃 thread 的 pending 错位（`services/daemon/handlers.ts:202-207`）。
- 无高风险 guardrails；审查页「全部允许」对全队列无过滤（`ReviewView.tsx:76-77`）。
- Compare 的 `lane_*` 及 orchestrator 临时 session **同样 `autoApprove: true`**（`daemon.ts:31`、`orchestrator.ts:71`）。

**含义**：审查 UI 是装饰，不是门禁。这是「看着有、用着糙」的极端案例，而且砸的是**唯一核心差异化**。**修复必须从 daemon 写盘门禁开始，UI 再漂亮都是其次。**

---

## 2. 分域问题清单（每条带证据 + 标签 + 优先级）

> 标签：空壳 / 难用 / 假算法 / 卡顿 / 吞错 / 概念过载 / 不可迁移 / 缺失 / 无质量网

### A. 对话与消息体验

| # | 问题 | 证据 | 标签 | P |
|---|------|------|------|---|
| A1 | **停止丢弃 partial 不落库**：Stop 后 `finishAssistantTurn` 先 `clearStreamBubble()`，不 commit，已看见的内容被删且不写入 items | `chat.js:721-723` vs `836-887` | 难用 | P0 |
| A2 | **流式 thinking 未接**：daemon 发 `thinking_delta`，UI 只处理 `text`，reasoning 模型体验断裂 | `chat.js:830` vs `agentSession.ts:264-265` | 缺失 | P0 |
| A3 | **@/附件是假实现**：拖拽只插 `@路径` 文本，无 chip/补全/校验/图片粘贴 | `chat.js:404-424` | 假算法/缺失 | P0 |
| A4 | **长对话全量重绘**：`renderItems` 清空 + 逐条 `marked.parse`，无虚拟列表 | `chat.js:573-595` | 卡顿 | P1 |
| A5 | **代码块/消息无复制按钮** | `chat/markdown.js:19-23`（缺）| 缺失 | P1 |
| A6 | **assistant 无重新生成**；错误 retry 叠加 duplicate user | `chat.js:917-919` | 难用 | P1 |
| A7 | 工具结果 1200 字硬截 + 历史卡默认折叠，复盘时信息隐藏 | `chat/toolcards.js:56-60,23-26` | 难用 | P1 |
| A8 | 检查点自动密集且不知何时产生；分支树不能定位到具体消息；token/成本仅在 Inspector、切会话不重置 | `branches.js:96-102`、`branch-tree.js:109-116` | 概念过载 | P2 |

### B. 代码理解 / 上下文 / 扩展生态

| # | 问题 | 证据 | 标签 | P |
|---|------|------|------|---|
| B1 | **GUI 对话 MCP 未接入**：`mcpClients: []` 硬编码，bootstrap 无 MCP init → 桌面会话 MCP 工具/资源基本不可用 | `agentSession.ts:243` | 缺失 | P0 |
| B2 | **无代码语义索引**：indexer 未构建 → TS 回退封顶 350 文件/深度 5；`vectorIndex` 实为 TF-IDF 且只索引记忆文件非源码 | `resources.ts:296-317`、`src/ccui/memory/vectorIndex.ts:30-34` | 假算法/缺失 | P0 |
| B3 | **结构图大库不可用**：每 area 最多 14 文件、48 边、名截 10 字符 | `ContextMapView.tsx:39-40,95` | 空壳/卡顿 | P1 |
| B4 | **文件树**：全量重绘 + 无搜索/键盘/虚拟滚动/右键 | `filetree.js:111-137` | 卡顿/缺失 | P1 |
| B5 | **`.agents/skills` 与 `.claude/skills` 路径分裂**：扫描与加载都只看 `.claude/skills`，PRD 与仓库却用 `.agents/skills` → 都看不到 | `resources.ts:48-152` vs `docs/PRD.md:232` | 不可迁移 | P1 |
| B6 | **控制台只读**：能扫 skills/agents/rules/mcp 但无安装/创建/市场 | `ConsoleView.tsx:102-149` | 缺失 | P1 |
| B7 | 记忆召回 `vectorIndex` 命名误导；`maybeShowRecall` 吞错（召回可见本身是亮点） | `chat.js:968` | 假算法/吞错 | P1 |
| B8 | 四套「图」概念过载：project graph / memory graph / graphify / vector | — | 概念过载 | P2 |

### C. 模型 / 路由 / 设置 / 项目 / 预设 / 模板

| # | 问题 | 证据 | 标签 | P |
|---|------|------|------|---|
| C1 | **无聊天内模型选择器**：只能在设置页/预设切，发消息仅透传 `preset?.model` | `index.html:75`、`chat.js:752-759` | 缺失/难用 | P0 |
| C2 | **连接无真实验证**：状态栏=daemon ping ≠ API 连通；无 test connection，401 要发消息才暴露 | `renderer.js:429-435,463-470` | 假算法/缺失 | P0 |
| C3 | **切项目 kill+重启 daemon**（冷启 20–40s）；**会话未按 projectPath 隔离**，切完仍显旧对话；chat 不监听 `project-changed` | `main.js:270-275`、`chat.js:494-497` | 卡顿/缺失 | P0 |
| C4 | **预设/路由假参数**：`temperature` 存而不传；auto 路由从不传 `taskType`，UI「省钱」与默认走强模型矛盾 | `PresetsView.tsx:205` vs `chat.js:756-760`、`modelRouter.ts:179-180` | 假算法/空壳 | P0 |
| C5 | 单 provider；预设模型 2 个硬编码 vs 设置自由文本 vs 路由强弱，三套来源不同步 | `PresetsView.tsx:5` | 难用 | P1 |
| C6 | API key 不可清空/无重验；「编码风格记忆」与 project rules 双轨，用户不知用哪个 | `SettingsView.tsx:115-116,259-267` | 概念过载 | P1 |
| C7 | 设置 8 大块概念过载，缺 Rules / MCP 一级入口 | `SettingsView.tsx:208-385` | 概念过载/缺失 | P1 |
| C8 | （不误伤）模板 `/` 引擎、最近项目、预设 import/export 相对可用 | `templates.js:36-140` | — | — |

### D. 编排 / 并行 / 审查 / 权限 / 协作（核心见 R2）

| # | 问题 | 证据 | 标签 | P |
|---|------|------|------|---|
| D1 | **审查 diff 不可签字**：假行级（旧全红+新全绿）+ 80 行硬截 + 无语法高亮 + 无键盘流 | `ReviewView.tsx:25-37,72-77` | 假算法/难用 | P0 |
| D2 | **Compare 能跑不能决**：无并排 UI（`.pl-lanes` 无引用）/无「采用 lane」/汇总塞 Lane A/阻塞 600s 无流式 | `chat.js:292-345`、`style.css:1380` | 缺失/空壳 | P0 |
| D3 | 编排页是 redirect 空壳，nav 不暴露 | `OrchestrateView.tsx:7-20`、`nav.js:10-18` | 空壳 | P1 |
| D4 | 协作仅 `ws://127.0.0.1`，文案称「局域网」误导；仅能推整份会话 | `CollabView.tsx:38`、`collab.js:45-46` | 假算法/难用 | P1 |
| D5 | 审查双实现（`review.html/js` + `ReviewView`）功能等价重复 | `main.js:117-136`、`review.js:110-113` | 概念过载 | P2 |
| D6 | 权限「始终允许」=永久 bypass 整类工具，无 per-path 粒度 | `permissions.js:7-11`、`agentSession.ts:189-191` | 难用 | P1 |

### E. 横切面（工程质量）

| # | 问题 | 证据 | 标签 | P |
|---|------|------|------|---|
| E1 | **R1 双栈+多真相源**（根因） | 见 §1 | 概念过载 | P0 |
| E2 | **smoke 红**：`MACRO` 只注入 `VERSION`，CLI 访问 `MACRO.ISSUES_EXPLAINER` 未注入也无 Proxy 兜底（daemon 有兜底、CLI 没有） | `smoke-test.ts:43`、`src/constants/prompts.ts:218`、`daemon.ts:12-15` | 无质量网 | P0 |
| E3 | **~79 处吞错**（62 空 `catch{}` + 17 `.catch(()=>)`，35 文件）绕开已建的 diag 管道 | `chat.js`/`main.js`/`collab.js` 等 | 吞错 | P0 |
| E4 | **GUI 零测试**；`lint`/`typecheck` 不含 `apps/desktop` | `package.json:29`、`tsconfig.json:35` | 无质量网 | P0 |
| E5 | 启动三入口分裂（`start.bat`/`启动.bat`/`start-gui.bat`）；`启动.bat` 用 `for /f` 解析 `.env` 违反 bat 铁律 | `start.bat:5`、`启动.bat:10-21` | 难用 | P1 |
| E6 | 数据 `importAll` 已定义但**无 UI 调用**（只能导不能恢复）；项目列表/窗口 chrome 在 `userData` 不进备份 | `db.js:80-88`、`main.js:399-400` | 不可迁移 | P1 |
| E7 | 命令面板 `includes` 子串搜索，没用已依赖的 `fuse.js`；快捷键无 cheat sheet/可改键 | `command-palette.js:90-96` | 难用 | P1 |
| E8 | 主题三入口分裂（标题栏/命令面板/设置），内置主题仅 2 套 | `ui.js:64-77` | 概念过载 | P2 |
| E9 | 全中文硬编码（70+ 文件），UI 中文 + 引擎英文 prompt → 海外开发者双门槛 | `index.html:2` | 缺失 | P2/P3 |

---

## 3. P0 开刀清单（跨域汇总，按杠杆排序）

| 顺序 | 目标 | 关键改动 | 对应 |
|------|------|----------|------|
| 1 | **审查真门禁（兑现北极星）** | 落盘类工具默认拦截（不再 `autoApprove` 绕过）；diff 在写盘前审；`respondPermission` 路由到正确 thread；高风险项标红禁批量 | R2、D1 |
| 2 | **真·行级 diff + 去截断 + 全键盘** | LCS 行对齐 + 语法高亮 + 可展开/虚拟化 + j/k/a/r/x | D1、A |
| 3 | **输入区 @ 补全 / chip / 图片** | `@` 触发文件模糊搜索（复用索引）→ 可视 chip → 粘贴图片 | A3 |
| 4 | **可观测立网** | 修 `MACRO`（smoke 全绿设门槛）+ 吞错改 `reportDiag` + `apps/desktop` 纳入 lint/typecheck | E2/E3/E4 |
| 5 | **GUI 接入 MCP** | bootstrap 初始化 MCP 连接，桌面会话挂 `mcpClients` | B1 |
| 6 | **模型选择器 + 连接测试** | 聊天栏 model picker；设置页 test connection；状态区分 daemon/API | C1/C2 |
| 7 | **会话按项目隔离 + 切项目不重启** | 会话加 `projectPath`；切换走 hydrate/切 thread 而非 kill daemon | C3 |

> 原则：**深度优先于广度**。14 个半成品入口，不如 4 个真做透的。先修 1（门禁），否则一切「审查/编排」叙事都站不住。

---

## 4. 「做完」的定义（合并新功能前必须全过）

1. **用户旅程**：一句话说清「谁 / 什么情境 / 完成什么 / 完成的标志」。说不出 → 砍。
2. **真实规模可用**：几千文件、几百行 diff、上千条会话下不卡、不截断（分页/虚拟化/可展开，禁止 `slice` 一刀切）。
3. **纯键盘**：高频功能不碰鼠标能走完。
4. **重复 100 次不烦**：记最近、不丢状态、不每次手动刷新。
5. **真算法**：diff 真行级、搜索真模糊、参数真下发，禁止糊弄算法/假参数冒充。
6. **错误可见**：失败有可读提示 + 可重试，禁止裸 `catch{}` 吞掉。
7. **四态齐全**：空 / 加载 / 错误 / 无权限。
8. **落盘必经门禁**（新增）：任何会写磁盘/跑命令/扩权限的能力，默认走审查，**禁止 `autoApprove` 等旁路绕过**；降级须显式配置且可审计。

---

## 5. 优先级总览（便于排期）

| 域 | P0 | P1 | P2/P3 |
|----|----|----|-------|
| A 对话 | A1 A2 A3 | A4 A5 A6 A7 | A8 |
| B 上下文/扩展 | B1 B2 | B3 B4 B5 B6 B7 | B8 |
| C 模型/设置/项目 | C1 C2 C3 C4 | C5 C6 C7 | — |
| D 编排/审查/协作 | R2 D1 D2 | D3 D4 D6 | D5 |
| E 横切 | E1 E2 E3 E4 | E5 E6 E7 | E8 E9 |

**P0 合计 14 项**，其中 R2（审查门禁被架空）是所有问题里唯一直接否定 PRD 北极星的，必须最先修。
