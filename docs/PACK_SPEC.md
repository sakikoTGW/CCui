# ccui-pack 规范（整合包格式）

> **版本**：v0.1（草案）
> **状态**：随抓包蒸馏引擎同步演进
> **一句话**：把"一个 agent"打成可克隆、可加载、可跨运行时投射的整合包。

---

## 纲领（产品定位 · 不可动摇）

> **CCui 是「可装载的 harness 运行时」（Harness Runtime）；整合包是它的「可加载模块」。**

- 别人的 harness 是 **固件（firmware）**：Codex/Cursor 的 harness 焊死在产品里，撬不动，永远只能是「一个」agent。
- CCui 的 harness 是 **可加载模块的运行时**：能在运行时把整合包 `insmod` 进去——不换 agent、不换模型，靠**装弹匣**改变行为。
- 类比：**Linux 内核 + 可加载内核模块（.ko）**。内核 = CCui，harness = 可编程执行层（审查/路由/loop/verify 的总装配），整合包 = 热装进去的「行为调校」。

**护城河只有一句**：别人能抄走文件（skills/MCP/rules 是 commodity），抄不走**调校**——因为调校（`ccui` 行为契约段）只在 CCui 的 harness 里复现。他们的 harness 没有「装载口」，整合包对他们是死字段。

**最锋利的用法**：让同一个普通模型，靠装不同的包变成不同领域专家——区别不在模型，在 harness 调校。这是固定 harness 产品结构上做不到的。

**判据**：每加一个功能问一句——这是在加固「调校可装载」，还是在退化成「文件可搬运」？前者做深，后者够用即止。

---

## 0. 心智模型

参照 PCL / MultiMC：

| Minecraft | CCui |
|-----------|------|
| 游戏版本（1.20 / Forge） | 运行时引擎：Cursor / openclaw / Claude Code（闭源，不克隆，只当"版本"） |
| 整合包（mods） | **ccui-pack**：skills + MCP + rules + 引擎脚手架 |
| 启动器（PCL） | CCui：选版本 × 选整合包 × 选实例，一键起；也能原生跑 pack |

关键拆分：

- **你装的（文件搬运，L1）**：skills / rules / MCP 配置 —— 开放格式，跨版本直接搬。
- **引擎自己的（抓包蒸馏，L2–L4）**：base system prompt / 工具 schema / system-reminder / 上下文装配配方 / 循环节奏 —— 闭源运行时不写在文件里，**唯一来源是发给模型的请求体（瓶口）**。

---

## 1. 保真度阶梯

克隆不是 0/1，是分层逼近。每个 pack 必须在 `meta.fidelity` 标注达到哪层。

| 层 | 内容 | 来源 | 能否 100% |
|----|------|------|-----------|
| **L1** 配置 | skills / rules / MCP | 文件搬 | ✅ |
| **L2** 脚手架 | base prompt + 工具 schema + system-reminder | 抓包（单次请求） | ✅（同模型时） |
| **L3** 装配 | 上下文拼装顺序 / 包裹格式 / 截断 / 注入时机 | 抓包（多轮差分） | 接近 |
| **L4** 循环 | loop / hooks / 重试 / subagent | 抓包节奏 + 重建 | 部分 |
| **L5** 模型本体 | 权重 | —— | ❌ 只能记参数 |

**承重真话**：目标模型拿不到时（它跑 Opus、你跑 DeepSeek），"一模一样"在数学上不可能——`function(llm)` 本身换了。能做到的是 **L1–L4 全克隆 + 同模型 → 行为无限逼近**。

---

## 2. Schema

```jsonc
{
  "schema": "ccui-pack/v0.1",
  "name": "string",                  // 整合包名
  "version": "string",

  // —— 你装的（L1，文件搬运）——
  "knowledge": {
    "skills": [ { "name": "string", "source": "path|git|registry", "ref": "string" } ],
    "rules":  [ { "name": "string", "format": "mdc|claude-md|agents-md", "ref": "string" } ]
  },
  "tools": {
    "mcp": [ { "name": "string", "type": "stdio|sse|http", "command?": "string", "args?": [], "url?": "string", "env?": {} } ],
    "builtin_map": [ { "name": "string", "mapTo": "string" } ]   // 引擎内置工具 → CCui 工具的映射
  },

  // —— 引擎的（L2–L4，抓包蒸馏）——
  "harness": {
    "base_system_prompt": "string",                 // 引擎自带系统提示（含其注入的一切文本）
    "tool_schemas": [ { "name": "string", "description": "string", "input_schema": {} } ],
    "system_reminders": [ "string" ]                // 工具旁/中途注入的提醒块
  },
  "assembly": {
    "wire_format": "anthropic|openai",
    "system_is_array": false,                       // 是否用数组 system（缓存断点）
    "cache_breakpoints": 0,
    "file_wrapper": "string|null",                  // 文件包裹标签，如 <file path=...>
    "message_count": 0,
    "order_hint": [ "system", "rules", "files", "history" ]
  },
  "model": {
    "name": "string",
    "params": { "max_tokens": 0, "temperature": 0, "top_p": 0, "top_k": 0, "stop_sequences": [] }
  },
  "loop": {
    "maxTurns": null,                               // 单次抓包推不出，需多轮
    "planning": null,
    "subagents": null,
    "hooks": []
  },

  "meta": {
    "capturedAt": "ISO8601",
    "source": "wire|filesystem|manual",
    "capturedFrom": "string|null",                  // 抓自哪个 agent/版本
    "sameModel": null,                              // 回放是否同模型
    "fidelity": "L1|L2|L3|L4"
  }
}
```

---

## 3. 三个动词

```
抓(Capture)  代理在瓶口录请求体 → 蒸馏 harness/assembly/model
封(Package)  归一化成上面的 schema
放(Run/Project)  ① CCui 原生跑（AgentSession 执行）  ② 投射到别的"版本"（写入其原生目录）或注入（代理 system 追加）
```

---

## 4. 边界与纪律

- **隔离**：投射到某版本是在改它的共享目录，必须写"安装清单"，支持一键干净卸载，不污染用户真实 `.cursor`/`.claude`。
- **合法性**：抓取闭源运行时的 base prompt 属灰区（对方 IP / ToS）。仅用于本地互操作，默认不分享含他人脚手架的 pack。
- **行为克隆 ≠ 逐比特**：对外只承诺"行为逼近"，禁止宣传"完美克隆"。
