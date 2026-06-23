# Harness 研究（驾驭外部 agent 运行时）

> **目的**：把 CCui 要「驾驭」的外部 harness 摸透——它们各自把 skills/rules/MCP 放哪（**装备口**，第一把刀）、模型端点怎么改（**瓶口**，第二把刀）、版本/CLI 入口。
> **日期**：2026-06-23 · 来源：各项目 2026 官方文档（见每节链接）
> **诚实标注**：✅ 已核实官方文档；🟡 部分核实/需再验；❌ 现 `runtimeAdapters.ts` 与现实不符，待修。

---

## 0. 两把刀的统一视角

| 刀 | 含义 | 跨 harness 的共性 |
|----|------|-------------------|
| **装备口** | 把整合包的 skills/rules/MCP 投射进该引擎认的目录/配置 | 各家不同：目录形态 vs 配置内嵌 |
| **瓶口** | 把它发往模型的请求改道到 CCui 代理（看/改/注入/换模型） | 都归结为「改 base_url / provider」一个点 |

瓶口是结构性护城河：不管 harness 内部多封闭，它都要把请求发出去；**改 base_url 这一个点**就能接管。下表逐家给出这两个点的**确切位置**。

---

## 1. OpenAI Codex CLI ✅

- **版本/安装**：`npm i -g @openai/codex`（或官方分发）；三端（CLI/VSCode/Desktop）共用同一 config。
- **配置栈**（优先级低→高）：内置默认 → 全局 `~/.codex/config.toml` → 项目 `.codex/config.toml` → profile → CLI flags → 环境变量(`CODEX_MODEL` 等)。
- **装备口**：
  - skills：项目 `.agents/skills/` + 用户 `~/.codex/skills/`（含 `SKILL.md` 的目录）
  - rules：`AGENTS.md`（沿目录树向上拼接 root→当前），`project_doc_max_bytes` 默认 32KiB
  - MCP：`[mcp_servers.NAME]` in `~/.codex/config.toml` 或 `.codex/config.toml`
    - stdio：`command` + `args` + `[mcp_servers.NAME.env]`
    - HTTP：`url` + `bearer_token_env_var`
- **瓶口**：`[model_providers.NAME]` 设 `base_url`（OpenAI 兼容 / Responses API），顶层 `model_provider = "NAME"` 激活。
  - ⚠️ **关键陷阱**：`model_provider` 和 `openai_base_url` 在**项目级 config 里被忽略**（安全），**必须写全局 `~/.codex/config.toml`**。要接管 Codex 瓶口，只能改全局。
  - `model_providers` / `mcp_servers` **不可被 profile 覆盖**，必须定义在顶层。
- **CLI**：`codex mcp add/list/login`。

---

## 2. Claude Code ✅

- **配置作用域**（高→低）：Managed(组织) > CLI flags > `.claude/settings.local.json` > `.claude/settings.json` > `~/.claude/settings.json`。标量被高层覆盖；数组（permissions/hooks）拼接去重。
- **装备口**：
  - skills：`.claude/skills/<name>/SKILL.md`（项目）+ `~/.claude/skills/`（用户）。⚠️ 必须是 `<name>/SKILL.md` 目录形态，散文件 `name.md` 不识别。
  - rules/memory：`CLAUDE.md`（仓库根或 `.claude/CLAUDE.md`）、`.claude/rules/*.md`、`CLAUDE.local.md`
  - MCP：`.mcp.json`（**仓库根**，不是 `.claude/` 内）+ `~/.claude.json`（用户/local 作用域）。`type` 接受 `streamable-http`/`http`。
  - subagents：`.claude/agents/`
- **瓶口**：`ANTHROPIC_BASE_URL` 环境变量（也可写 `settings.json` 的 `env` 块，启动即读）。
  - ⚠️ 指向**非 Anthropic 一方域名时，默认禁用 MCP tool search**；需 `ENABLE_TOOL_SEARCH=true` 且代理转发 `tool_reference`。
- **诊断**：`/context`、`/doctor`、`/mcp`、`/skills`、`/memory`、`/status`。
- **关停内置**：`disableBundledSkills` / `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`。

---

## 3. OpenClaw ❌（现 adapter 与现实不符，需修）

