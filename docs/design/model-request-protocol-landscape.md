# LLM、Image、Video 主流请求协议全景与影策兼容性调查

> 调查快照：2026-08-31
> 文档性质：协议调研与现状审计，不是最终统一协议设计稿
> 目标：为后续“影策通用生成请求标准底座”和 provider 插件体系提供事实清单、差异维度与验收边界。

## 1. 结论先行

1. **模型名、厂商名、请求协议不是同一个概念。** Wan、Seedance、Veo、Grok、MiniMax H3 是模型或产品族；同一模型可能通过官方原生 API、OpenAI-compatible 网关、NewAPI、fal、Replicate、ComfyUI 或私有中转暴露，实际请求结构完全不同。
2. **“OpenAI-compatible”通常只表示局部兼容。** 常见情况是只兼容 `/v1/chat/completions` 的路径和基础 `messages`，但不兼容 Responses、工具调用、图片输入、文件、SSE 事件、usage、错误码、JSON Schema、视频任务或图片编辑。
3. **文本、图片、视频不能共用一个扁平字段表。** 文本主要是消息/内容块与流式事件；图片同时存在 JSON、multipart、同步 base64、异步任务；视频普遍是异步任务，并且参考图的“顺序”和“语义角色”会改变协议结构。
4. **参考素材必须以语义角色建模，不能只以数组下标建模。** `images[0]` 可能代表首帧、主参考图、被编辑原图或第一张角色图；`images[1]` 可能代表尾帧、第二角色、风格图或 mask。数组下标只能作为稳定顺序，不能承担业务语义。
5. **插件不能只做字段重命名。** 主流协议需要数组遍历、按 role 过滤、条件分支、对象/数组构造、枚举转换、multipart、签名、轮询、取消、SSE 解析、结果下载和错误归一化。
6. **影策当前已经有统一请求雏形，但声明式插件能力不足。** `GenerationRequest` 已有 `Images/Videos/Audios/Operation/Extra`，`MediaReference` 也已有 `Role`；但声明式插件看到的 `request.images` 丢失了 `id` 与 `role`，只能写 `request.images.0.url` 之类固定编号。
7. **MiniMax H3 的现有问题不是单一参数名问题。** 当前前端旧直连与后端内置适配器对 MiniMax 视频的 payload 不一致：分辨率、比例、水印、校验范围、content 结构及顶层 prompt 的处理均有差异；通过中转时还可能再套一层 NewAPI 结构。

## 2. 调查范围与分类方法

“市面所有协议”没有封闭集合：模型、聚合平台和私有中转持续新增，部分产品没有公开稳定 API。本文采用以下覆盖标准：

- 国际主流基础模型厂商及云平台；
- 国内主流基础模型和创作模型厂商；
- 影像生成领域常见商业 API；
- OpenAI-compatible、NewAPI、LiteLLM、OpenRouter、fal、Replicate 等聚合/运行时协议；
- ComfyUI、RunningHub、AutoDL 等工作流协议；
- 影策仓库已经出现或社区明确反馈的协议。

每个条目区分四层：

| 层 | 含义 | 示例 |
| --- | --- | --- |
| 模型族 | 生成能力和模型约束 | GPT、Claude、Gemini、Seedance、Wan、Hailuo H3 |
| 原生线协议 | 厂商官方 HTTP/事件协议 | Anthropic Messages、Gemini generateContent、Ark contents tasks |
| 网关协议 | 聚合平台暴露的兼容入口 | NewAPI、OpenRouter、LiteLLM、SiliconFlow |
| 工作流协议 | 提交图或工作流并轮询 | ComfyUI prompt/history/view、RunningHub workflow |

## 3. 所有协议都要调查的共同维度

后续统一底座至少要保存以下事实，不能只保存 `model + prompt + images`：

| 维度 | 必须表达的内容 |
| --- | --- |
| endpoint | Base URL、版本前缀、模型是否在 path、创建/查询/取消/下载路径 |
| 鉴权 | Bearer、`x-api-key`、`anthropic-version`、`x-goog-api-key`、AK/SK 签名、云 IAM |
| 编码 | JSON、multipart/form-data、二进制上传、文件 ID、URL、data URL、base64 |
| 操作 | text/chat/response、image generation/edit、text/image/reference/frame/video/audio-to-video |
| 内容结构 | messages、input items、contents/parts、content blocks、instances、workflow graph |
| 素材语义 | first frame、last frame、subject/style/reference、mask、control、motion、audio、voice |
| 输出控制 | 尺寸、比例、分辨率档、时长、帧率、数量、质量、seed、水印、音频 |
| 生命周期 | 同步、SSE、异步任务、长操作、回调、轮询间隔、超时、取消 |
| 状态 | queued/running/succeeded/failed/cancelled/expired 及厂商别名 |
| 结果 | 文本块、工具调用、URL、base64、file ID、临时签名 URL、二进制下载 |
| 错误 | HTTP 状态、业务 code、error object、风控、内容审核、配额、可重试性 |
| 计费 | token、图片张数、视频秒数、分辨率、是否带音频、工作流机器时长 |
| 幂等与追踪 | idempotency key、request ID、task ID、operation name、trace ID |
| 能力约束 | 模型级输入组合、数量、格式、大小、时长、地域和版本限制 |

## 4. LLM 主流协议

### 4.1 原生协议族

