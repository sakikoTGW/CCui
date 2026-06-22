# CCui 产品需求文档（PRD）

> **版本**：v0.2（开放接口支柱）  
> **日期**：2026-06-20  
> **状态**：草案，待评审  
> **配套**：`PRODUCT_DESIGN.md`、`GUI_PLAN.md`、`CCUI_STACK.md`

---

## 1. 文档目的

将产品战略、用户价值、功能边界与里程碑收敛为**可执行需求**，供研发排期、对外叙事与验收使用。本文档吸收竞品对照、全栈交付、可维护性、可自定义、可迁移性、好用/顺手、「控制面 vs IDE」战略定论，以及 **「足够开放——方便开发者自定义、开发、接入自己的内容」** 的平台主张。

---

## 2. 背景与问题

### 2.1 市场信号（2026）

| 信号 | 含义 |
|------|------|
| 84% 开发者使用 AI 编码，仅 ~29% 信任产出 | 痛点从「生成」转向「验证、溯源、问责」 |
| Agentic coding 成为主线 | 多步委托、多 agent 协调成为常态 |
| MCP + Skills + Hooks 成为事实标准 | 不应发明私有扩展格式 |
| Human-in-the-loop 非妥协 | 高风险变更需权限、溯源、不确定性信号 |

### 2.2 竞品格局（我们打哪场仗）

| 产品 | 主战场 | 我们不与之正面比拼 |
|------|--------|-------------------|
| **Cursor** | IDE 内共写、补全、流畅 apply | 日常碎活、Tab 补全、编辑器一体感 |
| **Codex** | 云托管 agent、PR 闭环 | 零运维云沙箱、企业全家桶 |
| **WorkBuddy** | 办公自动化、低门槛 | 非代码向任务、企微生态 |
| **Claude Code CLI** | 终端 agent 深度 | 极客纯键盘、无 GUI 场景 |

### 2.3 核心论断（战略定论）

1. **用户不会为「1% 功能亮点」牺牲「99% 日常体验」去换一个全功能 App。**
2. **CCui 不是「更好的 Cursor」，而是「Agent 时代默认怀疑论的生产控制面」。**
3. **分工模型**：日常编码在 Cursor/外部 IDE；**大活、险活、不可逆决策**在 CCui。
4. **价值单位**：不是「每天打开次数」，而是**高杠杆委托时刻**（多文件重构、架构选型、权限/数据/schema 变更）。
5. **启动耗时等体验债重要，但不是「Why us」**；存在理由是**签字落地、并行决策、透明召回、本地可组合**。
6. **开放是战略，不是附属**：Cursor 闭源垂直整合；我们要做 **可组装、可嵌入、可替换 UI 的 Agent 内核 + 控制面**，接口要多、文档要清、默认要能用。

---

## 3. 产品愿景与定位

### 3.1 一句话

**开源、可组装的本地 Agent 控制面——让人敢委托大活，让开发者能接自己的内容与壳。**

### 3.2 双支柱

| 支柱 | 一句话 | 北极星 |
|------|--------|--------|
| **控制面** | 派得出去、收得回来、选得明白 | 落盘改动默认经人审 |
| **开放平台** | 接得进来、改得动、换得了皮 | **每类扩展都有稳定公开接口** |

### 3.3 电梯词（对外）

> **用户**：Cursor 让你写得快；CCui 让你派得出去、收得回来。  
> **开发者**：CCui 是你能 fork、能嵌、能接 MCP/插件/自建 UI 的 **Agent 操作系统**——不是黑盒 App。

### 3.4 品类定义

| 维度 | 定义 |
|------|------|
| **是什么** | 开源、本地优先的 **Agent 控制面 + 开发者平台**（内核、协议、插槽、文档） |
| **不是什么** | 完整 IDE、云托管后端、自研模型、封闭聊天产品、办公自动化工具 |
| **控制面北极星** | 落盘改动默认经人审（可配置降级） |
| **平台北极星** | 第三方可在**不 fork 引擎**前提下接入 UI、命令、Hook、工具与数据 |

### 3.5 目标用户（楔形优先）

| persona | 描述 | 核心诉求 |
|---------|------|----------|
| **机长型开发者** | 仓库 owner / 架构负责人，对 git 负责 | 敢委派大改、要逐条审 diff |
| **不信任默认 apply 者** | 经历过 AI 改坏生产/删文件 | 刹车、溯源、权限 |
| **决策型工程** | 重构、协议设计、技术选型 | Compare 多 lane + 交叉评审 |
| **平台构建者** ⭐ | 团队平台、独立开发者、想嵌 agent | **开放 API、插槽、headless、插件市场** |
| **内容接入者** ⭐ | 有自研工具链/UI/知识库 | **接入 MCP、自定义面板、事件总线、contrib** |
| **合规/内网** | 代码与 Key 不能默认上云 | 本地 daemon、自持 API、可审计 |

