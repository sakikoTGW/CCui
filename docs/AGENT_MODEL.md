# CCui Agent 领域模型

> **单一真相**：概念层定义。UI（主页 / Harness 窗 / 对话 / 审查）是此模型的投影，不是模型本身。  
> **配套**：`TRUST_LOOP_PLAN.md`（可信闭环实施）、`PACK_SPEC.md`（整合包格式）、`PRD.md`（产品定位）

---

## 1. CCui 是什么

**CCui** = 外壳 + **控制面**（审查、编排、记忆、审计、瓶口接管）。

- CCui **不是** Harness，也不是某一种运行时。
- CCui **内置**一个 harness（`ccui` 原生），与 claude-code / codex / openclaw 等**并列**。
- 外部 harness **可以自己跑**（CLI）；也可以 **让 CCui 当它的 GUI**（瓶口接管 = CCui 驾驭该引擎，不是 CCui「变成」它）。

控制面职责横切所有 harness：**派活 → 工具执行 → 权限 → 审查 → 验收**，不属于 harness 分类树里的节点。

---

## 2. 两维正交（不能强行谁包含谁）

### 2.1 驾驭者维（与 project 无关，可跨项目复用）

```text
Harness → Instance → Pack → Capability
```

| 概念 | 一句话 |
|------|--------|
| **Harness** | 运行时框架（claude-code / codex / openclaw / ccui 原生 …） |
| **Instance** | 某个 harness 上的**具名安装态**（装了哪些 pack、当前投射、瓶口配置） |
| **Pack** | **无状态**整合包源码（skills / policy / tools / runtime-adapter） |
| **Capability** | pack 展开后的 skills / MCP / rules |

**范围**：`Harness ⊃ Instance`（一个 harness 下可有多个 instance）。  
**Pack** 是源码；**Instance** 是安装态；二者不可混谈。

PCL 类比（驾驭者侧）：Harness ≈ 游戏版本，Pack ≈ modpack，Instance ≈ PCL 里的一条实例配置。

### 2.2 工作对象维（与 harness 无关）

```text
Project → Profile
```

| 概念 | 一句话 |
|------|--------|
| **Project** | 代码仓库 / 工作区（workspace） |
| **Profile** | 绑 **project** 的项目心智**存档**（图谱、约定、brief、project-scope 记忆） |

Profile **不绑 instance**。Brief / Intent 是本轮任务，可文件化，仍归 project 维。

PCL 类比（工作对象侧）：Project ≈ 世界种子，Profile ≈ 存档。

---

## 3. 跑起来的 Agent（交汇态，不是树里的兄弟节点）

**Agent 脱离 project 无意义。**  
Instance  alone 只是装备库里的装配；Project alone 只是舞台。

**此刻在跑的 Agent**：

```text
Agent = Instance(∈ Harness) × Project(∈ Profile)
```

- **Pack** 已装在 **Instance** 里（能力轴）。
- **Profile** 挂在 **Project** 上（心智轴）。
- **Harness** 决定用哪套运行时协议与投射方式。

与 `TRUST_LOOP_PLAN` 三轴的关系：

```text
pack × workspace × profile   ← 三轴正交（能力 / 项目 / 心智）
        +
instance（安装态：选了哪个 harness、装了哪些 pack）  ← 驾驭者维必选项
```

同一 instance 可跑多个 project；同一 project 可换 instance（含 Compare 多 instance 同 project）。

---

## 4. Instance 的两个视角（同一对象，不互斥）

| 视角 | 干什么 |
|------|--------|
| **仓库态** | 跨 project 管理、装 pack、分发 instance（像 PCL 实例库） |
| **应用态** | 拿这个 instance 去跑某个 project → 进入「Agent 在项目上有意义」 |

UI：**Harness 窗**偏仓库态；**主页**展示当前 instance × project 并进入对话。

---

## 5. 记忆 scope

（实现：`agentMemory.ts`）

| Scope | 跟谁 | 进不进 profile 导出 |
|-------|------|---------------------|
| `user` | 人 | 否 |
| `project` | 项目 | 是（存档一部分） |
| `local` | 项目 + 本机 | 否 |

---

## 6. 导出物边界（严禁混包）

| 导出物 | 含什么 | 默认分发 |
|--------|--------|----------|
| **pack** | skills / policy / tools / contract | ✅ 可发行 |
| **profile** | 项目心智快照 | ❌ 默认不分发 |
| **instance** | harness + 已装 pack 的安装态 | 按需（便携 instance） |

纪律：**profile 不含 skills/policy；pack 不含项目记忆。**

---

## 7. UI 投影（理念后果，不是理念本身）

| 界面 | 职责 |
|------|------|
| **主页** | 选 project、看当前 instance、输入任务 → 进对话 |
| **Harness 窗** | 选 harness、管 instance、装/卸 pack |
| **主窗 · 对话** | 运行态：派活、流式、工具卡 |
| **主窗 · 审查** | 控制面：逐条签字、高风险拦截 |
| **Compare** | 同一 project 上多 instance / 多 lane 并行 |

主路径（PRD §9）：`对话 → 审查 → Done / Verify`。  
Harness / 主页 **不进**侧栏一级平铺；多窗口表达管理深度，不发明新的领域层级名。

---

## 8. 命名纪律

只用已定 domain 词 + 动词：**选 harness、建 instance、装 pack、换 project、导出 profile、开始对话**。

禁止用易误导的 UI 外号冒充领域概念（例如把「选 project 的页面」叫成 PCL「启动器」——启动器在领域上指 Harness 侧的 instance/pack 管理）。

---

## 9. 文档索引

| 文档 | 内容 |
|------|------|
| `AGENT_MODEL.md`（本文） | 领域模型、两维树、运行公式 |
| `TRUST_LOOP_PLAN.md` | P1–P3 可信闭环、profile/pack/instance 实施 |
| `PACK_SPEC.md` | ccui-pack schema、保真度 L1–L5、PCL 类比 |
| `PRD.md` | 控制面定位、双支柱、主路径、开放分层 |