| 协议族 | 典型入口 | 核心请求结构 | 流式/工具 | 关键差异与插件注意事项 |
| --- | --- | --- | --- | --- |
| OpenAI Chat Completions | `POST /v1/chat/completions` | `model`, `messages[]`, `tools`, `tool_choice`, `response_format` | SSE，`choices[].delta`；工具参数按增量拼接 | 多模态位于 message content parts；旧 `max_tokens` 与新字段并存；兼容网关经常只实现子集 |
| OpenAI Responses | `POST /v1/responses` | `input` 字符串或 items、`instructions`、`tools`、`text` | 事件类型化 SSE；输出为 `output[]` items | 与 Chat Completions 不是字段替换关系；包含 reasoning、computer/tool、file、previous response 等状态语义 |
| Anthropic Messages | `POST /v1/messages` | `system` 独立、`messages[]`、content blocks、`max_tokens` | SSE 事件；`tool_use` / `tool_result` block | `anthropic-version` 必需；assistant/user 角色与工具回填方式不同；图片常用 base64/url source |
| Google Gemini generateContent | `.../models/{model}:generateContent` | `contents[].parts[]`, `systemInstruction`, `generationConfig`, `tools` | `streamGenerateContent`；functionCall/functionResponse | role 使用 `user/model`；文件用 `inlineData/fileData`；思考签名和函数回填不能按 OpenAI tool call 直接搬运 |
| Cohere Chat v2 | `POST /v2/chat` | `messages`, `tools`, `response_format`, documents | SSE 事件 | citation/documents、tool plan 和 OpenAI 结构不同；v1/v2 不能混用 |
| AWS Bedrock Converse | `Converse` / `ConverseStream` | `modelId` 在请求目标，`messages`, `system`, `inferenceConfig`, `toolConfig` | AWS event stream | IAM/SigV4；统一包裹多个模型，但 provider-specific 字段进入 `additionalModelRequestFields` |
| AWS Bedrock InvokeModel | `InvokeModel` / `InvokeModelWithResponseStream` | body 完全由目标模型决定 | 可流式 | 只是传输容器，不是统一内容协议；Anthropic、Titan、Llama 等 payload 各异 |
| Vertex AI Gemini | publisher model generateContent | 与 Gemini 接近，资源名和鉴权是 GCP 风格 | 流式、长操作视能力 | OAuth/IAM、project/location、文件 URI 与 AI Studio 不同 |
| Azure OpenAI | `/openai/deployments/{deployment}/...?...api-version=` 或新统一入口 | 大体遵循 OpenAI，但 model/deployment 和 api-version 规则不同 | SSE | endpoint、deployment、API version、Entra ID；不能假设 OpenAI Base URL 拼接规则 |
| 阿里云 DashScope/Qwen 原生 | `/api/v1/services/aigc/...`、Generation/MultimodalConversation | `input` + `parameters` | SSE/异步视 API | 同一平台同时提供原生协议和 OpenAI-compatible；图片/视频任务使用 `X-DashScope-Async`、task-id |
| 火山方舟 Ark 原生 | `/api/v3/...` | Chat/Responses/图片/contents task 分属不同结构 | SSE、异步任务 | endpoint/model ID、region、签名/Token；Seedance 全模态 content 有 role 语义 |
| 百度智能云千帆 | model/endpoint 路径或兼容入口 | messages 或模型专用 input | SSE | access token/IAM、服务实例 endpoint；不同代际接口并存 |
| 腾讯混元 | 腾讯云 API action/version 或兼容入口 | 云 API 公共参数 + messages/input | 流式/异步 | TC3-HMAC-SHA256 签名；Action/Version/Region 不是普通 REST Base URL |
| MiniMax 文本原生 | `/v1/text/chatcompletion_v2` 等版本化接口 | messages、tokens_to_generate、工具/函数字段随代际变化 | SSE | 海内外域名、旧 GroupId 参数与新版 Bearer 方式并存；另有 Anthropic/OpenAI 兼容入口时不能混认 |
| Ollama | `POST /api/chat`, `/api/generate` | `messages` 或 `prompt`, `options`, `format`, `keep_alive` | 默认 NDJSON | 不是 SSE；本机模型、图片字段、结构化输出和工具支持依版本变化 |

### 4.2 OpenAI-compatible 厂商与网关

以下产品通常暴露 `/v1/chat/completions`，但兼容度需要按能力矩阵验证：

