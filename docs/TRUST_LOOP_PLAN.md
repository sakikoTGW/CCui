# CCui 可信闭环 · 不妥协实施 plan

> **北极星**：把 CCui 从「能装配的工作台」升级成「**能证明自己行为、可托付、可发行、可迁移**的 agent 系统」。
> **纪律**：每一刀都带验收基线（golden/test），不留空壳；险活带安装清单可回滚；先立根，冻结果。

---

## 0. 锁定的不可逆决定（已对齐，不再回头）

> **领域模型全文**：见 [`AGENT_MODEL.md`](./AGENT_MODEL.md)（Harness / Instance / Project / Profile / Agent 两维树与运行公式）。

1. **运行公式**（补全 instance 维）：
   ```text
   此刻在跑的 Agent = Instance(∈ Harness) × Project(∈ Profile)
   ```
   其中 pack 已装在 instance；profile 绑 project。与下述三轴不矛盾——三轴描述「能力 / 项目 / 心智」正交；**instance 声明「用哪套 harness + 已装哪些 pack」**。
2. **三轴模型**：能力(pack) × 项目(workspace) × 项目心智(profile)，三轴**正交**。
   - **pack**＝能力（skills/policy/tools/runtime-adapter）——无状态源码，可跨项目、可分发。
   - **workspace**＝项目代码——工作对象，不打包。
   - **profile**＝项目心智（理解/目标/约定/记忆）——绑定项目，是「**存档**」，默认不分发。
3. **记忆按 scope 三分**（已存在 `agentMemory.ts`）：`user`（跟人）/ `project`（跟项目，进存档）/ `local`（跟项目+机器）。
4. **pack = 无状态源码**，单包四段（content / policy / tools / runtime-adapter）+ 模块元数据（requires / provides / conflicts / overrides / provenance / fidelity / contract / tests）。
5. **instance = 安装态**（harness + packs 的本地投射）；**profile = 存档**（项目心智）。pack / profile / instance 各有独立的导出/导入与回滚。
6. **CCui ≠ Harness**：CCui 是控制面外壳；Harness 是运行时框架；外部 harness 可 CLI 自跑，也可由 CCui 瓶口接管当 GUI。

PCL/MC 类比：pack＝modpack，workspace＝世界种子，**profile＝存档**，instance＝启动器实例，Harness＝游戏版本。

---

## 1. 三根（按依赖排序）

| 根 | 解决什么缺口 | 验收基线 |
|----|------------|----------|
| **P1 存档（project-profile）** | 「一键复刻 agent 对项目的理解与目标」 | 导出→导入到空目录→图谱/约定/项目记忆/briefs 齐备（golden） |
| **P2 行为合同（contract v0）** | 「装完后应表现成什么」可验证 | 装 pack→跑合同断言→绿/红（golden 行为测试） |
| **P3 真门禁补齐** | 拒绝硬回滚 + 高风险下沉到合同 + 审计日志 | 拒绝→文件真回滚；高风险按 contract 拦；每次决策落审计 |

后续（地基立住再做，**本轮不碰**）：
- **P4 Agent IR v0**：从已验证的 5 个 backend（runtimeProjection）**反推**中间表示（normalize → IR → lower），不top-down 空画。
- **P5 可信发行**：provenance 签名 + semver + changelog + protocol/BusEvents 契约测。
- **冻结**：IA 收敛、auto-apply 白名单、Cursor/VSCode 扩展发行形态、商业/SSO —— 依赖上面先立，过早做是本末倒置。

---

## 2. 现状盘点（避免重复造）

- **真门禁 80% 已闭合**（阶段 1）：全会话 `autoApprove:false`、forceAsk 硬挂起、respondPermission 路由、ReviewView 批量跳过高风险。**真正还差**：①拒绝硬回滚 ②高风险分类从 UI 启发式下沉到 `pack.contract` ③审计日志。
- **装备口 + 瓶口 + 闭环已通**：5 个 runtime 的 skills/MCP/base_url 投射 + 代理改道 + 回滚（`runtimeProjection.ts`）。
- **instance 已建**：`instanceStore.ts`（CRUD/激活/投射/回滚/intercept）。
- **记忆已分 scope**：`agentMemory.ts`（user/project/local），project-scope 在 `<cwd>/.claude/agent-memory/`。
- **存档料已散落**：`.claude/ccui-project-graph.json`、`CLAUDE.md`/`.ccui/project.yaml`、`.ccui/briefs/`、`.ccui/code-index.json`、`.claude/agent-memory/`。

---

## 3. 本轮执行（P1 存档，做穿带测试）

**project-profile artifact（`ccui-profile/v1`）** = project-scope 心智的可迁移快照：

收集（仅 cwd 内、project-scope）：
- 结构图谱 `.claude/ccui-project-graph.json`
- 约定 `CLAUDE.md`、`.claude/CLAUDE.md`、`.ccui/project.yaml`
- 历史目标 `.ccui/briefs/**`
- 项目记忆 `.claude/agent-memory/**`（project-scope）
- 代码索引元信息 `.ccui/code-index.json`（含 builtAt/chunks 数，内容大可选裁剪）

能力：
- `exportProfile(cwd)` → `.ccui/profiles/<name>.profile.json`（内嵌文件，便携）
- `importProfile(cwd, profile, {overwrite})` → 还原到目标项目，带安装清单可回滚
- daemon 命令 `profileExport` / `profileImport` / `profileList`
- golden 测试：tmp 项目造图谱+记忆+briefs → 导出 → 导入空目录 → 断言齐备 + 回滚干净

纪律：
- profile **默认不分发**（含项目私货）；分享需显式脱敏（后续）。
- 与 pack 严格区分：profile 不含 skills/policy；pack 不含项目记忆。
- 与 instance 正交：同一 profile 可配任意 pack/instance。

---

## 4. 验收基线（golden，逐根累加，绝不靠"看起来像"）

- P1：`test-project-profile.ts` —— 导出含全部 project-scope 料；导入还原；回滚干净。
- P2：`test-contract.ts` —— pack.contract 断言（高风险必拦 / taskType→tier / verify 必跑）在装载后可被验证为绿。
- P3：`test-gate.ts` —— 拒绝→文件回滚；高风险→强制审查（来自 contract）；审计日志落盘。

每根合并前 7+N 套测试全绿、无 lint、build 通过。
