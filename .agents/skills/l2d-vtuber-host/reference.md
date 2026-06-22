# L2D Vtuber Host — 参考

## 路径（不写死）

- 流水线根：`L2D_VDPROD_ROOT`（环境变量或 `.env`）
- 资源根：`SAKIKO_ROOT`（环境变量或 `.env`）
- CCui 用户可在仓库根 `.env` 增加（见 `.env.example` 注释）

解析失败时：在 `%L2D_VDPROD_ROOT%` 执行 `run_pipeline.bat doctor`。

## 一键

在 `%L2D_VDPROD_ROOT%`：

```bat
一键生成.bat "video.mp4"
run_pipeline.bat go "video.mp4"
"%SAKIKO_ROOT%\runtime\python.exe" -m src.cli go "video.mp4"
```

拖视频到 bat 上亦可。完成后输出在 `outputs/<名>/<名>_anon.mp4`。

## CLI 全集

```bat
run_pipeline.bat doctor
run_pipeline.bat transcribe <video>
run_pipeline.bat annotate outputs\<v>\timeline.json
run_pipeline.bat synthesize outputs\<v>\timeline.json
run_pipeline.bat render outputs\<v>\timeline.json
run_pipeline.bat composite outputs\<v>\timeline.json -o out.mp4
```

## 自动配置（src/auto_config.py）

- sakiko：优先 `SAKIKO_ROOT`，否则常见相对路径（Desktop、`Project assistance/sakiko` 等）
- LLM：API Key.txt → 环境变量 → Ollama → rules
- ASR：有 CUDA 用 GPU，否则 CPU

## 手改 timeline 后重跑

- 改文案/情绪 → 从 `synthesize` 起
- 改动作 → 从 `render` 起
- 改左下角大小 → `config.yaml` 的 `render.overlay.scale` 后 `composite`

## 动作映射

代码：`src/motion_director.py`、`src/emotion_mapping.py`  
对齐 sakiko `live2d_module.py` 的 LABEL_0–6 / rana 组索引。