| 厂商/网关 | 主要定位 | 常见扩展或差异 |
| --- | --- | --- |
| xAI Grok | 原生模型 API | 文本高度接近 OpenAI；实时搜索、图片/视频是独立能力和独立参数 |
| DeepSeek | 模型 API | Chat Completions 风格；reasoner 可能返回 `reasoning_content`，上下文续写规则需保留 |
| Mistral | 模型 API | OpenAI 风格但工具、JSON、Fim、OCR/Agents 有独立入口 |
| 月之暗面 Kimi | 模型 API | OpenAI-compatible；长上下文、联网/文件能力随产品入口不同 |
| 智谱 GLM | 模型 API | Chat Completions 风格；`web_search`、thinking、视频/图片有独立异步协议 |
| 百川 | 模型 API | OpenAI 风格子集，模型参数和工具能力需逐模型验证 |
| 零一万物 Yi | 模型 API | OpenAI 风格子集；以实际开放平台版本为准 |
| SiliconFlow | 聚合/推理平台 | Chat、Images、Audio、Rerank 并列；模型来自多个厂商，非文本协议不等于 OpenAI 官方 |
| Together AI | 聚合/推理平台 | Chat/Completions/Images/Embeddings；响应和模型扩展字段不同 |
| Groq | 高速推理平台 | Chat Completions 为主；部分 OpenAI 参数不支持或受模型限制 |
| Fireworks AI | 推理平台 | Chat/Completions/OpenAI-compatible；支持 provider 扩展和部署名 |
| NVIDIA NIM | 模型微服务 | 多数文本 NIM 暴露 OpenAI 风格；视觉、检索、生成模型可能是专用 API |
| OpenRouter | 多厂商路由网关 | `provider`, `transforms`, route、fallback；响应会带 provider/usage 扩展，模型 ID 含厂商前缀 |
| LiteLLM Proxy | 协议翻译网关 | OpenAI 入口转多厂商；支持预算、路由、fallback，但不保证目标厂商全部原生特性可透传 |
| NewAPI/OneAPI | 聚合、计费和协议转换 | 同时可能提供 OpenAI、Claude、Gemini、图片和多种视频入口；版本/渠道配置会改变最终 payload |
| vLLM | 自托管推理服务 | OpenAI-compatible server；支持参数取决于模型模板和启动参数 |
| LocalAI | 自托管兼容服务 | 文本、图片、音频等多能力共域名，但后端实现和字段支持由模型配置决定 |

### 4.3 LLM 不能被抹平的差异

- system 指令可能在 `messages`、独立 `system`、`instructions` 或 `systemInstruction`。
- 内容块命名不同：`text`、`input_text`、`image_url`、`inlineData`、`document`、`tool_use`。
- 工具调用 ID、参数类型、并行工具调用、tool result 回填位置不同。
- 流式不是统一的 `data: {json}`：OpenAI SSE、Anthropic 类型化事件、Gemini JSON/SSE、Ollama NDJSON、AWS event stream 均不同。
- structured output 可能是 `response_format`、`text.format`、`generationConfig.responseSchema` 或模型专用参数。
- reasoning 可能是隐藏计费 token、可见字段、独立 block 或签名数据，不能只抽成普通文本。

## 5. Image 主流协议

| 厂商/协议 | 创建入口与编码 | 参考图/编辑表达 | 返回与生命周期 | 关键差异 |
| --- | --- | --- | --- | --- |
| OpenAI Images | `/v1/images/generations` JSON；`/v1/images/edits` multipart | edit 使用一个或多个 image 文件，可有 mask | 通常同步，URL 或 `b64_json` | generation 与 edit 是两个 transport；尺寸、quality、background、output format 随模型变化 |
| xAI Grok Images | `/v1/images/generations` JSON | 常见 `image` 作为编辑/参考输入 | 同步 URL/base64 风格 | `aspect_ratio`、`resolution` 与 OpenAI `size/quality` 不同；不能只复用 OpenAI Images 字段 |
| Gemini 原生图片生成 | `generateContent` JSON | 图片作为 `inlineData/fileData` part，与 prompt 混排 | candidates.parts 内 inline image | 图片是多模态内容结果，不是 `data[]`；可能同时返回文本与图片 |
| Vertex Imagen | `:predict` / 专用生成接口 | `instances` + `parameters`；编辑/扩图有专用字段 | 同步或长操作视能力 | GCP 资源路径、GCS URI、safety/person generation 配置 |
| 火山方舟 Seedream/图片 | `/api/v3/images/generations` JSON | `image` 可为字符串或数组；连续图有专用配置 | 同步 URL/base64 | `size` 可能接受比例、像素或档位；watermark 和 sequential generation 是扩展字段 |
| 即梦官方图片 | `CVSync2AsyncSubmitTask` + `CVSync2AsyncGetResult` | `image_urls`, `req_key` | 异步 task | AK/SK 签名、提交和查询均 POST；不能套普通 Bearer + GET poll |
| 阿里云通义万相/Wanx | DashScope 图像生成 task | `input.prompt`、参考图 URL、`parameters` | 常见异步 task-id | 需 `X-DashScope-Async: enable`；结果 URL 有有效期 |
| MiniMax Image | MiniMax 图片生成入口 | prompt、reference/image、subject reference 随模型版本 | 同步或异步视接口 | 模型版本字段和参考图能力变化快，应按模型 profile 管理 |
| Kling Image | Kling 开放平台图片任务 | image/reference、strength、negative prompt 等 | 异步 task | access key 签名/JWT、task status、结果数组 |
| 智谱 CogView | `/images/generations` 风格入口 | 部分版本支持 image input/quality/size | 同步或任务式视版本 | OpenAI-like 但模型字段和返回 URL 生命周期不同 |
| 腾讯混元图片 | 腾讯云 Action API | prompt、resolution、style、reference | 异步 task | 云签名、Action/Version；错误码和 task 查询是腾讯云格式 |
| 百度千帆图片 | 千帆图片生成 API | prompt、参考图/控制参数因模型而异 | 同步或异步 | access token/IAM，模型服务路径和审核错误需单独解析 |
| Stability AI | `/v2beta/stable-image/...` 多为 multipart | image、mask、control image、strength | 常见同步二进制或 JSON | endpoint 按 generate/edit/control/upscale 划分；`Accept` 决定输出编码 |
| Black Forest Labs FLUX API | 创建 task JSON | prompt、image、mask、width/height 或比例 | 异步 polling URL | create 返回 task/polling 信息；输出 URL 临时；模型参数差异大 |
| Ideogram | `/v1/ideogram-v3/generate` multipart 等 | image、mask、style/reference | 同步/任务视版本 | magic prompt、rendering speed、style type、color palette 是专用参数 |
| Recraft | `/v1/images/generations`、编辑/矢量专用入口 | image、mask、style id、controls | 同步 URL | 支持 raster/vector；style/substyle 和尺寸枚举不可丢失 |
| Adobe Firefly | Firefly Services 版本化接口 | reference image、mask、structure/style reference | 任务/同步视版本 | Adobe IMS 鉴权、Content Credentials、存储/结果策略 |
| Runway Image | Runway API image endpoint | reference images 常带 tag/URI | 异步 task | 与 Runway video 共用 task lifecycle，但请求 schema 按模型区分 |
| fal.ai Queue | `queue.fal.run/{model}` | schema 由模型定义，URL/base64/file upload | queue submit/status/result | fal 是运行时协议，不是模型协议；每个 endpoint 的 input schema 必须保留 |
| Replicate Predictions | `/v1/predictions` | `version/model` + 任意 `input` | 异步 prediction/webhook | input/output 完全由模型 schema 定义；支持 cancel/webhook，不能硬编码图片字段 |
| ComfyUI | `/prompt` 提交 workflow JSON | 图片先上传，再把文件名映射到节点 input | `/history/{prompt_id}` + `/view` | 请求是节点图，不是固定模型字段；映射目标是 node id + input name |