**非目标用户（v1 不讨好）**：只要 Tab 补全的日常编码者；零配置云 agent 用户；不愿读 5 页集成文档、只要「装完即用」的非技术用户。

### 3.6 对「开放」的承诺（产品级）

1. **接口优先于界面**：新能力先上 `protocol` / `bus` / Hook，再做内置 UI。  
2. **默认开放读、显式授权写**：读项目/资源/事件容易；改盘、跑命令、扩权限须声明。  
3. **标准格式优先**：MCP、SKILL.md、AGENTS.md、`.cursor/rules` 一等公民；私有格式仅作胶水。  
4. **可替换**：Electron 壳可换；`ccui serve` 后 UI 可完全自建。  
5. **文档与示例即功能**：每个公开接口须有类型定义 + 最小可跑示例 + 契约测试。

---

## 4. 产品原则

### 4.1 设计原则（沿用 PRODUCT_DESIGN）

1. 一屏一主操作；高频路径 ≤ 2 步  
2. 渐进披露；默认路径短  
3. 每个视图具备：空 / 加载 / 错误 / 无权限 四态  
4. 键盘优先（审查闭环须可键盘完成）

### 4.2 工程原则

1. **协议单一真相**：`packages/protocol`（zod），漏 handler 编译失败  
2. **引擎防腐**：daemon 只经 `@ccui/engine-api` / `@ccui/engine-memory`  
3. **不发明私有格式**：兼容 MCP、SKILL.md、AGENTS.md、`.cursor/rules`  
4. **Strangler 迁移 UI**，但设收敛目标，禁止无限双栈扩张  
5. **项目知识进 git，个人/UI 状态可导出**

### 4.3 战略禁令（明确不做）

- ❌ 与 Cursor 比拼 Tab 补全 / 完整 IDE  
- ❌ 用「第二个聊天 App」叙事抢日常默认打开位  
- ❌ 为功能广度牺牲「审查默认开启」  
- ❌ 无审查批量接受高风险改动（删文件、env、schema、migration）  
- ❌ 发明与 MCP/Skills 并行的私有扩展生态  
- ❌ **把扩展能力藏在 GUI 里、却不暴露 protocol/bus/Hook**（开放能力禁止「仅内部可用」）

### 4.4 开放平台原则

1. **分层开放**（见 §5.2）：内容层 → 引擎层 → 控制面层 → UI 层，每层有独立接入点。  
2. **能力即权限**：插件/contribution 显式声明 `permissions`；宿主白名单可审计、可收紧。  
3. **稳定边界**：`@ccui/protocol`、`@ccui/plugin-sdk`、`bus` 事件名、`engine-api` 为 semver 守护的公共 API。  
4. **贡献者友好**：`ccui dev:plugin`、`ccui dev:daemon`、热重载、模板仓库、契约测试与官方示例同级维护。  
5. **不锁死实现**：用户可只跑 daemon + 自研前端；可只嵌一个 iframe 面板；可只接 MCP。

---

## 5. 开发者平台与开放接口（第二支柱）

> **懂你的意思**：我们要的是 **「开发者拿自己的内容、自己的 UI、自己的工具链，能接进来、能跑起来、能长期维护」**——接口要多、要稳、要文档化，不是口号。

### 5.1 定位：CCui 作为 Agent OS

```
┌─────────────────────────────────────────────────────────────┐
│  你的 UI：Electron 壳 / Web / VSCode 扩展 / CI / 自研看板    │
├─────────────────────────────────────────────────────────────┤
│  UI 扩展：插槽 · React registerFeature · 插件 iframe · 主题  │
├─────────────────────────────────────────────────────────────┤
│  控制面 API：bus 事件 · ipc/preload · plugin postMessage    │
├─────────────────────────────────────────────────────────────┤
│  Daemon 协议：packages/protocol NDJSON（send/orchestrate/…） │
├─────────────────────────────────────────────────────────────┤
│  引擎扩展：MCP · Skills · Hooks · Agent 定义 · contrib 命令   │
├─────────────────────────────────────────────────────────────┤
│  内容与知识：.cursor/rules · CLAUDE.md · .ccui/* · Brief     │
└─────────────────────────────────────────────────────────────┘
```

**与 Cursor 的本质差别**：Cursor 让你用它的产品；CCui 让你 **做自己的产品**，我们提供 **签字、编排、审查、协议** 这层内核。

### 5.2 开放分层与接入方式

