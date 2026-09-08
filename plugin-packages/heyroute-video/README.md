# Heyroute 视频协议 1.1.0

适用于影策 `yingce.plugin/v2` 声明式协议运行时，已与 v1.2.7 代码整合验证。包 ID 为 `heyroute-video-v1`，含 `heyroute-video`（11 款）和 `heyroute-video-sequential`（Seedance 三款按序转场）两个协议。这是独立适配包，不是 Heyroute 官方插件。

## 安装和配置

1. 新版宿主已内置本协议，后台可直接选择，无需再次上传。独立安装时只上传 **heyroute-video-v1.yingce-plugin**。
2. 在系统渠道配置里选择 **Heyroute 视频（11 款模型）**，Base URL 填 **https://heyroute.ai**，API Key 使用 Heyroute 的**视频分组**令牌。密钥只填后台的密钥字段，协议负责补全 `/v1/...`。
3. 添加下表中需要的模型。供应线路与前台模型的时长、分辨率、参考素材能力必须一致；不要沿用通用协议默认的 4/8/12 秒或所有画质档。插件不会自动创建模型、设置价格或修改原有渠道。
4. `model-capabilities.json` 提供符合当前前端能力结构的人工配置参考，**不是可直接导入后台的文件**。素材字节、素材时长和 prompt 限制是本地保守值，不是 Heyroute 承诺的限制。Seedance 2.0 三类素材合计 15 个，小写 MiniMax 合计 1 个，插件另做联合校验。
5. 在后台为供应线路和展示模型配置价格。Heyroute 文档中的美元符号数字是站内额度，不是人民币，也不能直接当本站积分。2.0 两档固定按 15 秒一条；其他线路按时长与对应画质定价。此包不内置兑换率或改动账务。
6. 系统运行策略中的视频任务超时建议设为 **45 分钟或更长**，尤其是小写 minimax-h3 四档。新版宿主对 Heyroute 使用 15 秒轮询间隔；其他协议的轮询策略不受影响。
7. 完成上述配置后，以实际生成检查参考图、任务完成、资源入库、可播放和本站扣费。离线测试通过不代表上游额度或模型权限已验证；实际验收结果另记部署记录。

## 模型配置表

| 模型 ID（区分大小写） | 时长（秒） | 输出画质 | 参考素材 |
| --- | --- | --- | --- |
| grok-imagine-video | 1–15，默认 8 | 480p / 720p | 首版限单张图；不收视频/音频 |
| grok-imagine-video-1.5 | 1–15，默认 8 | 480p / 720p / 1080p | 首版限单张图；不收视频/音频 |
| grok-video | 6 / 10 / 15，默认 6 | 固定 720×405 横屏 | 纯文生视频 |
| minimax-h3-quantized-768p | 4–10，默认 4 | 固定 768p 横屏 | 一张图 |
| minimax-h3-original-768p | 4–15，默认 4 | 固定 768p 横屏 | 图/视频/音频任选一个 |
| minimax-h3-original-1080p | 4–15，默认 4 | 固定 1080p 横屏 | 图/视频/音频任选一个 |
| minimax-h3-original-cf-2k | 4–15，默认 4 | 固定 2K，文档实测为竖屏 | 图/视频/音频任选一个 |
| MiniMax-H3 | 4–15，默认 4 | 480p / 720p | 最多 9 图、3 视频、3 音频；不可仅音频 |
| seedance-2.5 | 4–30，默认 4 | 480p / 720p / 1080p，默认 720p | 最多 30 图、10 视频、10 音频，可仅音频 |
| seedance-2.0 | 固定 15 | 480p / 720p | 图/视频/音频合计最多 15 |
| seedance-2.0-fast | 固定 15 | 480p / 720p | 图/视频/音频合计最多 15 |

Grok Imagine 两档支持 `auto, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16`；MiniMax-H3 和 Seedance 支持 `auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16`。不支持的画质会在提交前拒绝，不会静默降级。`grok-video` 请求只发 model/prompt/seconds；小写 MiniMax 不发送不起控制作用的 ratio/resolution 字段。

`grok-video` 的能力分辨率必须使用 `720x405`，不能叫 `720p`，因为实际高度只有 405。小写 MiniMax 的 2K 使用 `2k` 作为模型能力标签；供应线路也需配置对应画质档。其画幅控制无效，只可选 auto 或文档对应方向，不能承诺精确输出像素。前台模型的能力分辨率列表应保留 `2k`，不要只声明 `1440p`；如实际后台保存时发生自动转换，应先排查该配置链路，插件不会把任意画质自动升级为 2K。