### 5.1 无稳定公开通用 API 的重要产品

- **Midjourney**：长期没有面向所有开发者的稳定官方通用生成 API；市场上的 `/imagine`、Discord 自动化和第三方 task API 属于不同供应商协议，必须明确来源，不能命名成“Midjourney 官方协议”。
- **部分消费级图片产品**：Leonardo、Krea、即梦 Web、Canva 等可能有合作 API、企业 API 或第三方封装；如果没有公开稳定契约，应标为 provider-specific，不纳入通用字段猜测。

## 6. Video 主流协议

视频协议的核心不是“POST 一个 prompt”，而是**操作语义 + 参考媒体角色 + 异步生命周期**。

| 厂商/协议 | 创建/查询 | 典型请求形态 | 参考素材语义 | 结果与注意事项 |
| --- | --- | --- | --- | --- |
| OpenAI Videos/Sora | `POST /v1/videos`，`GET /v1/videos/{id}`，另有 content/cancel | multipart：model、prompt、seconds、size、`input_reference` | 参考图通常是上传文件；不是 JSON `image_url` | 异步 task；完成后可能需单独下载 content；OpenAI-compatible 网关未必支持 multipart |
| xAI Video | `POST /v1/videos/generations`，`GET /v1/videos/{request_id}` | JSON：model、prompt、duration、aspect_ratio、resolution | 单起始图常用 `image:{url}`；角色参考用 `reference_images:[{url}]` | 首帧与角色参考不能混为一个数组；尾帧支持需按当前官方能力确认 |
| Gemini Veo | `models/{model}:predictLongRunning`，查询 `operations/{name}` | `instances[]` + `parameters` | 常见单图作为 instance.image；不同版本可能有 reference images/last frame 扩展 | Google long-running operation；结果位于嵌套 response，文件需下载/复制 |
| Vertex AI Veo | Vertex publisher model 长操作 | instances/parameters + GCS URI | 首帧、尾帧、参考资产能力按 Veo 版本 | project/location/IAM；与 Gemini Developer API 路径不同 |
| 火山方舟 Seedance | `POST /api/v3/contents/generations/tasks`，GET task | `content[]` 混合 text/image_url/video_url/audio_url，媒体 block 带 `role` | `first_frame`、`last_frame`、`reference_image`、`reference_video`、`reference_audio` | 全模态组合、数量和时长有限制；纯音频组合可能非法；支持 generate_audio/watermark |
| Seedance 兼容 `/videos` | `POST /v1/videos` 或供应商自定义 `/videos` | prompt + `image_url` / `image_urls` / `reference_image_urls` + media arrays | 单主图、首尾帧数组、角色参考数组是不同字段 | 这是网关约定，不等于方舟原生 content 协议；同名 Seedance 模型需选正确 profile |
| 即梦官方视频 | SubmitTask + GetResult，均为签名 JSON | `req_key`, prompt, image_urls, duration/ratio/resolution | 常按图片顺序表达关键帧 | 异步、AK/SK；模型 req_key 决定字段能力 |
| MiniMax/Hailuo H3 | `POST /v2/video_generation`，`GET /v2/query/video_generation/{id}` | `content[]` text/image/video/audio blocks；另有 duration/resolution/ratio/watermark 等 | 图片 block 需 role；首尾帧模式不能与普通 reference_image 混用 | H3 是全模态视频协议，不应退化为 `image_urls[0/1]`；中转可能改字段名或再包一层 |
| 阿里 Wan/通义万相视频 | DashScope video synthesis task | `model`, `input`, `parameters`；image_url/first_frame/last_frame 随模型 | 文生、图生、首尾帧、参考视频需按 Wan 版本区分 | 常用异步 header、task-id 查询；Wan 3.x 仍应按官方当前模型 schema 建 profile，不以“Wan3”推断协议 |
| Kling Video | 创建 video task + 查询 task | text2video/image2video/multi-image 等独立 endpoint/schema | image、tail image、elements/subject、motion brush 等 | 模型版本和模式决定字段；JWT/签名；结果 URL 和 task status |
| Agnes Video 2.5 | `POST /v1/videos`，`GET /agnesapi?video_id=...&model_name=...` | JSON，`mode=text|keyframe|reference`；seconds 是字符串；size 是档位 | keyframe 使用 first_frame/last_frame；reference 使用 images/videos/audios | 2.5、2.5 Flash、V2.0 是同厂商不同协议 profile；Flash 限制更严格 |
| Agnes Video V2.0 | `POST /v1/videos` + Agnes 查询 | image 或 `extra_body.image`、mode/num_frames/frame_rate | 关键帧数组，无角色/风格参考模式 | duration 需换算帧数；不能照搬 2.5 的 seconds/size/aspect_ratio |
| Runway | `/v1/...` 创建，task 查询/取消 | 模型专用 JSON，promptImage/promptText、ratio/duration | 首帧、尾帧、references 按 generation 类型 | 标准异步 task；状态、失败原因和 output URL 统一程度较高 |
| Luma Dream Machine | `/dream-machine/v1/generations` 等 | prompt、model、keyframes 对象 | `frame0/frame1` 等 keyframes，可扩展图像/视频 | 异步 generation；状态和 assets 嵌套 |
| Vidu | Vidu 开放平台 task API | text2video/image2video/reference2video | reference images、first frame、subject consistency | 异步；不同模型/模板参数独立 |
| PixVerse | 平台 video generation task | prompt、model、duration/quality、image | image-to-video、transition/effects 等 | 异步；模板/effect 字段不能塞入全局标准字段 |
| Pika | 官方/合作 API 或聚合平台 endpoint | 依接入渠道而异 | image/video/reference/effect | 市面常见的是 fal/Replicate/第三方协议；必须记录实际 provider，不应假称统一 Pika 原生协议 |
| 智谱 CogVideoX | 视频生成 task API | model、prompt、image_url、quality/with_audio 等 | 常见单图图生视频 | 异步 task；字段以开放平台当前版本为准 |
| 腾讯混元视频 | 腾讯云 Action task | 云 API 参数 + prompt/image | 图生/首帧等按 Action | TC3 签名，创建和查询 Action 分离 |
| 百度视频生成 | 千帆/智能云对应模型 task | 模型专用 input | 参考图/视频按模型 | 异步、审核和错误码需单独适配 |
| Novita Video | `/v3/video/create`，`/v3/async/task-result` | `model_name`, prompt, duration, aspect_ratio, image_url | 常见单起始图 | 适合作为简单异步协议，不等于支持角色参考 |
| NewAPI Channel 1 媒体任务 | `POST /v1/videos`，GET `/v1/videos/{id}` | `{model,input:{prompt,media[]},parameters:{...}}` | `media[].type` 表达 first_frame/last_frame/reference_image/reference_video/reference_voice | 是 NewAPI 的统一媒体包装之一，不是 OpenAI Videos |
| NewAPI Channel 2 Video Generations | `POST /v1/video/generations`，GET 同路径 task | 扁平 JSON：seconds、aspect_ratio、resolution、image_urls/video_urls/audio_urls | 常以数组和顺序表达，role 能力取决于具体版本 | 与 Channel 1 不兼容；同一 NewAPI 部署可能因版本或渠道插件行为不同 |
| fal.ai Queue | submit/status/result | 每个模型自定义 schema | 由模型 endpoint schema 决定 | queue runtime 统一，模型请求不统一 |
| Replicate Predictions | predictions + webhook/cancel | 任意 model input | 由模型版本 schema 决定 | 可统一生命周期，不能统一字段名 |
| ComfyUI | `/prompt`, `/history`, `/view` | 完整 workflow graph | 素材上传后映射节点 input；首尾帧取决于 workflow | 插件应映射工作流 schema，不应伪装成固定视频 provider |
| RunningHub/AutoDL 工作流 | workflow/app task create + query | workflow ID + node/input override | 由工作流字段发现结果决定 | 需要字段发现、可覆盖性、安全上传、工作流版本，不是普通 REST 字段映射 |