| 层级 | 开发者要什么 | 公开接口（现有 / 规划） | 典型接入物 |
|------|--------------|-------------------------|------------|
| **L0 内容** | 接自己的规则、技能、记忆 | `.cursor/rules`、`SKILL.md`、`AGENTS.md`、`.ccui/project.yaml`、`.ccui/briefs/` | 团队规范、领域知识 |
| **L1 工具** | 接自己的 API/DB/内部系统 | **MCP**（引擎原生）、未来 contrib MCP 向导 | 工单、DB、监控 |
| **L2 引擎行为** | 在 agent 生命周期挂钩子 | Claude Code **Hooks**（`loadPluginHooks`）、计划 **Hook 注册 API** | lint、审计、自动 verify |
| **L3 Daemon** | 远程驱动 agent、自建 UI | `packages/protocol` 全部 `CommandKind`；**`ccui serve`** + 流式事件 | 自研控制台、CI agent |
| **L4 渲染器** | 改界面、加面板 | 类型化 **`bus`**、`registerFeature`、**UI 插槽**、主题/CSS 变量 | 自定义审查 UI、Live2D |
| **L5 插件包** | 第三方一键安装的能力包 | `ccui.plugin.json` + `@ccui/plugin-sdk`（guest/host） | 垂直场景面板 |
| **L6 记忆/结构** | 接自己的知识图谱/RAG | `@ccui/engine-memory`（recall、graphify、ingest） | 内部 wiki、图谱 |

### 5.3 公开接口清单（需求级）

#### A. Daemon 协议（`packages/protocol`）— **已存在，需文档化 + 稳定 semver**

| 命令 | 用途 | 开放策略 |
|------|------|----------|
| `send` / `interrupt` / `reset` / `hydrate` | 会话生命周期 | 稳定；第三方客户端一等公民 |
| `respondPermission` | 权限回路 | 稳定 |
| `orchestrate` | 多 lane 编排 | 稳定 |
| `listResources` / `setDisabledResources` / `toggleMcp` | 能力开关 | 稳定 |
| `getRecall` | 记忆召回快照 | 稳定 |
| `projectGraph` / `getProjectInfo` / `readFile` / `listDir` | 项目感知 | 稳定；插件白名单已含只读子集 |
| `setRouter` / `setAllowedTools` / `setEnv` | 运行参数 | 稳定；`setEnv` 键受限 |

**需求**：`docs/DAEMON_API.md` + TS/Python 官方客户端 + 每命令契约测试（F-OPEN-01）。

#### B. 事件流（daemon → client）— **需规范化文档**

`agentSession` 推送：`delta`、`message`、`tool_use`、`permission_request`、`route`、`usage`、`done`、`error`、`orch_event`…

**需求**：事件 schema zod 化导出（F-OPEN-02）；WebSocket/SSE 可选传输（F-OPEN-03）。

#### C. 渲染器总线（`apps/desktop/src/shell/bus.ts`）— **已存在，需扩展 + 文档**

现有：`switch-view`、`review-queue`、`insert-prompt`、`apply-brief`、`review-diff`…

**需求**：

- 发布 **`BusEvents` 稳定列表**与版本策略（F-OPEN-04）  
- 插件 `SAFE_BUS_*` **可配置扩展**（项目 yaml 声明额外事件，默认仍白名单）（F-OPEN-05）  
- 新增 **`agent:*` 生命周期事件**（task-start、tool-end、review-enqueue、done）供插件订阅（F-OPEN-06）

#### D. 插件 SDK（`packages/plugin-sdk`）— **已存在，需加厚**

现有：`toast`、`bus:emit/on`、`store:read`、`daemon:request`（只读命令白名单）、沙箱 iframe。

**需求**：

| ID | 需求 |
|----|------|
| F-OPEN-07 | **UI 插槽** `manifest.ui.slots[]`：chat.toolbar、composer.footer、review.sidebar、done-card.actions、nav.item |
| F-OPEN-08 | **权限等级扩展**：`daemon:send`、`review:respond`、`fs:read`、`theme:register` 等分级 |
| F-OPEN-09 | **`ccui plugin create` / `ccui plugin dev`** 脚手架与 HMR |
| F-OPEN-10 | **插件可声明 MCP server** 一并拉起（一个包 = 面板 + 工具） |
| F-OPEN-11 | 官方 **`plugins/` 示例矩阵**：只读仪表盘、审查增强、deploy 按钮、Live2D |

#### E. UI 功能注册（`shell/registry.ts`）— **已有 API，需产品化**

**需求**：