## 参考素材和高级参数

- 普通参考图映射为 `images:[{url,role:reference_image}]`，视频/音频分别映射 `reference_video` / `reference_audio`。subject/style 标签会转成 reference_image，Heyroute 未提供额外权重控制。单素材线路使用标量 `input_reference`。
- 首尾帧保留 `first_frame` / `last_frame`；尾帧必须有首帧，且首尾帧不能与其他参考素材混用。Seedance 2.5 首尾帧模式必须选择 auto，画幅由素材决定。
- 首版要求宿主提供上游可访问的媒体地址。Seedance 2.0 明确要求 HTTPS 或 data URI；私有媒体须由现有资源系统解析成有效地址，插件不会把 localhost、Cookie 或本站登录令牌传给 Heyroute。运行时测试覆盖了 data URI 映射，但前台能否直接上传需走实际资源流程验证。
- 若要让多张图按顺序转场，在渠道/模型条目选择 **Heyroute Seedance 按序转场**（`heyroute-video-sequential`），并把最少图片数设为 1、视频/音频数设为 0。这只支持 seedance-2.5 / 2.0 / 2.0-fast，按素材 order 映射 input_reference 数组，不混入视频、音频或首尾帧。默认协议使用普通参考素材语义。转场模型可另建显示条目，关联同名上游模型并设置相同计价规则。

新版宿主已修复 providerOptions 嵌套值投影。任务调用方可通过 `metadata.providerOptions["heyroute-video"]` 提交 seed、negative_prompt、shots；普通页面没有这些高级字段时不默认添加。Seedance 2.0 支持 0–2147483647 的 seed、最多 2500 字 negative_prompt、总长 15 秒的 2–15 段 shots；2.5 seed 另支持 -1。显式 0/false 不会被当作空值。小写 MiniMax 与 MiniMax-H3 的种子效果仍有文档未验证项，不开放其 seed。额外 body 和模型覆盖始终被拒绝。

## 已覆盖与未覆盖

已实现 11 款模型的文生视频及表内参考素材映射、JSON 提交、task_id 解析、queued/in_progress/completed/failed 状态、签名结果 URL 和带鉴权的 `/content` 下载兜底。临时视频链接标记 ephemeral，交回宿主既有下载和资源保存流程。只在 completed 时接收结果，避免中途出现 URL 被错误当作完成。

尚未开放 Seedance 2.5 编辑/延长：编辑必须不传 seconds，上游先按 30 秒预扣再按实际时长退差；延长的 seconds 是成片总时长。当前通用界面与报价依赖选择的时长/画质，不能仅加两个字段就宣称完成实际时长结算。首版对此类操作明确报错；下一阶段需一起实现操作入口、源视频约束、报价及最终结算。

没有上游取消端点，故不声明 cancel。用户取消本站任务或本站超时，不等于 Heyroute 已取消或退费。生成请求不在插件中自动重提；宿主已有的故障重试策略另由管理员管理，不能因为轮询慢就重复创建收费任务。

图片由另一个内置协议 `heyroute-image` 提供。新版宿主已经支持 sse-json 响应模式，可消费 Heyroute Images SSE，并将终态交给已有资源保存流程；旧宿主必须先升级。

## 验证与重建

离线专项测试使用当前仓库 Go 协议解析器，覆盖包加载、11 款模型 payload、非法组合、轮询/结果和 SSE 不兼容证据；不代表真实 Heyroute 生成已验收。测试命令：在 backend 目录执行 `go test ./internal/protocol -run Heyroute -count=1`。完整协议包回归也可执行 `go test ./internal/protocol`。

重建：在仓库根目录执行 `python3 plugin-packages/heyroute-video/build.py`。仅生成本插件的 manifest、能力参考、ZIP 和 SHA256，不重建其他插件。源码、安装说明和散列置于 `plugin-packages/heyroute-video/`。停用此协议并处理完活动任务后，可以从后台卸载插件；渠道与模型配置需另行移除或改用其他协议。

## 核对来源

- [Heyroute 视频帮助文档](https://heyroute.ai/help?collection=models-capabilities&page=video-model)：模型标签、参数、提交/轮询/下载、额度规则。
- [Heyroute 图片帮助文档](https://heyroute.ai/help?collection=models-capabilities&page=image-model)：强制 SSE 与编辑接口。
- [Heyroute 模型页](https://heyroute.ai/pricing)：模型名称交叉核对。该页视频入口示例出现 `/v1/video/generations`，本包依据专门视频教程中完整生命周期示例使用 `/v1/videos`；端点差异仍需真实低额调用验证。
