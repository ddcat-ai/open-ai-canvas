# Agnes AI 视频协议

Agnes AI 官方视频接口使用 Bearer API Key 和异步任务模型。影策实现覆盖 `agnes-video-v2.0`、`agnes-video-2.5`、`agnes-video-2.5-flash`，创建任务后保存响应中的 `video_id`，再查询任务状态。官方国际站 Base URL 为 `https://apihub.agnes-ai.com/v1`；密钥只配置在后端渠道，不进入浏览器 URL、日志或任务正文。

## 接口与鉴权

{{OPERATIONS}}

创建请求发送到 `/v1/videos`。轮询接口比较特殊：它位于同一主机的根路径 `/agnesapi`，而不是 Base URL 的 `/v1` 下。影策通过“同源根路径”合同拼接请求，因此配置 `https://apihub.agnes-ai.com/v1` 时会得到 `https://apihub.agnes-ai.com/agnesapi?...`，不会错误拼成 `/v1/agnesapi`，也不会把主机硬编码进协议适配器。

请求头使用 `Authorization: Bearer <API_KEY>` 和 `Content-Type: application/json`。创建响应优先读取 `video_id`，兼容读取 `task_id` 和 `id`；轮询始终携带 `video_id`，并在模型名可用时携带 `model_name`。

## 模型与模式

- `agnes-video-2.5`：支持 `text`、`keyframe`、`reference`。时长为字符串 `"4"` 到 `"12"`，默认 5 秒；分辨率支持 `720P`、`960P`、`2K`。
- `agnes-video-2.5-flash`：模式与 2.5 相同，但固定 `720P`，参考图最多 5 张，不支持参考视频。
- `agnes-video-v2.0`：支持文生视频、单图生视频和多关键帧；时长由 `num_frames / frame_rate` 控制，`num_frames` 必须符合 `8n + 1` 且不超过 441。

2.5 系列未显式传 `mode` 时，纯文本使用 `text`；存在音频或视频时使用 `reference`；只有一至两张图片时使用 `keyframe`。如果业务需要把图片当风格或主体参考，应在扩展参数中明确传 `mode: "reference"`。模式与媒体组合不合法时，影策在发出上游请求前直接拒绝。

## 参数映射

{{PARAMETERS}}

### Agnes Video 2.5 / 2.5 Flash

公共请求字段包括 `model`、`prompt`、`mode`、`seconds`、`size`、`aspect_ratio`、`seed`、`n`。影策固定 `n: 1`。影策字段 `images` 在 `keyframe` 模式把前两张图片依次映射为 `first_frame`、`last_frame`；在 `reference` 模式映射为官方图片数组。影策字段 `videos`、`audios` 分别映射为官方同名数组。参考视频当前发送 `{ "url": "..." }`，不臆造 `start_seconds` 或 `require_audio`。

### Agnes Video V2.0

单张 `images` 输入映射为 `image`；多张图片映射为 `extra_body.image` 并设置 `extra_body.mode: "keyframes"`。影策字段 `duration` 会按 `frame_rate`（缺省 24）换算到最近的 `8n + 1` 帧并限制在 441 帧内。高级字段 `width`、`height`、`num_frames`、`frame_rate`、`num_inference_steps`、`seed`、`negative_prompt` 可由模型协议扩展参数传入。V2.0 不使用 `aspectRatio` 或 `resolution` 直接猜测尺寸。

## 响应、状态与错误

创建成功响应中的 `video_id` 是推荐轮询标识。状态映射为：`queued` -> 等待，`in_progress` -> 处理中，`completed` -> 成功，`failed` -> 失败。成功结果优先读取 2.5 官方结构中的 `metadata.url`，并兼容 V2.0 返回的顶层 `url`；如果响应宣称完成却没有视频 URL，影策会返回真实协议错误，不生成假 URL。失败信息优先读取 `error.message`，其次读取顶层 `message` 或 `detail`。

参考媒体必须是 Agnes 服务可公开访问且在任务完成前持续有效的 URL。适配器声明了公共媒体 URL 要求，影策运行时会按现有资源流程准备上游可访问地址；本机、私网、Cookie 保护或很快过期的链接不能作为 Agnes 输入。

## 官方资料

- 官网：<https://agnes-ai.com/>
- 文档首页：<https://wiki.agnes-ai.com/en/docs/overview>
- Agnes Video 2.5：<https://wiki.agnes-ai.com/en/docs/agnes-video-25>
- Agnes Video 2.5 Flash：<https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash>
- Agnes Video V2.0：<https://wiki.agnes-ai.com/en/docs/agnes-video-v20>

官方当前给出的创建接口是 `POST https://apihub.agnes-ai.com/v1/videos`，推荐查询接口是 `GET https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>&model_name=<MODEL>`。价格和促销会变化，不在协议适配器中固化。

{{CONTRACT}}