| ID | 需求 |
|----|------|
| F-OPEN-12 | `nav.js` 改为读 **registry + 插件 manifest**，不再硬编码 |
| F-OPEN-13 | **`registerFeature` 文档** + 社区 Feature 模板（React 孤岛） |
| F-OPEN-14 | 主题：**CSS 变量契约**文档 + `theme pack` 导入（延续 ThemeEditor） |

#### F. 引擎贡献点（`src/` 生态）— **复用标准，不重复造**

| 接入 | 方式 |
|------|------|
| 斜杠命令 | `src/commands/` + registry |
| 自定义 Tool | `src/tools/` 或 MCP |
| Subagent | `.claude/agents/*.md` |
| Skills | `.agents/skills/**/SKILL.md` |
| Claude 插件市场 | `src/utils/plugins/*`（与 CCui 插件分栏文档） |

**需求**：

| ID | 需求 |
|----|------|
| F-OPEN-15 | **Contrib 指南**：「加一个 Tool / 一条命令 / 一个 Agent」最小步骤 |
| F-OPEN-16 | **`.ccui/contrib.yaml`** 声明本仓库贡献的 agents、hooks、verify、插件路径 |
| F-OPEN-17 | Console **「本仓库贡献」** Tab：扫描 contrib 与加载状态 |

#### G. Headless 与嵌入

| ID | 需求 |
|----|------|
| F-OPEN-18 | **`ccui serve`**：stdio/TCP 暴露 protocol；`--auth token` |
| F-OPEN-19 | **嵌入模式**：`CCUI_DAEMON_URL` 连接已有 daemon，Electron 只做壳 |
| F-OPEN-20 | **VSCode/Cursor 扩展**（可选）：审查队列、派活面板，连同一 daemon |

#### H. 数据与配置开放

| ID | 需求 |
|----|------|
| F-OPEN-21 | **`.ccui/project.yaml` schema** 公开 + JSON Schema 发布 |
| F-OPEN-22 | **`ccui-bundle`** 含 presets/templates/plugins 清单 |
| F-OPEN-23 | **记忆 API**：`engine-memory` 导出/导入文档化（团队可选进 git） |

### 5.4 开发者体验（DX）需求

| ID | 需求 | 说明 |
|----|------|------|
| F-OPEN-24 | **`docs/DEVELOPER.md` 索引** | 所有公开接口单页入口 |
| F-OPEN-25 | **OpenAPI/JSON Schema 产物** | 从 zod 自动生成，CI 校验破坏性变更 |
| F-OPEN-26 | **`bun run test:unit` 含插件契约** | 已有；扩展 bus/protocol 快照 |
| F-OPEN-27 | **示例仓库 `ccui-starter-plugin`** | 5 分钟跑通插件 |
| F-OPEN-28 | **示例 `ccui-starter-client`** | 5 分钟连 daemon 发 `send` |
| F-OPEN-29 | **Changelog + semver 政策** | protocol/plugin-sdk 破坏性变更必须 major |

### 5.5 开发者用户场景

#### 场景 F：接入公司内部 MCP

**作为** 平台工程师，**我希望** 在 `.ccui/project.yaml` 声明 MCP 并在 Console 一键启用，**以便** agent 能查工单/监控而不改 CCui 源码。

**验收**：yaml 声明 + `toggleMcp`；文档有 MCP 接入指南。

#### 场景 G：自研审查 UI

**作为** 前端开发者，**我希望** 订阅 `review-queue` 与 `agent:done` 事件，在自研 Web 面板批审，**以便** 公司统一审计界面。

**验收**：`ccui serve` + 事件 schema + 示例客户端。

#### 场景 H：垂直插件（如 Unity / Live2D）

**作为** 独立开发者，**我希望** 用 `ccui.plugin.json` 注册侧栏 + `chat.toolbar` 插槽，**以便** 卖专用 agent 工作台而不 fork 引擎。

**验收**：插槽 API + `ccui plugin dev` + 上架说明（市场可 Phase 3）。

#### 场景 I：仓库自带团队规范

**作为** Tech Lead，**我希望** 在仓库提交 `.ccui/contrib.yaml` + `AGENTS.md`，clone 即加载，**以便** 新人不用手抄配置。

**验收**：contrib 扫描 + Console 展示。

### 5.6 开放 vs 安全（不矛盾）

| 开放 | 安全 |
|------|------|
| 任意客户端连 daemon | token / 本地环回限制 |
| 插件读项目 | 默认只读命令白名单 |
| 插件发 bus 事件 | `SAFE_BUS_EMIT` + 项目级扩展需声明 |
| 插件审 diff | 须 `review:respond` 权限 + 用户确认 |
| 开放 `send` 给插件 | 默认拒绝；企业版可开 |

**原则**：**开放读、授权写、审计留痕**。

