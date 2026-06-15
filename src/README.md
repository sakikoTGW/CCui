# src 目录说明

源码按功能分层组织，**不要**把所有逻辑堆在根目录。

## 分层

| 层 | 目录 | 说明 |
|----|------|------|
| L0 入口 | `entrypoints/`, `app/` | 进程 bootstrap、CLI main |
| L0 核心 | `core/` | query 循环、Tool 池、context |
| L1 基础设施 | `utils/`, `bootstrap/`, `types/` | 配置、消息、类型 |
| L2 功能模块 | `commands/`, `tools/`, `services/`, `components/` | 命令、Tool、API、UI |
| L2 集成 | `bridge/`, `cli/`, `remote/`, `server/` | 远程、传输 |
| L2 渲染 | `ink/`, `screens/`, `hooks/`, `state/` | 终端 UI、状态 |

## 新增代码放哪里

- 新斜杠命令 → `commands/<name>/`
- 新 LLM Tool → `tools/<Name>Tool/`
- 新 UI 组件 → `components/`
- 新 API 服务 → `services/<domain>/`
- 新工具函数 → `utils/<domain>/`
- 新 React Hook → `hooks/`

## 详细文档

见项目根目录 `docs/ARCHITECTURE.md` 与 `docs/MODULES.md`。