- **真实项目**：`openclaw/openclaw`，TypeScript，Gateway 常驻；版本如 `2026.6.5`，`npm i -g openclaw@<ver>`；`openclaw update --channel stable|beta|dev`；`openclaw gateway restart`。
- **配置**：`~/.openclaw/openclaw.json`，**JSON5** 格式（注释、热重载）。`OPENCLAW_CONFIG_PATH` 可改路径；不支持 symlink。
- **装备口**：
  - MCP：**`mcp.servers`（嵌套对象，键为名）**——`{ command, args, transport: "stdio" }` 或 `{ url }`，支持 stdio/HTTP/SSE/streamable-http。
    - ❌ **现 adapter 写的是顶层 `mcpServers`（`json-mcpServers`）—— 错！** OpenClaw 用 `mcp.servers`，我们的 parser 会**漏读**。
    - CLI：`openclaw mcp add/list/show/set/unset`。
  - skills：配置里 `skills.entries.*`（带 apiKey 引用等）。🟡 是否另有 `.agents/skills` 目录形态需再验；至少 config 内嵌是主路径。
  - rules：未见独立 AGENTS.md 主张（基于 Claude Code 但配置自成体系）。🟡
- **瓶口**：`models.providers.<id>.baseUrl`（+ `apiKey`）；模型 ref 用 `provider/model`（如 `anthropic/claude-opus-4-6`）。`models.mode: merge|replace`。
- **修复建议**：给 adapter 增 `json5-openclaw`（读 `mcp.servers`）格式；skills 改为「config.skills.entries + 可选目录」。

---

## 4. Hermes Agent（NousResearch/hermes-agent）✅（已据本机源码 E:\hermes-agent-main 核实）

- **配置**：`~/.hermes/config.yaml`（YAML；示例 `cli-config.yaml.example`）。`.env` 走 `~/.hermes/.env`。
- **装备口**：
  - **skills**：`~/.hermes/skills/`，**分类嵌套**结构 `skills/<category>/<name>/SKILL.md`（如 `skills/apple/apple-notes/SKILL.md`、`skills/autonomous-ai-agents/codex/SKILL.md`）；每类有 `DESCRIPTION.md`。技能创建写 `~/.hermes/skills/`。
    - ✅ **关键**：config `skills.external_dirs: [~/.agents/skills, ...]` 原生支持**只读外部 skill 目录**——最干净的装备口（指过去即用，不污染 Hermes 自身目录）。本地同名优先。
  - MCP：`mcp_servers:`（YAML，键为名）——stdio `command`/`args`/`env`/`timeout`/`connect_timeout`；HTTP `url`/`headers`；`enabled`、`sampling`。`hermes mcp add`；`/reload-mcp` 热重载。✅
  - rules：仓库根 `AGENTS.md`；持久记忆 `MEMORY.md`/`USER.md`（注入 system prompt）。
  - hooks：config `hooks:`（pre_tool_call/post_tool_call/pre_llm_call/… 同 Claude Code 风格，shell 脚本）。
- **瓶口**（✅ 已确证）：config `model.base_url` + `model.provider`。自定义 OpenAI 兼容代理：`model.provider: "custom"`（别名 ollama/vllm/llamacpp 也映射 custom）+ `model.base_url: "http://…/v1"`。亦支持 `model_aliases.<alias>.base_url`，以及大量 env 覆盖（`OPENAI_BASE_URL`、`NOVITA_BASE_URL`、`GEMINI_BASE_URL`…）。
- **其它**：`agent.max_turns`（默认 60）、`agent.personalities.*`（命名人格）、`compression`（自动压缩）、`delegation`（subagent）、`platform_toolsets`（按平台工具集）。
- **自身也能当 MCP server**：`hermes mcp serve`（stdio）。

---

## 5. AstrBot ✅（已据本机 clone E:\CCui\.ccui-vendor\AstrBot 核实；v4.25.6）

形态是 Python 全能聊天 bot 平台（`uv tool install astrbot`，Python 3.12），但 **v4 已同时具备 plugins + skills + MCP + persona**，且自称 “openclaw alternative”。根 = `get_astrbot_root()`，数据在 `data/`。