### 5.7 与竞品：为什么开发者选 CCui 而不是 Cursor

| | Cursor | CCui |
|--|--------|------|
| Fork 改 UI | 不可 | MIT 壳 + bus + registry |
| 自建控制台 | 无官方协议 | **protocol + serve** |
| 插件接 agent 生命周期 | 受限 | Hooks + bus + 插槽 |
| 团队 UI 统一 | 用他们的 | **嵌你的面板** |
| MCP/Skills | 有 | 有，且 **contrib.yaml 进仓库** |

---

## 6. 用户场景与故事（控制面）

### 6.1 场景 A：大改且敢落地（核心）

**作为** 仓库负责人，**当** 我让 agent 改 10+ 文件实现功能，**我希望** 每处改动以 diff 卡片呈现并进入审查队列，**以便** 我逐条或批量签批后再落盘，而不是 silent apply。

**验收**：Edit 工具产出默认进审查；拒绝可触发撤销；高风险项禁止「全部接受」。

### 6.2 场景 B：架构选型（差异化）

**作为** 技术负责人，**当** 面临重构方案不确定，**我希望** 同一 prompt 在 Lane A/B/C 并行执行并交叉评审后汇总，**以便** 我「采用某 lane 继续深挖」而非手动开三个 chat。

**验收**：Compare 一键入口；orchestrate 返回 synthesize；UI 支持「采用 lane X 继续」。

### 6.3 场景 C：长期项目复利（记忆）

**作为** 维护 monorepo 的开发者，**我希望** 看见本轮回答引用了哪些记忆并可标记「不对」，**以便** 纠正后同类错误不再出现，并可选写回 rules/AGENTS.md。

**验收**：`getRecall` 卡片；记忆纠错；一键导出到项目 rules。

### 6.4 场景 D：分工工作流（Cursor + CCui）

**作为** 日常用 Cursor 的开发者，**当** 遇到多文件/agent 长任务，**我希望** 在 CCui 派活与审查，在 Cursor 手写细活，**以便** 各取所长且 diff 可深链打开外部编辑器。

**验收**：diff 卡「在外部编辑器打开」；项目 rules 在两边一致（`.cursor/rules` 已加载）。

### 6.5 场景 E：换机/换工具（可迁移）

**作为** 用户，**我希望** 项目行为（verify、router、disabled resources）在 `.ccui/project.yaml` 中，会话/预设可用 bundle 导入导出，**以便** 换电脑或协作时不丢「项目级约定」。

**验收**：yaml 进 git；`ccui-bundle` v1 导入导出对称。

*开发者场景 F–I 见 §5.5。*

---

## 7. 功能需求

> **开放接口需求**：F-OPEN-01～29 见 **§5.3～5.4**；与下表 P0/P1 并行，不得因「先做控制面」而长期不文档化已有 protocol。

### 7.1 P0 — 控制面核心（北极星）

| ID | 需求 | 说明 | 依赖 |
|----|------|------|------|
| F-P0-01 | **默认审查落盘** | Edit/Write 类改动先进审查队列，配置后才可 auto-apply 低风险 | `chat/diff.js`, ReviewView, daemon |
| F-P0-02 | **高风险 guardrails** | 删除、env、schema、migration 等单独标红，禁用批量接受 | 工具元数据 + 审查 UI |
| F-P0-03 | **审查键盘流** | 审查视图：A 接受 / R 拒绝 / ] 下一条；与 `Ctrl+Shift+R` 一致 | ReviewView |
| F-P0-04 | **权限卡片** | 流内 permission 卡 + 审查队列统一；拒绝/仅此次/始终允许 | daemon `canUseTool` |
| F-P0-05 | **Done 卡** | 每轮 `done` 展示：改动文件列表、建议 verify 命令、进审查/Git 入口 | agentSession 事件 |
| F-P0-06 | **Verify Profile** | `.ccui/project.yaml` 或项目配置定义 `onDone` 命令；一键跑并喂回 agent | daemon + yaml |

### 7.2 P0 — 编排与决策

| ID | 需求 | 说明 |
|----|------|------|
| F-P0-07 | **Compare 外露入口** | 输入区旁固定「三路 Compare」，非隐藏模式 |
| F-P0-08 | **采用 Lane 继续** | orchestrate 完成后可选 lane，上下文迁入主 Thread |
| F-P0-09 | **交叉评审结果 UI** | crossReview + synthesize 结果结构化展示，非纯文本墙 |

*引擎能力已存在于 `services/daemon/orchestrator.ts`，需求重点是产品默认路径。*

### 7.3 P0 — 项目配置与可迁移（亦为开放 L0）

