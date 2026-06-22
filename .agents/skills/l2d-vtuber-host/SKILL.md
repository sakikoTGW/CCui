---
name: l2d-vtuber-host
description: >-
  千早爱音 Live2D 视频主播一键流水线。路径不写死：用 L2D_VDPROD_ROOT / SAKIKO_ROOT 或
  run_pipeline.bat doctor 自动探测。用户拖视频到 一键生成.bat 即可出片。Agent 在用户提到
  爱音主播、L2D 叠加、视频替换成 vtuber、L2d_vdprod 时：先解析路径再帮跑 go 或排查 outputs/。
---

# L2D Vtuber Host

## 路径规则（禁止写死本机盘符）

| 变量 | 含义 | 设置方式 |
|------|------|----------|
| `L2D_VDPROD_ROOT` | 流水线项目根（含 `一键生成.bat`、`src/cli.py`） | 用户 `.env` / 系统环境变量 |
| `SAKIKO_ROOT` | sakiko 资源根（含 `runtime/python.exe`、live2d 模型、reference_audio） | 同上 |

**Agent 解析顺序**（每一步失败再下一步）：

1. 读 `L2D_VDPROD_ROOT`、`SAKIKO_ROOT`（CCui 根目录 `.env` 或当前 shell 环境）
2. 在 `L2D_VDPROD_ROOT` 下执行 `run_pipeline.bat doctor`，看 `auto_config` 输出
3. 仍未知时 **问用户一次**，建议写入 CCui `.env`：
   ```env
   L2D_VDPROD_ROOT=
   SAKIKO_ROOT=
   ```

## 两样东西，别混

| 是什么 | 干什么 | 怎么用 |
|--------|--------|--------|
| **Skill（本文件）** | 教 Agent 怎么帮你 | 聊天里说「帮我把这个视频做成爱音主播」 |
| **一键工具** | 真正跑流水线 | 拖视频到 `<L2D_VDPROD_ROOT>/一键生成.bat` |

## 用户一键用法（优先告诉用户这个）

1. 打开 **`L2D_VDPROD_ROOT`** 文件夹（先按上面规则解析）
2. **把 mp4/mkv 等视频拖到 `一键生成.bat` 上**
3. 等跑完，输出：`<L2D_VDPROD_ROOT>/outputs/<视频名>/<视频名>_anon.mp4`

等价命令（在流水线项目根目录）：

```bat
一键生成.bat "<绝对或相对视频路径>"
run_pipeline.bat go "<视频路径>"
```

## Agent 代跑命令（占位符，运行前必须替换）

```bat
cd /d "%L2D_VDPROD_ROOT%"
"%SAKIKO_ROOT%\runtime\python.exe" -m src.cli go "<视频绝对路径>"
```

**不要**让用户手填 config——`auto_config` 会找 sakiko、Ollama、GPU；路径仍须按上表解析。

## 资源位置（相对 SAKIKO_ROOT）

- Live2D 模型：`<SAKIKO_ROOT>/live2d_related/anon/live2D_model/`
- 爱音声库：`<SAKIKO_ROOT>/reference_audio/anon/`
- Python：`<SAKIKO_ROOT>/runtime/python.exe`

## 输出物

```
<L2D_VDPROD_ROOT>/outputs/<视频stem>/
├── timeline.json
├── audio/seg_*.wav
├── anon_overlay.webm
└── <stem>_anon.mp4
```

## 分步（仅调试）

在 `%L2D_VDPROD_ROOT%` 下：

```bat
run_pipeline.bat transcribe <video>
run_pipeline.bat synthesize outputs\<stem>\timeline.json
run_pipeline.bat render outputs\<stem>\timeline.json
```

## Agent 排查

| 报错 | 处理 |
|------|------|
| 找不到 sakiko | 检查 `SAKIKO_ROOT` 或跑 `doctor`；`auto_config` 也会搜 Desktop 下常见 sakiko 目录 |
| import live2d 失败 | 必须用 `<SAKIKO_ROOT>\runtime\python.exe`，不要用系统 python |
| TTS 失败 | 检查 `<SAKIKO_ROOT>/reference_audio/anon` |
| 无 LLM | provider=rules，规则标注，仍可出片 |

详见 [reference.md](reference.md)
