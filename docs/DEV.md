# 开发环境运行指南

本仓库是从 Claude Code 编译产物提取的源码，**不是**官方安装包。已补齐开发脚手架，可在本地用 Bun 直接跑源码。

## 前置条件

1. 安装 [Bun](https://bun.sh)（`npm install -g bun`）
2. 终端：交互式 REPL 需要**真实 TTY**（Windows Terminal / PowerShell / Cursor 集成终端）
3. DeepSeek 或 Anthropic API Key

```powershell
$env:ANTHROPIC_API_KEY = "你的 Key"
$env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"  # DeepSeek 必填
```

也可复制 `.env.example` 为 `.env`（不要提交 git）。

## 安装

```powershell
cd e:\CCui
bun install
bun run bootstrap   # 首次可选，自动补缺失 npm 包
```

## 桌面 GUI

```powershell
# 双击 start-gui.bat，或：
bun run gui
```

首次会在 `gui/` 执行 `npm install` 拉取 Electron。API Key 等在 GUI **设置** 页配置，或与 REPL 共用 `.env`。

日志：`logs/gui-latest.log`（已在 `.gitignore`）。

## 推荐命令（已验证）

| 命令 | 说明 | 耗时 |
|------|------|------|
| `bun run smoke` | **全自动冒烟测试**（help/version/ask/print） | ~1 分钟 |
| `bun run ask "问题"` | 轻量 DeepSeek 直连，不加载完整 UI | ~15s |
| `bun run deepseek -- --bare -p "问题" --model deepseek-v4-flash` | 完整 CCui 单次问答 | ~25s |
| `bun run start:repl` | 弹出 Windows Terminal 开交互 REPL | 首次 ~30s |
| `bun run dev -- --help` | 查看 CLI 帮助 | ~10s |

## 交互 REPL

**必须在真实终端里跑**（Cursor 底部终端 / Windows Terminal）。后台无 TTY 的任务会被当成 `-p` 模式。

```powershell
# 方式 1：一键弹窗
bun run start:repl

# 方式 2：手动
cd e:\CCui
$env:ANTHROPIC_API_KEY = "..."
$env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
bun run deepseek -- --bare --model deepseek-v4-flash
```

## 验证是否跑通

```powershell
bun run smoke
```

四项全 ✅ 即表示 dev 环境可用。

## 与官方 Claude Code 的区别

| 项目 | 本仓库 dev | 官方 `claude` |
|------|------------|---------------|
| 构建 | 直接跑 TS 源码 | Bun bundle + feature DCE |
| 版本 | `2.0.0-dev`（脚本注入） | 正式 semver |
| 内部包 | `@ant/*` 为 stub | 完整原生模块 |
| Skill 内容 | bundled `.md` 为空占位 | 完整文档树 |
| 缺失模块 | daemon、environment-runner 等 | 完整 |

## 已做的 dev 补丁（关键）

| 问题 | 修复 |
|------|------|
| `src/app/setup.ts` 缺失 | 新增 shim → `core/setup.ts`，否则 `-p`/REPL 永久卡住 |
| `filePersistence/types.ts` 缺失 | 补类型 stub，否则 `print.js` 无法加载 |
| `@opentelemetry/sdk-metrics` 缺失 | 已加入 `package.json` |
| 内置 ripgrep 不存在 | `ripgrep.ts` 回退到系统 `rg` |
| `MACRO.VERSION` 未定义 | `scripts/dev.ts` 注入 |
| 版本检查拦截 dev | `CLAUDE_CODE_DEV=1` |
| stdin 等 3 秒 | print 模式 `stdio: ['ignore', ...]` |
| 内部 `@ant/*` | `stubs/` 占位 |

完整列表见 git 历史；架构见 `docs/ARCHITECTURE.md`。

## 常见问题

**Q: Agent/后台命令跑交互模式报错？**  
A: 无 TTY 时会误判为 `-p` 模式。用 `bun run start:repl` 或在集成终端手动跑。

**Q: `-p` 以前卡住很久？**  
A: 根因是缺失 `setup.ts`；现已修复，冷启动约 25s。

**Q: 交互界面乱码/无法输入？**  
A: 用 Windows Terminal，不要用无 TTY 的管道。

**Q: 想完整复刻官方构建？**  
A: 需要原版 Bun build 脚本、feature flags 矩阵和内部 `@ant/*` 包。