| ID | 需求 | 说明 |
|----|------|------|
| F-P0-10 | **`.ccui/project.yaml`** | verify、router、disabledResources、dev.health 等；daemon 启动 merge |
| F-P0-11 | **`ccui-bundle` v1** | 导出/导入：conversations、presets、templates、settings；带 schema 版本 |
| F-P0-12 | **Rules 可见** | Console 展示已加载 rules 来源（含 `.cursor/rules`）；支持导出到 AGENTS.md |

*`.cursor/rules` 加载已实现于 `src/ccui/memory/cursorRules.ts`，需 GUI 可见性。*

### 7.4 P0 — Git 与交付闭环

| ID | 需求 | 说明 |
|----|------|------|
| F-P0-13 | **审查 ↔ git status** | 审查项展示 staged/unstaged；采纳后提示 commit |
| F-P0-14 | **Commit 草稿** | 从本轮 transcript 生成 commit message 草稿 |
| F-P0-15 | **审查审计日志** | 可选 `.ccui/audit/review.jsonl` |

### 7.5 P0 — 开放底座（与控制面同期，不可无限延后）

| ID | 需求 | 说明 |
|----|------|------|
| F-P0-16 | **DAEMON_API 文档** | 同 F-OPEN-01；所有 CommandKind + 事件 |
| F-P0-17 | **DEVELOPER.md 索引** | 同 F-OPEN-24；接口地图单页 |
| F-P0-18 | **project.yaml JSON Schema** | 同 F-OPEN-21；仓库即配置 |
| F-P0-19 | **contrib.yaml 扫描** | 同 F-OPEN-16/17；clone 即加载团队扩展 |
| F-P0-20 | **bus 事件文档** | 同 F-OPEN-04；`BusEvents` 为公开 API |

### 7.6 P1 — 透明与成本

| ID | 需求 | 说明 |
|----|------|------|
| F-P1-01 | **记忆召回卡** | 延续 `getRecall`；支持「不对」「写入 rules」 |
| F-P1-02 | **ModelRouter 可视** | 侧栏/驾驶舱：本步 strong/weak、原因；`router.json` 导入导出 |
| F-P1-03 | **上下文条** | system/rules/skills/files/history 占比；超阈值提示 |
| F-P1-04 | **成本预算** | 日/周预算与 Compare 前预估 |

### 7.7 P1 — 好用与顺手（非启动优先）

| ID | 需求 | 说明 |
|----|------|------|
| F-P1-05 | **命令面板收敛** | 主路径 ≤3 导航；其余 Ctrl+K |
| F-P1-06 | **快捷键页** | `?` 或面板内固定「快捷键」 |
| F-P1-07 | **外部编辑器深链** | diff 卡打开 VSCode/Cursor |
| F-P1-08 | **Intent/Brief 文件化** | Brief 可存 `.ccui/briefs/*.json` 随仓库 |
| F-P1-09 | **首启向导** | API、项目类型、默认 verify、示例 Brief |

### 7.8 P1 — 可维护与 UI 收敛

| ID | 需求 | 说明 |
|----|------|------|
| F-P1-10 | **审查状态统一** | 审查队列迁 zustand，移除 `window.ccuiReview` 分裂 |
| F-P1-11 | **Command 契约测试** | 每个 `CommandKind` golden 测 |
| F-P1-12 | **诊断包导出** | logs + gui-status + router + recall 一键 zip |

### 7.9 P1 — 开放加厚（插槽与开发体验）

| ID | 需求 | 映射 |
|----|------|------|
| F-P1-13 | UI 插槽 v1 | F-OPEN-07 |
| F-P1-14 | `ccui plugin create/dev` | F-OPEN-09 |
| F-P1-15 | nav 数据驱动 + 插件注册 | F-OPEN-12 |
| F-P1-16 | starter-plugin + starter-client 仓库 | F-OPEN-27/28 |
| F-P1-17 | zod → JSON Schema CI | F-OPEN-25 |

### 7.10 P2 — 平台与扩展（合并 F-OPEN 余下项）