## 7. 参考素材语义：必须成为通用底座的一等公民

### 7.1 建议保留的角色词汇

| kind | role 示例 | 说明 |
| --- | --- | --- |
| image | `first_frame` | 视频起始关键帧 |
| image | `last_frame` | 视频结束关键帧 |
| image | `reference_image` | 泛化角色/主体/风格参考，不能自动当首帧 |
| image | `subject_reference` | 主体一致性参考；有些协议还需要 subject id/type |
| image | `style_reference` | 风格参考，可能带 weight |
| image | `edit_source` | 图片编辑原图 |
| image | `mask` | 编辑蒙版，与普通 reference 不同 |
| image | `control` | pose/depth/canny/layout 等控制图 |
| video | `reference_video` | 动作、镜头、风格或重绘参考 |
| video | `motion_reference` | 明确的运动参考 |
| audio | `reference_audio` | 音乐/环境/节奏参考 |
| audio | `reference_voice` | 音色/说话人参考 |

建议媒体项至少具备：

```json
{
  "id": "canvas-node-or-resource-id",
  "kind": "image",
  "role": "first_frame",
  "source": {
    "type": "resource|url|data|file",
    "value": "...",
    "mimeType": "image/png"
  },
  "order": 0,
  "label": "可选的人类可读名称",
  "weight": 1,
  "metadata": {}
}
```

