# 火山 MediaKit 视频相对深度估计工具

火山 MediaKit 官方声明式视频处理插件，默认关闭，不是视频生成模型。管理员启用插件，在系统渠道配置 MediaKit API Key，并为视频模型选择 `volcengine-mediakit-video-depth` 协议、配置价格和用户组后，视频节点显示「相对深度」工具。无需服务器安装推理模型。

点击工具只打开确认面板，确认后创建连接原视频的结果节点和任务。产物为逐帧相对深度视频，适合动作和运镜参考；不输出骨骼、BVH 或三维动画。

完整接口见 [docs/interface.md](docs/interface.md)。本目录维护 manifest 和文档源，内嵌文档及分发包从源重新生成：

```bash
bun plugin-packages/embed-documentation.mjs volcengine-mediakit-depth
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path("plugin-packages/volcengine-mediakit-depth")
with ZipFile(root.with_suffix(".yingce-plugin"), "w", ZIP_DEFLATED) as archive:
    for relative in ("manifest.json", "README.md", "docs/interface.md"):
        archive.write(root / relative, relative)
PY
```