| ID | 需求 | 说明 |
|----|------|------|
| F-P2-01 | **插件插槽** | chat.toolbar、done-card.footer 等 |
| F-P2-02 | **Hooks 控制台** | 引擎生命周期绑定 script/插件 |
| F-P2-03 | **插件叙事统一** | Claude marketplace vs `ccui.plugin.json` 文档与 Console 分栏 |
| F-P2-04 | **`ccui serve`** | headless daemon 文档 + 官方客户端示例 |
| F-P2-05 | **记忆包导入导出** | `.ccui/memory/` 或引擎 API |
| F-P2-06 | **编排看板** | 多 lane 状态、暂停、接管（非 redirect 页） |
| F-P2-07 | **语义搜索** | M4；增强 @ 提及 |
| F-P2-08 | **沙箱档位** | `@anthropic-ai/sandbox-runtime` 产品化 |
| F-P2-09 | **Plan → Act** | 可编辑计划后再执行 |
| F-P2-12 | **`agent:*` bus 事件** | F-OPEN-06 |
| F-P2-13 | **插件 MCP 捆绑** | F-OPEN-10 |
| F-P2-14 | **Hook 注册 API** | F-OPEN-02 + F-P2-02 |
| F-P2-15 | **VSCode/Cursor 扩展（可选）** | F-OPEN-20 |

### 7.11 P2 — 体验债（排期靠后）

| ID | 需求 | 说明 |
|----|------|------|
| F-P2-10 | **Daemon 托盘常驻** | 二次开窗口 <3s；非 Why us 核心 |
| F-P2-11 | **后台 Compare + 通知** | 长任务完成桌面通知 |

---

## 8. 非功能需求

### 8.1 架构

| ID | 需求 |
|----|------|
| NF-01 | 四进程模型保持：Renderer ↔ Main ↔ Daemon ↔ Engine；索引器子进程隔离 |
| NF-02 | daemon 零深引 `src/`，仅 `engine-api` / `engine-memory` |
| NF-03 | 新增 daemon 命令只改 `packages/protocol/commands.ts` 一处 |
| NF-04 | React 孤岛须 `ErrorBoundary`；optional feature 崩溃不掀主壳 |

### 8.2 安全

| ID | 需求 |
|----|------|
| NF-05 | 插件 sandbox iframe + 权限白名单 RPC |
| NF-06 | `setEnv` 仅允许约定 key 集合 |
| NF-07 | 高风险 Bash 默认需权限卡；可选沙箱执行 |

### 8.3 质量与验收

| ID | 需求 |
|----|------|
| NF-08 | `bun run human` 全绿作为 GUI 发布门槛 |
| NF-09 | `bun run test:unit` 覆盖 protocol + plugin-sdk；逐步加 daemon 集成测 |
| NF-10 | 交付前双击启动脚本须 agent 自验（见 workspace rules） |

### 8.4 可迁移与开放

| ID | 需求 |
|----|------|
| NF-11 | 项目行为配置可仅依赖 git 内文件复现 |
| NF-12 | 不锁定单一模型厂商；`.env` 切换 API |
| NF-13 | 外壳 MIT；`src/` vendored 边界在 LICENSE 说明 |
| NF-14 | **公开 API semver**：`protocol`、`plugin-sdk`、`BusEvents` 破坏性变更走 major |
| NF-15 | **开放接口必有契约测试**；文档与代码同步 CI |

---

## 9. 信息架构（收敛后）

### 9.1 主路径（用户 80% 时间）

```
工作区（Chat）— 输入 / 流式 / diff 卡 / 钉目标（Intent）
     ↓
变更审查（Review）— Ctrl+Shift+R 批处理
     ↓
Done 卡 — Verify / Git / 继续
```

### 9.2 次级入口（Ctrl+K）

控制台、Compare、Brief 库、Studio、结构图、设置、预设、插件

### 9.3 活动栏建议（收敛）

| 保留为主 | 降级为命令面板 |
|----------|----------------|
| 项目、工作区、审查 | 编排、数据工作室、简报库、扩展、主题… |

*具体砍并需 UX 评审；原则是减认知，不是减能力。*

---

## 10. 成功指标

### 10.1 北极星指标（双轨）

| 轨道 | 指标 |
|------|------|
| **控制面** | 高价值委托会话中，审查闭环完成比例 |
| **开放平台** | 每月 **第三方接入** 数：活跃插件 / 外部 daemon 客户端 / 含 `contrib.yaml` 的仓库 |

### 10.2 分层指标

| 类型 | 指标 | 目标方向 |
|------|------|----------|
| 信任 | 高风险改动被拦截后用户确认率 | 可观测即可，非越高越好 |
| 决策 | Compare 会话中「采用 lane 继续」占比 | ↑ |
| 交付 | Done 卡后执行 verify 的比例 | ↑ |
| 复利 | 记忆纠错 / 写回 rules 次数 | ↑ |
| 迁移 | project.yaml 采用项目数；bundle 导入成功率 | ↑ |
| 开放 | 文档 PR 外开发者成功 `send` 一次的最短时间；插件上架数 | ↓ / ↑ |

### 10.3 不用于自我欺骗的指标

- ❌ 仅 DAU / 打开次数（与分工战略冲突）  
- ❌ 与 Cursor 比启动秒数作为核心 KPI