### 7.2 为什么 `0`、`1` 编号无法承担语义

- 单图 + `image_to_video` 时，`0` 通常是首帧。
- 单图 + `reference_to_video` 时，`0` 是角色/风格参考，不能发送到 `first_frame`。
- 两图可能是首尾帧，也可能是两个角色参考，也可能是编辑原图 + 风格图。
- 加入参考视频/音频后，图片通常自动变成 reference，而不是 frame。
- 用户在画布重连或排序后，下标可能变化；节点 ID 和显式 role 才是稳定语义。
- 有些上游要求 prompt 内使用 `@Image1`、`image_0` 或其他占位符；这是 provider 渲染规则，不应污染通用请求。

因此通用层应保存 `order`，插件应消费 `role`；只有协议明确以顺序定义首尾帧时，插件才把 role 排序后生成数组。

## 8. 影策当前实现审计

### 8.1 已有的正确基础

后端 `backend/internal/protocol/types.go` 已定义：

- `GenerationRequest`：model、prompt、images、videos、audios、duration、aspectRatio、resolution、quality、generateAudio、watermark、imageCount、operation、extra；
- `MediaReference`：id、url、dataUrl、kind、role、ephemeral；
- `RequestSpec`、`CreateResult`、`PollResult`、统一 status/result；
- provider registry 和内置 adapter；
- 声明式插件 create/poll/cancel/response path mapping。

这说明不需要从零创建“统一请求”，而是需要补齐语义和插件执行能力。

### 8.2 声明式插件的关键缺口

#### 缺口 A：`role` 和 `id` 在插件视图中丢失

`MediaReference` 本身有 `ID`、`Role`，但 `manifestMediaValues()` 只暴露：

```text
url, dataUrl, kind, ephemeral
```

因此插件无法读取：

```text
request.images.0.role
request.images.0.id
```

只能固定读取：

```text
request.images.0.url
request.images.1.url
```

这正是“画布参考图带 0/1 编号后无法直接插件映射”的结构性根因之一。

#### 缺口 B：不能动态遍历或按 role 过滤

当前 `fields` 是“目标 path -> 单一表达式”，支持固定路径和少量字符串变换，不支持：

- `map(request.images, ...)`；
- `filter(role == first_frame)`；
- `first(role == last_frame)`；
- 根据 operation/model 选择完全不同的 body；
- 动态生成 `content[]` block；
- 把同一数组分别映射为 `first_frame`、`last_frame`、`reference_images`。

#### 缺口 C：声明式 runtime 只允许 JSON body

`executeProtocolRequest()` 对非 `application/json` 直接报错，因此以下协议不能仅靠当前声明式插件实现：

- OpenAI Images edits multipart；
- OpenAI Videos multipart `input_reference`；
- Stability/Ideogram 等 multipart 图片 API；
- 需要直接上传二进制或文件 part 的协议。

#### 缺口 D：transport 和解析表达能力不足

当前还不能完整声明：

- 自定义 query/header/body 签名和 AK/SK；
- SSE、NDJSON、AWS event stream；
- 上传文件 -> 获得 file id -> 创建任务的多阶段流程；
- webhook、幂等 header、Retry-After；
- cancel 的 body/query 变体；
- 完成后再请求 content/download endpoint；
- 状态码到 retryable/permanent/moderation/quota 的错误分类；
- 临时 URL 有效期和需要平台代理下载的结果。

### 8.3 当前 role 传递还存在的边界

- 前端 `resolveVideoImageReferences()` 在旧创作路径中会按数量推断：单图首帧、双图首尾帧、其余参考图。
- 后端 `protocolVideoImageReferences()` 主要依赖 `videoStartFrameNodeId`、`videoEndFrameNodeId` 和 `videoEditOperation`；没有显式 metadata 时 role 可能为空。
- 即使后端 request 中 role 正确，声明式 manifest projection 仍会把 role 丢掉。

后续应明确：**role 在画布/任务创建阶段确定；协议插件只能转换，不应重新猜业务语义。**

## 9. MiniMax H3 / 中转参数问题专项

### 9.1 当前前端旧直连 payload

`web/src/services/api/video-provider-minimax.ts` 当前构造：

```json
{
  "model": "...",
  "content": [
    { "type": "text", "text": "..." },
    { "type": "image_url", "image_url": { "url": "..." }, "role": "first_frame|last_frame|reference_image" }
  ],
  "resolution": "768P|2K",
  "duration": 4,
  "ratio": "adaptive|16:9|...",
  "aigc_watermark": false
}
```

并且有以下前端约束：

- 图片最多取 9 张、视频 3 个、音频 3 个；
- duration 归一到 4-15 秒；
- 首尾帧模式比例强制 `adaptive`；
- 首尾帧模式禁止混入普通 `reference_image`；
- 本地素材转换为 data URL 或要求公网 URL。

### 9.2 当前后端内置 MiniMax adapter

`backend/internal/protocol/builtin.go` 当前构造：

```json
{
  "model": "...",
  "prompt": "...",
  "duration": 6,
  "content": [
    { "type": "text", "text": "..." },
    { "type": "image_url", "image_url": { "url": "..." }, "role": "..." }
  ]
}
```

它只从 `Extra` 合并 `resolution` 和 `aspect_ratio`，但 `protocolRequestFromInput()` 把比例和分辨率放在 `GenerationRequest.AspectRatio/Resolution`，没有放入 `Extra`。因此当前后端路径存在以下风险：

