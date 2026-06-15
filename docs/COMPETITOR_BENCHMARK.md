# 竞品 UI 基准（Cursor / Codex）

## 逻辑（比布局更重要）

### Codex 的真实模型

```
Sidebar Thread  ──maps-to──▶  daemon AgentSession (sessionId)
       │
       ├─ 普通 Thread：一问一答 transcript
       └─ Compare：同一 prompt 创建多条 Thread（或 worktree 隔离），各自独立上下文
```

### 我们之前的逻辑错误

| 错误 | 后果 |
|------|------|
| 发明 `kind: compare` 假 Thread 类型 | Sidebar 与主舞台两套状态机，切换即丢上下文 |
| Compare 用单独 UI 舞台 + 底部三列 | 不是 Thread，无法点 sidebar 回看 Lane B |
| 切换 Thread 时 `api.reset()` 无 sessionId | **每次切换清空引擎**，与 Codex 完全相反 |
| GUI 忽略 daemon 已有 `sessionId` | 后端多 session 能力浪费 |

### 当前正确模型（已实现）

1. **只有 Thread**一种实体：`{ id, sessionId, items[], lane?, compareGroupId? }`
2. **+ Compare** → 创建 **Lane A / B / C 三条 Thread** → `runCompare(prompt)` → 结果写入各自 `items`
3. **切换 Sidebar** → 只换 transcript 渲染，**不 reset** daemon session
4. **send** 带 `sessionId: convo.sessionId`
5. **onDaemon** 按 `msg.sessionId === activeSessionId` 过滤

## UI（从逻辑推导，非反过来）

- Sidebar 顶部：`+ Thread` | `+ Compare`
- 主区域：**永远**是单 Thread 的 transcript（Lane A 或 B 或 C 或普通）
- 无 compare 舞台、无 composer 上的 compare 按钮

## 禁止

- ❌ `kind: compare` 伪 Thread
- ❌ 切换 Thread 时无条件 `api.reset()`
- ❌ 把 orchestrate 三列输出当「页面」而不是「三条 Thread 的消息」