- **装备口（三条，按 CCui 用法排序）**：
  1. **包装成插件（star）——用户指定的方式**：`data/plugins/ccui-<pack>/`，内含：
     - `metadata.yaml`（name/author/desc/version/repo；v3.5.19+ **无需** `@register_star` 装饰器，自动识别继承 `Star` 的类）
     - `main.py`（一个 `class Xxx(Star)`；类 docstring 即 `/plugin` 帮助）
     - `_conf_schema.json`（可选，插件配置 Schema → `data/config/<plugin>_config.json`）
     - `skills/<name>/SKILL.md`（**插件自带 skills**，AstrBot 视为只读、source_label=插件名）
  2. **直接装 skill**：`data/skills/<name>/SKILL.md`（YAML frontmatter `name`+`description`——**与 Codex/Claude 完全同格式**，源码注释明示）；`data/skills.json` 记 `{skills:{<name>:{active}}}`；支持 **`install_skill_from_zip()`**（zip 根含 `SKILL.md` 或 `<name>/SKILL.md` 文件夹）。
  3. MCP：AstrBot 的 MCP 注册表是 **`data/mcp_server.json`**（`{mcpServers:{<名>:{command/args/env|url, active}}}`，由 `func_tool_manager.load_mcp_config/save_mcp_config` 读写）。CCui 在激活 AstrBot 实例时**自动合并**实例 MCP 进该文件（标 `active:true`），并写安装清单——切实例/停用**一键回滚**。（WebUI 也写同一文件。）
- **瓶口**：`provider` 配置项下 `model_config` + `api_base`（自定义 OpenAI 兼容端点）。
- **人格**：`PersonaManager`（v4 入库 `Persona`；`Personality{prompt,name,begin_dialogs,tools}`；旧 `persona[]` 字段废弃）。
- **路径确认**：`data/`（data）、`data/plugins/`（plugins）、`data/skills/`（skills）。
- **CCui 策略（特殊处理）**：对 AstrBot **生成一个插件包** `data/plugins/ccui-<pack>/`，把整合包的 skills 放进插件的 `skills/` 子目录（随插件分发、可整体启停/更新），`main.py` 可选注册 MCP/persona；而非散投 skills。这样一个 pack = 一个可管理的 AstrBot 插件。

---

## 6. 现 `runtimeAdapters.ts` 核对结论

| runtime | skills | rules | MCP | 瓶口(base_url) | 判定 |
|---------|--------|-------|-----|----------------|------|
| ccui / claude-code | ✅ `.claude/skills` | ✅ CLAUDE.md/.claude/rules | ✅ `.mcp.json`/`~/.claude.json` | `ANTHROPIC_BASE_URL` | ✅ |
| cursor | ✅ `.cursor/skills` | ✅ `.cursor/rules` | ✅ `.cursor/mcp.json` | （IDE，内部）| ✅ |
| codex | ✅ `.agents/skills` | ✅ AGENTS.md | ✅ `config.toml [mcp_servers]`(toml) | 全局 `[model_providers].base_url` | ✅（瓶口须全局）|
| openclaw | ✅ `{workspace}/.agents/skills`、`~/.agents/skills`（已核实加载路径） | 🟡 | ✅ `mcp.servers`(JSON5) | `models.providers.*.baseUrl` | ✅ |
| hermes | ✅ `~/.hermes/skills/<cat>/<name>/SKILL.md` + `skills.external_dirs` | ✅ AGENTS.md | ✅ `mcp_servers`(yaml) | ✅ `model.base_url` + `provider: custom` | ✅ 已核实 |
| astrbot | ✅ `data/skills/<name>/SKILL.md`（同 Codex/Claude）+ 插件 `<plugin>/skills/` | — | ✅ `data/cmd_config.json`(WebUI) | `provider.api_base` | ✅ 已核实 |

**已修 / 已核实**：
1. ✅ OpenClaw：已加 `json-openclaw`（JSON5 + `mcp.servers`），见 `runtimeAdapters.ts`。
2. ✅ Hermes：skills 路径核实为分类嵌套 + `external_dirs`；瓶口 `model.base_url`/`provider: custom`。
3. ✅ AstrBot：skills 是标准 SKILL.md；CCui 对其**包装成插件**（`data/plugins/ccui-<pack>/skills/`）。

---

## 7. 对「驾驭」实现的指导（投射口 + 瓶口矩阵）