1. `Resolution` 没有实际写入 MiniMax body；
2. `AspectRatio` 没有实际写入 body；
3. 字段候选写成 `aspect_ratio`，而旧直连使用 `ratio`；
4. `aigc_watermark` 没有映射；
5. `GenerateAudio` 没有映射；
6. 前端已有的数量、组合、duration、frame mode 校验没有在后端 adapter 等价实现；
7. 后端额外同时发送顶层 `prompt` 和 content text，是否被目标中转接受取决于中转实现。

### 9.3 通过 NewAPI/其他中转时的第二层差异

MiniMax H3 可能出现至少三种入口：

1. MiniMax 原生 `/v2/video_generation` content blocks；
2. NewAPI Channel 1：`input.media[] + parameters`；
3. NewAPI Channel 2：`image_urls/video_urls/audio_urls + seconds/aspect_ratio/resolution`；
4. 中转商自定义“OpenAI video”入口：`/v1/videos` multipart 或 JSON；
5. fal/Replicate 模型 endpoint：完全由该 endpoint schema 决定。

因此“模型是 MiniMax H3”不能决定协议。正确选择键应至少是：

```text
provider protocol profile + model capability profile + operation
```

而不是：

```text
if model name contains minimax/h3
```

## 10. 后续通用请求标准底座必须具备的能力

本节只列设计约束，不在本文冻结最终 JSON Schema。

### 10.1 通用请求层

- 显式 `capability` 与 `operation`；
- 多模态 `inputs[]`，每项保存 kind、role、source、mime、order、metadata；
- 输出配置按语义拆开：aspect ratio、pixel size、resolution tier、duration、fps、count、quality；
- `providerOptions` 必须命名空间化，例如 `providerOptions.minimax`，避免任意 `Extra` 污染公共字段；
- 模型 capability profile 声明输入组合、数量、格式、范围和默认值；
- 不在通用层把 `720P`、`1280x720`、`16:9` 混成同一个 `size` 字符串。

### 10.2 provider 插件映射层

至少需要安全的声明式能力：

- 对象、数组、常量构造；
- `map/filter/find/first/count/sortByRole`；
- `if/switch/coalesce`；
- 枚举、大小写、数值、秒/帧、比例/像素/档位转换；
- 按 model/operation/capability profile 分支；
- JSON、multipart、form-urlencoded、binary；
- path/query/header/body 模板；
- 文件上传和临时公网 URL 策略；
- create/poll/cancel/download 多阶段 workflow；
- SSE/NDJSON/event-stream parser；
- response path + 状态映射 + 错误分类；
- webhook、幂等和重试策略；
- secret 字段隔离与日志脱敏。

### 10.3 插件不应负责的事项

- 不应从图片数量猜首尾帧业务意图；
- 不应访问浏览器中的第三方密钥；
- 不应把本地 blob URL直接发给远端；
- 不应绕过后端任务、计费、配额、取消和审计生命周期；
- 不应为适配某厂商修改全局通用字段语义。

## 11. 建议的插件拆分方式

插件应按“线协议 profile”拆分，而不是按营销品牌笼统拆分：

| 推荐插件 ID 示例 | 覆盖范围 |
| --- | --- |
| `openai-chat-completions` | OpenAI Chat 线协议及严格兼容网关 |
| `openai-responses` | Responses 事件和 item 协议 |
| `anthropic-messages` | Claude Messages/tool/SSE |
| `google-gemini-generate-content` | Gemini contents/parts/functions |
| `openai-images` | generations + multipart edits |
| `google-gemini-image` | generateContent 图片输入输出 |
| `openai-videos` | multipart create/task/content/cancel |
| `xai-video` | xAI JSON video + reference_images |
| `volcengine-ark-seedance` | Ark contents task + multimodal roles |
| `minimax-hailuo-video-v2` | MiniMax `/v2/video_generation` |
| `dashscope-wan-video` | DashScope async Wan task |
| `newapi-media-task-v1` | NewAPI Channel 1 包装 |
| `newapi-video-generations-v1` | NewAPI Channel 2 包装 |
| `agnes-video-25` | 2.5/Flash profile |
| `agnes-video-v20` | frame-based V2.0 profile |
| `replicate-prediction` | prediction lifecycle + model schema |
| `fal-queue` | queue lifecycle + endpoint schema |
| `comfyui-workflow` | workflow graph/upload/history/view |

一个安装包可以贡献多个 provider profile，但运行时必须能区分每个 profile 的 endpoint、transport、能力和模型约束。

## 12. 后续设计与验收清单

### P0：先消除当前阻塞

- [ ] 声明式插件暴露 media `id`、`role`、`mimeType`、`metadata`；
- [ ] 支持按 role 选取首帧、尾帧和 reference 数组；
- [ ] 修正后端 MiniMax H3 的 resolution、ratio、watermark 和校验映射；
- [ ] 为 MiniMax 原生、NewAPI Channel 1、Channel 2 分别建独立 profile；
- [ ] 加入 payload snapshot 测试，覆盖 0/1/多图、首尾帧、角色参考、图+音视频组合。

### P1：通用插件底座

- [ ] JSON 数组/对象构造和条件表达式；
- [ ] multipart 与文件 part；
- [ ] create/poll/cancel/download 工作流；
- [ ] 状态和错误分类；
- [ ] provider capability profile 和参数 UI schema；
- [ ] 统一 conformance fixture：请求输入 -> 期望上游 payload -> 上游响应 -> 统一结果。

