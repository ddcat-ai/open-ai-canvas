# AutoDL ComfyUI 视频
该插件把影策统一视频请求转换为 AutoDL.Art ComfyUI 工作流参数。上游模型 ID 原样透传为 URL 中的 `{workflow_id}`，上线新工作流无需更新插件：清单已声明的工作流按各自字段分支发送；其他工作流使用通用映射，图片按 `media.order` 生成 `ref_image_N`，音频生成 `ref_audio_N`，分辨率默认提供 480p竖、768p竖、960p竖、480p横、768p横、960p横（默认 768p竖），管理员也可输入上游支持的其他标签。
已声明工作流中，视频图片先按 `media.role` 区分首帧、尾帧和普通参考图，再按 `media.order` 生成工作流要求的 `ref_image_N`；数字后缀只表示上游工作流槽位，不再承担首尾帧语义。`minimax_h3_z0901` 文生视频、`minimax_h3_z0902` 六图生视频与 `minimax_h3_z0903` 六图三音频生视频工作流中，`@图片1` 会映射为 `ref_image_0`。
`minimax_h3_zm_u30` 接受最多 9 张参考图和 3 段音频。短剧提示词中的 `@图片1` 对应 `ref_image_0`。

完整接口、工作流分支和字段规则见 [docs/interface.md](docs/interface.md)。
