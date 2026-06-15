# Claude Code UI (CCui)

Claude Code 终端 AI 编程助手的源码工程化版本。约 1900 个 TypeScript/React 文件，基于 **Bun + React + 自研 Ink 终端 UI**。

## 快速开始（DeepSeek）

**双击即可用：**

| 文件 | 作用 |
|------|------|
| `start.bat` | 交互 REPL（主界面） |
| `start-print.bat` | 单次问答，可拖参数：`start-print.bat 你好` |

环境已预置在 `.env`（DeepSeek Key + API 地址），首次启动会自动信任目录、跳过引导。

命令行等价：

```powershell
cd e:\CCui
bun run start:here      # 当前终端交互
bun run smoke           # 自检
```

## 目录结构

```
CCui/
├── docs/                 # 架构文档
├── scripts/              # dev / deepseek / smoke / start
├── src/
│   ├── app/              # 应用入口 (main, setup, replLauncher)
│   ├── core/             # 核心引擎 (query, tools, setup)
│   ├── entrypoints/      # CLI/MCP/SDK 进程入口
│   └── ...               # 见 docs/MODULES.md
└── CC - 复制(1).zip      # 原始素材（未修改）
```

## 文档

- [开发运行指南](docs/DEV.md) — 启动、认证、常见问题
- [架构全景](docs/ARCHITECTURE.md)
- [模块索引](docs/MODULES.md)

## 说明

本仓库从编译产物提取的源码快照工程化而来。部分模块（`daemon/`、`environment-runner/`）在 fast-path 中被引用但不在当前树内。根目录 `src/*.ts` 为向后兼容的重导出 shim。