### P2：主流协议插件化

- [ ] LLM：OpenAI Chat、Responses、Anthropic、Gemini；
- [ ] Image：OpenAI、Gemini、Ark/Seedream、Stability、FLUX；
- [ ] Video：OpenAI、xAI、Veo、Seedance、MiniMax、Wan、Kling、Agnes、Runway；
- [ ] Gateway：NewAPI、LiteLLM/OpenRouter 类兼容入口；
- [ ] Workflow：ComfyUI、RunningHub/AutoDL。

## 13. 官方与一手资料入口

以下链接用于继续核对当前版本。部分官方站点为 JavaScript 文档或需要登录，字段上线后仍应以实际账号下的最新 API Reference、OpenAPI schema 和真实响应 fixture 为准。

### LLM

- OpenAI API Reference: <https://platform.openai.com/docs/api-reference>
- Anthropic Messages API: <https://docs.anthropic.com/en/api/messages>
- Gemini API: <https://ai.google.dev/api>
- xAI Docs: <https://docs.x.ai/>
- Cohere v2 Chat: <https://docs.cohere.com/v2/reference/chat>
- Mistral API: <https://docs.mistral.ai/api/>
- DeepSeek API: <https://api-docs.deepseek.com/>
- AWS Bedrock Runtime: <https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html>
- Azure OpenAI: <https://learn.microsoft.com/azure/ai-services/openai/reference>
- Vertex AI generative AI: <https://cloud.google.com/vertex-ai/generative-ai/docs>
- DashScope/Model Studio: <https://help.aliyun.com/zh/model-studio/>
- 火山方舟: <https://www.volcengine.com/docs/82379>
- Ollama API: <https://docs.ollama.com/api/introduction>
- vLLM OpenAI-compatible server: <https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html>
- LiteLLM Proxy: <https://docs.litellm.ai/docs/proxy/openai_compatible>
- OpenRouter API: <https://openrouter.ai/docs/api/reference/overview>
- NewAPI: <https://docs.newapi.ai/zh/docs>

### Image

- OpenAI Images: <https://platform.openai.com/docs/api-reference/images>
- Gemini image generation: <https://ai.google.dev/gemini-api/docs/image-generation>
- Stability API: <https://platform.stability.ai/docs/api-reference>
- Black Forest Labs API: <https://docs.bfl.ai/>
- Ideogram API: <https://developer.ideogram.ai/api-reference>
- Recraft API: <https://www.recraft.ai/docs/api-reference>
- Adobe Firefly Services: <https://developer.adobe.com/firefly-services/docs/firefly-api/>
- Replicate HTTP API: <https://replicate.com/docs/reference/http>
- fal model APIs: <https://docs.fal.ai/model-apis>

### Video / Workflow

- OpenAI Videos: <https://platform.openai.com/docs/api-reference/videos>
- Gemini/Veo video generation: <https://ai.google.dev/gemini-api/docs/video>
- Seedance 产品与能力: <https://seed.bytedance.com/zh/seedance2_0>
- MiniMax API Platform: <https://platform.minimaxi.com/>
- Wan: <https://wan.video/>
- Runway API: <https://docs.dev.runwayml.com/api/>
- Luma API: <https://docs.lumalabs.ai/docs/video-generation>
- Agnes Docs: <https://wiki.agnes-ai.com/>
- ComfyUI API: <https://docs.comfy.org/development/core-concepts/api>
- NewAPI source: <https://github.com/QuantumNous/new-api>

## 14. 本仓库一手证据

- `backend/internal/protocol/types.go`：当前统一请求、媒体 role、任务结果合同；
- `backend/internal/protocol/manifest.go`：声明式字段映射、固定数组路径、media projection 和 JSON-only runtime；
- `backend/internal/protocol/builtin.go`：现有 OpenAI/Claude/Gemini/图片/视频内置 adapter；
- `backend/internal/service/provider.go`：画布任务到 `GenerationRequest` 的转换和 role 解析；
- `web/src/services/api/video-reference-roles.ts`：前端首帧、尾帧、参考图角色推断；
- `web/src/services/api/video-provider-minimax.ts`：前端旧 MiniMax 直连 payload；
- `web/src/services/api/video-provider-seedance.ts`：Seedance 两类入口及全模态素材映射；
- `web/src/services/api/video-provider-agnes.ts`：Agnes 版本分支；
- `web/src/pages/plugins/plugin-development-guide.md`：当前插件字段表达能力说明。

## 15. 调查结论

- **现状是：** 影策已有统一任务生命周期和初版 `GenerationRequest`，内置 adapter 能处理一部分复杂协议；上传的声明式插件仍主要是固定 JSON path 映射。
- **关键约束是：** 协议兼容的难点集中在媒体 role、动态数组、条件结构、transport、异步生命周期和模型级能力，不是 endpoint 和字段改名。
- **此前不明显但现在确认的是：** `MediaReference.Role` 已存在，却在 manifest projection 中丢失；MiniMax 后端 adapter 与前端旧直连 payload 也存在实质差异。
- **基于以上，判断是：** 下一阶段应先升级通用请求和插件执行底座，再批量制作主流 provider 插件；如果直接继续新增固定 `fields` 映射，会不断把协议差异硬编码进宿主，并重复出现参考图编号和 H3 参数问题。
