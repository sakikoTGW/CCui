# L2D Vtuber Host — 参考

项目根：`c:\Users\Brs\Desktop\L2d_vdprod`

## 一键

```bat
一键生成.bat "video.mp4"
run_pipeline.bat go "video.mp4"
python -m src.cli go "video.mp4"
```

拖视频到 bat 文件上亦可。完成后自动打开 `outputs/<名>/<名>_anon.mp4`。

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

- sakiko：`D:/Backup/sakiko` 或 Desktop/Project assistance/sakiko
- LLM：API Key.txt → 环境变量 → Ollama → rules 规则标注
- ASR：有 CUDA 用 GPU，否则 CPU

## 手改 timeline 后重跑

- 改文案/情绪 → `synthesize` 起
- 改动作 → `render` 起
- 改左下角大小 → `config.yaml` 的 `render.overlay.scale` 后 `composite`

## 动作映射

代码：`src/motion_director.py`、`src/emotion_mapping.py`  
对齐 sakiko `live2d_module.py` 的 LABEL_0–6 / rana 组索引。
