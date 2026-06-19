# Claude Code UI (CCui)

Claude Code 的源码工程化版本 + **Electron 桌面 GUI**,并在其上做了模块化重构与产品差异化。
内核是 vendored 的 Claude Code 引擎(`src/`,约 1900 个 TS/React 文件,Bun 运行),
外层是 CCui 自研的**四进程薄壳 + monorepo 包 + Rust 原生索引器 + 沙箱插件系统**。

## 架构一览(四进程)

```
Electron Renderer  ──ipcRenderer/ipcMain──  Electron Main  ──stdio NDJSON──  Bun Daemon  ──in-proc──  Claude Code Engine
   (apps/desktop)                              (apps/desktop/main.js)         (services/daemon)         (src/ via 门面)
```

- **进程隔离**:UI 崩溃不拖垮引擎;daemon/索引器子进程故障被隔离。
- **协议单一真相**:`packages/protocol`(zod)同时约束 daemon 注册表与 renderer 客户端,漏改一端即编译失败。
- **引擎门面**:daemon 只经 `@ccui/engine-api` / `@ccui/engine-memory` 触达 `src/`,**零深引**,上游 `git pull` 不冲突。

详见 [docs/CCUI_STACK.md](docs/CCUI_STACK.md)。

## 快速开始

### 桌面 GUI(推荐)

双击 `start-gui.bat`(等同 `bun run gui`)→ Electron 桌面端,等 daemon ready(约 20–40 秒)。
首次运行会在 `apps/desktop/` 下自动 `npm install` Electron 并构建 React 孤岛。日志:`logs/gui-latest.log`。

GUI 主要能力:

- **工作区**:多会话、分支树、Compare 三路对比、Task Brief
- **记忆召回可视**:每轮把「基于哪些历史记忆作答」以可展开卡片呈现在对话流(候选/打分/图谱命中)
- **对话内审查**:AI 改动的 diff 直接在对话里接受/拒绝,联动审查队列(`Ctrl+Shift+R`)
- **扩展(插件)**:第三方插件在 `sandbox` iframe 中运行,经 `window.ccui` 受权限门控地调用宿主能力
- **命令面板**:`Ctrl+K` 快速搜索功能;**文件树**:浏览/预览项目文件

### 终端 REPL

| 文件 | 作用 |
|------|------|
| `start.bat` | 交互 REPL |
| `start-print.bat` | 单次问答,可拖参数:`start-print.bat 你好` |

环境预置在 `.env`(参考 `.env.example`)。命令行等价:

```powershell
cd path\to\CCui
bun run smoke         # CLI 自检
bun run test:unit     # 协议 + 插件 SDK 单测
bun run human         # GUI 冷启动 + 布局验收
```

## 目录结构

```
CCui/
├── apps/desktop/         # Electron 桌面端(renderer.js + app/ 视图 + src/ React 孤岛)
│   ├── main.js           # 主进程
│   ├── renderer.js       # 渲染入口(vanilla 宿主)
│   ├── app/              # vanilla 视图 shim / nav / store / bus
│   ├── src/              # React 孤岛(features/) + shell/ + ipc/ + data/
│   └── plugins/          # (运行时)
├── services/daemon/      # Bun daemon:命令注册表 + 引擎会话 + 资源/索引门面
├── packages/             # monorepo 内部包
│   ├── protocol/         # zod 命令/事件协议(单一真相)
│   ├── engine-api/       # 上游引擎门面(daemon 收窄接触面)
│   ├── engine-memory/    # CCui 自有引擎扩展(记忆/结构/headroom…)
│   └── plugin-sdk/       # 插件清单 + 宿主桥 + 访客 SDK
├── crates/ccui-indexer/  # Rust 原生项目索引器(并行 walk + import 抽取)
├── plugins/              # 内置/示例插件(hello)
├── src/                  # vendored Claude Code 引擎(见 LICENSE 说明)
├── scripts/              # dev / smoke / 测试 / 探针
└── docs/                 # 架构与产品文档
```

## 文档

- [CCui 栈架构](docs/CCUI_STACK.md) — 四进程 / 包边界 / 插件 / 记忆召回(P1–P10)
- [开发运行指南](docs/DEV.md) — 启动、认证、常见问题
- [上游引擎架构](docs/ARCHITECTURE.md) / [上游模块索引](docs/MODULES.md)

## 许可

CCui 原创代码(`apps/` `services/` `packages/` `crates/` `scripts/` `plugins/` `docs/`)以 MIT 发布;
`src/` 为 Anthropic Claude Code 的 vendored 快照,归属 Anthropic、不在 MIT 范围内。详见 [LICENSE](LICENSE)。

## 仓库

https://github.com/sakikoTGW/CCui