| runtime | skills 投射目标 | MCP 写入 | 瓶口改道点 | 瓶口注意 |
|---------|------------------------|----------|-----------|----------|
| ccui/claude-code | `.claude/skills/` | `.mcp.json` | `ANTHROPIC_BASE_URL` | 非一方域名禁 tool search，需 `ENABLE_TOOL_SEARCH=true` |
| codex | `.agents/skills/` | `.codex/config.toml [mcp_servers]`(toml) | **全局** `~/.codex/config.toml [model_providers].base_url` + `model_provider` | 项目级 base_url 被忽略 |
| openclaw | （config `skills.entries`） | `~/.openclaw/openclaw.json` `mcp.servers`(JSON5) | `models.providers.*.baseUrl` | 热重载，无需重启（gateway 块除外）|
| hermes | `~/.hermes/skills/<cat>/<name>/` **或** config `skills.external_dirs` 指向 CCui 目录（推荐，非侵入） | `~/.hermes/config.yaml` `mcp_servers`(yaml) | `model.base_url` + `model.provider: custom` | `/reload-mcp` 热重载 |
| astrbot | **生成插件** `data/plugins/ccui-<pack>/skills/<name>/SKILL.md`（+ metadata.yaml/main.py）或 `data/skills/` | `data/cmd_config.json`(WebUI) | `provider.api_base` | 一个 pack = 一个可启停插件 |

**最干净的非侵入装备口**：Hermes 的 `skills.external_dirs` 是范例——指向 CCui 实例目录即可，根本不写它自己的 skills 树。其它引擎若也支持 external/additional dir，应优先用，避免污染本机。

**实现状态（services/daemon/runtimeProjection.ts）**：激活实例时按 runtime 把 MCP 合并进各自真实文件，带清单可回滚：
- claude-code/ccui/cursor → `<cwd>/.mcp.json`（JSON）✅
- astrbot → `<cwd>/data/mcp_server.json`（JSON，+插件生成）✅
- **hermes → `~/.hermes/config.yaml` 的 `mcp_servers`（YAML，保留原 model/注释外的键，`enabled:true`）✅**
- **openclaw → `~/.openclaw/openclaw.json` 的 `mcp.servers`（JSON5，`transport:stdio`）✅**
- **codex → `~/.codex/config.toml` 的 `[mcp_servers.NAME]`（TOML，marker 块追加，保留注释，可回滚）✅**
- 护栏：全局配置（~/.hermes、~/.openclaw、~/.codex）**不存在则跳过**，绝不凭空造残缺全局配置。
- Hermes skills：用 `skills.external_dirs` 非侵入挂载实例 skills 目录（不拷文件）✅
- OpenClaw skills：投到 `{workspace}/.agents/skills`（已核实 OpenClaw 加载路径）✅

**瓶口 base_url 改道（runtimeProjection.applyBaseUrl/revertBaseUrl，整文件备份精确回滚）**：
- claude-code/ccui → `<cwd>/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL`（+`ENABLE_TOOL_SEARCH=true`）✅
- hermes → `~/.hermes/config.yaml` 的 `model.base_url` + `model.provider: custom` ✅（受全局护栏）
- openclaw → `~/.openclaw/openclaw.json` 的 `models.providers.<id>.baseUrl`（JSON5）✅（受全局护栏）
- **codex → `~/.codex/config.toml` 顶层 `openai_base_url`（marker 块 prepend，把内置 openai provider 指向代理，规避顶层 key 位置约束；保留原文+注释）✅（受全局护栏；已手动设则不覆盖）**
- **astrbot → `data/cmd_config.json` 的 `provider` 列表新增一个 OpenAI 兼容 provider（id=ccui-proxy, api_base）并设 `provider_settings.default_provider_id`✅（整文件备份精确回滚）**
- daemon 命令 `runtimeBaseUrl {runtime, baseUrl|revert}`。整文件备份 → 精确回滚。

**瓶口统一结论**：五家都能归到「改 base_url/provider 一个点」。CCui 代理（captureProxy）只要：
1. 起在本地某端口；
2. 按 runtime 把它的 base_url 指过来（codex 改全局 toml、claude 设 env、openclaw 改 JSON5、hermes 改 yaml、astrbot 改 provider）；
3. 带**安装清单**记录改了哪个文件的哪个键，停用一键还原。

这就是第二把刀的落地图纸——**和 harness 内部实现无关，只动它的「嘴」指向哪。**

---

## 8. 合法/隔离纪律（沿用 PACK_SPEC §4）

- 改外部引擎的全局配置（如 codex 全局 toml、`~/.openclaw/openclaw.json`）属**侵入式**，**必须**写安装清单、支持一键干净还原，且明确告知用户「这会改你的 ~/.codex」。
- 抓取闭源引擎 base prompt 属灰区，仅本地互操作，默认不分享含他人脚手架的 pack。
