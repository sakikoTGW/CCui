---
name: l2d-vtuber-host
description: >-
  千早爱音 Live2D 视频主播一键流水线。项目路径 c:/Users/Brs/Desktop/L2d_vdprod。
  用户拖视频到 一键生成.bat 即可出片。Agent 在用户提到爱音主播、L2D 叠加、
  视频替换成 vtuber、L2d_vdprod 时：直接帮跑 go 命令或排查 outputs/ 报错，勿让用户手填 config。
---

# L2D Vtuber Host

## 两样东西，别混

| 是什么 | 干什么 | 怎么用 |
|--------|--------|--------|
| **Skill（本文件）** | 教 Cursor Agent 怎么帮你 | 聊天里说「帮我把这个视频做成爱音主播」 |
| **一键工具** | 真正跑流水线 | 拖视频到 `L2d_vdprod/一键生成.bat` |

## 用户一键用法（优先告诉用户这个）

1. 打开文件夹：`c:\Users\Brs\Desktop\L2d_vdprod`
2. **把 mp4/mkv 等视频拖到 `一键生成.bat` 上**
3. 等 5 步跑完，输出：`outputs/<视频名>/<视频名>_anon.mp4`

等价命令（在项目根目录）：

```bat
一键生成.bat "D:\path\to\video.mp4"
```

或：

```bat
run_pipeline.bat go "D:\path\to\video.mp4"
```

## Agent 代跑命令

项目根：`c:\Users\Brs\Desktop\L2d_vdprod`

```bat
cd /d c:\Users\Brs\Desktop\L2d_vdprod
D:\Backup\sakiko\runtime\python.exe -m src.cli go "视频路径.mp4"
```

**不要**让用户先 doctor、先填 config——`auto_config` 会自动找 sakiko、Ollama、GPU。

## 资源位置（不在 L2d_vdprod 里）

- Live2D 模型：`D:/Backup/sakiko/live2d_related/anon/live2D_model/`
- 爱音声库：`D:/Backup/sakiko/reference_audio/anon/`
- Live2D Python：`D:/Backup/sakiko/runtime/python.exe`

## 输出物

```
outputs/<视频stem>/
├── timeline.json       # 每句台词+情绪+动作（可手改后重跑 synthesize/render）
├── audio/seg_*.wav
├── anon_overlay.webm   # 透明 L2D
└── <stem>_anon.mp4     # 最终成片
```

## 分步（仅调试）

```bat
run_pipeline.bat transcribe video.mp4
run_pipeline.bat synthesize outputs\video\timeline.json
run_pipeline.bat render outputs\video\timeline.json
```

## Agent 排查

| 报错 | 处理 |
|------|------|
| 找不到 sakiko | 确认 `D:\Backup\sakiko` 存在 |
| import live2d 失败 | 必须用 sakiko runtime python |
| TTS 失败 | 检查 reference_audio/anon |
| 无 LLM | provider=rules，规则标注，仍可出片 |

详见 [reference.md](reference.md)