---

## 11. 里程碑

### Phase 1 — 控制面 + 开放底座（MVP 重定义）

**主题**：敢默认审；敢 Compare；**接口文档与 yaml/contrib 同步上线**

| 交付 | 需求 ID |
|------|---------|
| 默认审查 + 高风险 guardrails | F-P0-01~06, F-P0-13~15 |
| Compare 外露 + 采用继续 | F-P0-07~09 |
| project.yaml + bundle | F-P0-10~11 |
| Rules 可见 | F-P0-12 |
| **DAEMON_API + DEVELOPER.md + bus 文档** | F-P0-16~17, F-P0-20 |
| **contrib.yaml 扫描** | F-P0-19 |

**验收**：多文件重构全流程 + **外部脚本连 daemon 发 `send` 成功**（starter-client）；`bun run human` 通过。

### Phase 2 — 透明、顺手、可开发

| 交付 | 需求 ID |
|------|---------|
| 记忆纠错、Router 可视、上下文条 | F-P1-01~03 |
| 审查统一、编辑器深链、快捷键 | F-P1-05~07, F-P1-10 |
| Brief 文件化、首启向导 | F-P1-08~09 |
| 插槽 v1、plugin dev、starter 仓库 | F-P1-13~17 |

### Phase 3 — 平台化（开放接口全面加厚）

| 交付 | 需求 ID |
|------|---------|
| 插槽、Hooks、headless、编排看板 | F-P2-01~06, F-P2-12~15 |
| 语义、沙箱、Plan/Act | F-P2-07~09 |

### Phase 4 — 体验债

| 交付 | 需求 ID |
|------|---------|
| 托盘常驻、后台通知 | F-P2-10~11 |

---

## 12. 竞品对照（需求层 Why us）

| 能力 | Cursor | Codex | CCui |
|------|--------|-------|------|
| 默认逐条审 diff 再落盘 | 弱 | PR 级 | F-P0-01~05 |
| 并行 lane + 交叉评审 | 弱 | 部分 | F-P0-07~09 |
| **开放协议 / 自建 UI / 插件** | 否 | 部分 API | **§5 全章、F-OPEN、NF-14** |
| 仓库级 contrib / yaml 扩展 | 弱 | 弱 | F-P0-19、F-OPEN-16 |
| 记忆注入可见可纠错 | 弱 | 弱 | F-P1-01 |
| 日常 IDE 体验 | 强 | N/A | **不重做** |

---

## 13. 风险与对策

| 风险 | 对策 |
|------|------|
| 全功能 App 叙事导致 99% 体验惨败 | 收敛 IA；对外分工叙事；砍并行花架子 |
| UI 双栈维护爆炸 | F-P1-10 收敛；新功能只上 React + bus |
| 上游 vendored 漂移 | engine-api 门禁；vendor-sync CI |
| 用户以为替代 Cursor | README/向导明确「大活来 CCui」 |
| 审查太重影响 vibe | 低风险可配置 auto-apply；键盘流减摩擦 |
| 1% 亮点不触达 | Compare、审查设为默认路径，非彩蛋 |
| **开放接口文档腐烂** | F-P0-16/17 与 zod 同源生成；CI 契约测 |
| **插件权限失控** | 白名单 + semver；高危权限默认关 |

---

## 14. 开放问题（待拍板）

1. 活动栏从 7 项收到 3 项的具体 IA 稿  
2. auto-apply 默认白名单（仅注释/文档？）  
3. `ccui-bundle` 是否含 engine-memory 记忆包（隐私）  
4. 是否做 Cursor/VSCode 扩展作为分发（寄生策略产品化）  
5. 商业化：纯开源 vs 团队版（审计、SSO 未来）

---

## 15. 附录：需求维度映射

| 维度 | 本文档章节 |
|------|------------|
| 交付（做完项目） | §6、F-P0-05/06/13、NF-08 |
| 体验 | §7.7、Phase 4 |
| 差异化（控制面） | §3、F-P0-07~09、§12 |
| **开放 / 可二开** | **§5 全章、F-OPEN、F-P0-16~20、F-P1-13~17、NF-14~15** |
| 可维护性 | §4.2、F-P1-10~12、NF-01~04 |
| 可自定义 | §5.2 L0~L6、project.yaml、插槽、主题 |
| 可迁移性 | F-P0-10~12、F-P1-08、NF-11 |
| 好用/顺手 | §6、F-P1-05~07 |

---

## 16. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-06-20 | 全篇对话收敛初稿 |
| v0.2 | 2026-06-20 | 新增第二支柱「开发者平台与开放接口」§5；双北极星；Phase1 含开放底座 |
