# AutoDL ComfyUI 视频与音频

该插件把影策统一媒体请求转换为 AutoDL.Art ComfyUI 工作流参数。视频图片先按 `media.role` 区分首帧、尾帧和普通参考图，再按 `media.order` 生成工作流要求的 `ref_image_N`；数字后缀只表示上游工作流槽位，不再承担首尾帧语义。新增 `minimax_h3_z0901` 文生视频、`minimax_h3_z0902` 六图生视频与 `minimax_h3_z0903` 六图三音频生视频工作流，`@图片1` 会映射为 `ref_image_0`。

完整接口、工作流分支和字段规则见 [docs/interface.md](docs/interface.md)。
