# Claude Code UI (CCui)

Claude Code 终端 AI 编程助手的源码工程化版本，附带 **Electron 桌面 GUI**。核心约 1900 个 TypeScript/React 文件（Bun + React + 自研 Ink 终端 UI），GUI 为薄壳 + Bun daemon 架构。

## 快速开始

### 桌面 GUI（推荐）

| 文件 | 作用 |
|------|------|
| `start-gui.bat` | 启动 Electron 桌面端 |
| `bun run gui` | 同上（npm script） |

首次运行会在 `gui/` 下自动 `npm install` 安装 Electron。日志：`logs/gui-latest.log`。

GUI 主要能力：

- **工作区**：多会话、分支树、Compare 三路对比、Task Brief
- **变更审查**：应用内页面，批处理允许/拒绝 diff 与工具权限（`Ctrl+Shift+R`）
- **命令面板**：`Ctrl+K` 快速搜索功能
- **文件树**：浏览项目文件，预览代码/Markdown

### 终端 REPL

| 文件 | 作用 |
|------|------|
| `start.bat` | 交互 REPL（主界面） |
| `start-print.bat` | 单次问答，可拖参数：`start-print.bat 你好` |

环境可预置在 `.env`（DeepSeek Key + API 地址）。命令行等价：

```powershell
cd path\to\CCui
bun run start:here      # 当前终端交互
bun run smoke           # 自检
```

## 目录结构

```
CCui/
├── gui/                  # Electron 桌面端
│   ├── app/              # 渲染进程模块（views、nav、theme…）
│   ├── main.js           # 主进程
│   ├── renderer.js       # 入口
│   └── style.css
├── docs/                 # 架构与产品文档
├── scripts/              # dev / deepseek / smoke / start
├── src/                  # Bun 核心（CLI、query、tools）
│   ├── app/              # 应用入口
│   ├── core/             # 核心引擎
│   └── entrypoints/      # CLI/MCP/SDK 进程入口
└── start-gui.bat         # GUI 启动脚本
```

## 文档

- [开发运行指南](docs/DEV.md) — 启动、认证、常见问题
- [架构全景](docs/ARCHITECTURE.md)
- [模块索引](docs/MODULES.md)
- [GUI 规划](docs/GUI_PLAN.md)

## 说明

本仓库从编译产物提取的源码快照工程化而来。部分模块（`daemon/`、`environment-runner/`）在 fast-path 中被引用但不在当前树内。根目录 `src/*.ts` 为向后兼容的重导出 shim。

## 仓库

https://github.com/sakikoTGW/CCui
