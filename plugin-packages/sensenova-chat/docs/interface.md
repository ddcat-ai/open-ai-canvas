# SenseNova Chat 接口字段

## 协议身份

- 插件 ID：`sensenova-chat`。
- Provider ID：`sensenova-chat`。
- 能力：`text`。
- 默认 Base URL：`https://token.sensenova.cn/v1`。
- 鉴权驱动：`bearer`。
- 创建：`POST /chat/completions`。
- Agent：`POST /chat/completions`。
- 生命周期：同步响应。

## 模型与参数边界

| 精确 Model ID | 输出字段及文档上限 | 思考 | 视觉输入 | 响应推理主字段 |
| --- | --- | --- | --- | --- |
| `sensenova-6.8-flash` | `max_tokens`，1–131072 | 不可关闭；minimal/low/medium/high/xhigh/max；默认 high | HTTP(S) 图片 URL / Data URL；JPEG/PNG/WebP | `reasoning` |
| `sensenova-6.8-flash-lite` | `max_tokens`，1–65536 | 可关闭；low/medium/high/max；默认 high | HTTP(S) 图片 URL / Data URL；JPEG/PNG/WebP | `reasoning` |
| `deepseek-flash` | `max_tokens`，1–393216 | 可关闭；原生 low/high/max；默认 high | HTTP(S) 图片 URL / Data URL；JPEG/PNG/GIF/WebP | `reasoning_content` |
| `glm-5.3` | `max_tokens`，1–131072 | 不可关闭；low/high/max；默认 max | 仅文本 | `reasoning_content` |
| `kimi-k3` | `max_completion_tokens`；最大为 1048576 - prompt_tokens | 关闭用 thinking.type=disabled；low/medium/high/max；显式默认 max | 仅 Base64 Data URL；JPEG/PNG/WebP/GIF/BMP/HEIC/HEIF | `reasoning_content` |

模型 ID 采用精确白名单，不把其他版本或未声明模型自动视为兼容。Flash 上下文文档给出 1048576；Flash Lite 硬上下文上限未给出，不以 OpenCode 客户端配置替代硬能力。其他 1M 描述与 Kimi 动态剩余上下文由模型能力配置和上游决定，插件不估算 tokenizer。Kimi 本地仅校验输出为正整数且不超过总窗口 1048576，这不是固定最大输出的承诺。

## 请求字段

普通 create 请求从统一 `model/messages/instructions/images` 和 `request.extra.max_tokens` 取值；可调字段从 `providerOptions.sensenova-chat` 命名空间取值。宿主已解析的模型/任务思考策略只通过 `request.extra.thinking` 与 `request.extra.reasoning_effort` 两个白名单字段优先覆盖命名空间相同字段，再进行统一校验/采样规整；`request.extra.stream` 的实际布尔值同样优先。Agent 输入来自宿主已预置实际输出/思考/流式策略的 `request.extra.agent.chatCompletion`，随后再次经过同一模型规则。两条路径共用声明式 `requestBindings` 与 `validations`。

| 字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 五个精确文本模型 ID；不允许未声明模型。 |
| `messages` | message[] | 是 | `messages` | 统一历史与当前输入；图片仅 user，Kimi 须 Data URL，GLM 仅文本。 |
| `instructions` | string | 否 | `messages[].content` | 统一系统指令由宿主注入 system 消息。 |
| `max_tokens` | integer | 否 | `max_tokens / max_completion_tokens` | 统一输出上限按模型映射；Kimi 扩展配置使用 max_completion_tokens。 |
| `max_completion_tokens` | integer | 否 | `max_completion_tokens` | 仅 Kimi K3；不能与 max_tokens 同时配置。 |
| `thinking` | object | 否 | `thinking` | enabled/disabled；Flash/GLM 不可关闭，GLM 可配置 clear_thinking。 |
| `reasoning_effort` | string | 否 | `reasoning_effort` | 按型号校验档位；DeepSeek 兼容档位归一；关闭用 thinking.type。 |
| `temperature` | number | 否 | `temperature` | Flash/GLM [0,1]，Lite/DeepSeek [0,2]，Kimi 固定 1；不生效的模型模式不发送。 |
| `top_p` | number | 否 | `top_p` | (0,1]；GLM 至少 0.01，Kimi 固定 0.95；DeepSeek 按思考模式规整。 |
| `tools` | array | 否 | `tools` | Function Calling 声明；parameters 是工具 JSON Schema；GLM 最多 128 项。 |
| `tool_choice` | object|string | 否 | `tool_choice` | auto/none/required 或指定函数；GLM 仅字符串。 |
| `parallel_tool_calls` | boolean | 否 | `parallel_tool_calls` | 仅 Lite/Kimi；其他型号的 Agent 宿主固定 false 不发送。 |
| `response_format` | object | 否 | `response_format` | json_object；text 仅 DeepSeek/GLM；json_schema 仅 DeepSeek，严格子集未核验。 |
| `stream` | boolean | 否 | `stream` | Chat SSE；宿主可强制开启流式。 |
| `stream_options` | object | 否 | `stream_options` | 非 GLM 流式固定 include_usage=true 用于本地结算；显式 false 拒绝，GLM 不发送。 |
| `do_sample` | boolean | 否 | `do_sample` | 仅 GLM；false 时不发送 temperature/top_p。 |
| `tool_stream` | boolean | 否 | `tool_stream` | 仅 GLM；流式且含 tools 时强制 true。 |
| `n` | integer | 否 | `n` | Flash/Lite 1–7；GLM 1–4；DeepSeek 仅 1；Kimi 未声明。 |
| `stop` | string|array | 否 | `stop` | GLM 仅数组且最多 4 项；DeepSeek 最多 16 项。 |
| `presence_penalty` | number | 否 | `presence_penalty` | SenseNova [0,2]；DeepSeek [-2,2]且思考下不发送；Kimi 固定 0；GLM 未声明。 |
| `frequency_penalty` | number | 否 | `frequency_penalty` | SenseNova [0,2]；DeepSeek [-2,2]且思考下不发送；Kimi 固定 0；GLM 未声明。 |
| `repetition_penalty` | number | 否 | `repetition_penalty` | 仅 SenseNova 6.8 Flash，[1,2]。 |
| `seed` | integer | 否 | `seed` | 仅 Flash/Lite/Kimi，[0,9999999)；不承诺确定复现。 |
| `logprobs` | boolean | 否 | `logprobs` | 仅 DeepSeek。 |
| `top_logprobs` | integer | 否 | `top_logprobs` | 仅 DeepSeek，[0,20] 且 logprobs=true。 |

### 写入、校验与省略规则

- 不合并任意 `body`、`extra_body`、`provider`、`transforms` 或未声明厂商字段。命名空间未知顶层键会报错；消息、工具和请求体只显式映射已知字段。函数 `parameters` 是业务自定义 JSON Schema，不是修改请求体的旁路。
- 统一输出上限优先于扩展值。Kimi 的统一上限及 Agent 规范化 `max_tokens` 转为 `max_completion_tokens`；Kimi create 扩展仅接受 `max_completion_tokens`，不承诺上游 `max_tokens` 别名有效。其他模型拒绝 `max_completion_tokens`；同时指定两字段失败。
- 最终生效策略显式关闭 Flash/GLM 失败；可关闭模型以 `thinking.type=disabled` 关闭，关闭时不发送 effort；关闭与非 none effort 冲突失败。宿主模型/任务思考策略优先于 providerOptions，不能依赖后置覆盖去改变已完成的 DeepSeek 采样规整。Kimi 的 `reasoning_effort=none` 文档矛盾，本版拒绝。宿主统一 UI 不含独立 xhigh 档，本插件只在原始参数/档位映射中接受 Flash 的 xhigh，不宣称新增了 UI 滑块。
- DeepSeek 兼容 effort：minimal→low，medium/xhigh→high，ultra→max。思考开启时不发送不生效的 temperature / presence_penalty / frequency_penalty；top_p 小于 0.95 时提升为 0.95。非思考下显式 top_p 规范为固定 1。
- Kimi temperature/top_p 固定 1/0.95，presence/frequency 固定 0，其他值失败；GLM `do_sample=false` 时不发送 temperature/top_p。
- GLM 工具流请求在映射前实际 `stream=true` 且包含 tools 时强制 `tool_stream=true`。本协议禁止宿主渲染后再改变 stream 或注入 stream_options；GLM 没有声明 stream_options，完全不发送该字段，但仍可读取上游 usage 响应。
- 非 GLM 在 stream=true 时由最终映射默认设置 `stream_options.include_usage=true`。显式 false 会失败，这是影策本地流式结算约束；平台部分型号原生允许关闭末包用量，不等于本地协议允许关闭。stream=false 不发送 stream_options，不依赖宿主后置补值。
- `parallel_tool_calls` 仅 Lite/Kimi 映射。宿主 canonical Agent 输入固定附带的 false 可在其他模型上输入但不发送；宿主 prompt_cache_key 同样不发送，不表示上游支持缓存控制。
- DeepSeek 只接受 `n=1`；Kimi 未声明 n，拒绝该字段。GLM stop 必须数组且最多 4 项，DeepSeek 最多 16 项；其他 stop 项数缺文档，不虚构更小上限。
- seed 的 Beta 复现性不能保证；GLM 未声明 seed 或 presence/frequency，DeepSeek 未声明 seed，均拒绝。
- 图片内容块为 `{"type":"image_url","image_url":{"url":"..."}}`；图片只能出现在 user 消息。禁止未知媒体、视频/音频，禁止 GLM 图片，禁止 Kimi 远程图片 URL。Data URL 检查 MIME 与非空合法 Base64 格式。HTTP(S) URL 的访问、安全校验和持久化仍由宿主管理；插件不下载媒体。
- Flash/Lite/Kimi 图片张数、字节、像素上限缺完整文档；远程 URL 的真实 MIME / 字节边界需宿主取到媒体后校验，不能仅靠 URL 推断。DeepSeek 文档给出单图最多 50MB、总请求体最多 64MB、单请求最多 200 图、URL 图片总大小最多 200MB；这些仍需宿主媒体能力校验，不能由协议映射代替。
- `response_format` 只显式映射文档支持的 type：所有模型可 json_object；text 仅 DeepSeek/GLM；json_schema 仅 DeepSeek，需非空 json_schema 对象。其 strict 语义和 JSON Schema 子集未文档化，本版只保留开放 schema，不承诺严格输出。Flash Lite/Kimi 不建议 JSON 与思考同时开启；不会因此静默关闭思考。
- JSON 正文需要业务校验；length 截断和 content_filter 不能当作已完成的结构化结果。

## 工具与历史消息

Agent 将 role/content、tool_calls[].id/type/function.name/function.arguments、tool 消息 tool_call_id 映射到标准 Chat 格式。工具定义只映射 type/function.name/function.description/function.parameters。GLM 工具最多 128 项，函数名为 1–64 个字母/数字/下划线/连字符，description 与 parameters 必填；其 tool_choice 只接受 auto/none/required。

历史 assistant 的推理在宿主统一保存为 reasoning_content；插件对 Flash/Lite 转成 `reasoning`，DeepSeek/GLM/Kimi 映射成 `reasoning_content`，两种输入别名均能读取，不裁剪非空推理。DeepSeek 携带 tools 时必须保留所有历史推理；宿主负责保存、完整回传、真实 tool_call_id 关联及权限。Kimi 文档对完整 assistant 回传与省略推理有矛盾，本版保留规范化助手内容/工具/推理，实际历史规则仍待官方澄清与授权冒烟。插件返回工具调用不代表已执行工具，也不新增外部能力或自治运行环境。

## 响应映射

| 统一结果 | 上游来源 |
| --- | --- |
| text | choices.0.message.content |
| reasoning | choices.0.message.reasoning，缺失时 choices.0.message.reasoning_content |
| usage | 顶层 usage，原样保留，包括 prompt/completion/total 与 details |
| Agent 工具 | choices.0.message.tool_calls，提取 id/function.name/function.arguments |
| 错误 | 非空 error 对象（含 code/message）；HTTP 错误由宿主保持失败 |

SSE 对应 delta.content、delta.reasoning 或 delta.reasoning_content、delta.tool_calls，结束标记为 data: [DONE]。usage 无 choices 的尾帧仍由宿主采集。reasoning_tokens 已包含在 completion_tokens 内，cached_tokens 是 prompt 细项，均不得重复相加。Agent 用量由宿主传输/日志统一采集；Agent 映射接口本身不新增第二套计量。

finish_reason 的 stop/length/tool_calls/content_filter 具有不同业务语义：length 未完成、tool_calls 等待宿主、filter 为拦截。宿主流式终止与失败判定须保留该差异，不能只因出现终止帧就伪称结果完成。

create 响应映射明确将 `length` / `content_filter` 设为 failed，分别提示输出 Token/上下文上限截断与安全过滤；即使 HTTP 2xx 且存在部分正文也不表示成功。其他正常结束仍按正文/工具合同处理，Agent 与 SSE 由宿主共享解析器执行同样的终态判定。

## 本地验证与证据范围

专项测试位于 `backend/internal/protocol/sensenova_text_test.go`：从实际源 manifest 加载，检查五模型、请求字段、媒体、历史推理、拒绝未声明参数、最终用量参数与截断/过滤响应；不访问公网，不需要密钥。官方包目录测试会检查包内 README / docs / manifest 一致。宿主集成须另测 SSE 增量、before_mapping 顺序、GLM tool_stream 与无 stream_options、Kimi 最终预算字段、工具选择不被通用兼容规整覆盖、usage 与取消。

公开文档来源：

- [SenseNova 6.8 Flash](https://platform.sensenova.cn/docs#model-sensenova-68-flash)
- [SenseNova 6.8 Flash Lite](https://platform.sensenova.cn/docs#model-flash)
- [DeepSeek V4.1 Flash](https://platform.sensenova.cn/docs#model-deepseek-flash)
- [GLM-5.3](https://platform.sensenova.cn/docs#model-glm-5-3)
- [Kimi K3](https://platform.sensenova.cn/docs#model-kimi-k3)

依据公开文档快照和本地构造验证；没有调用真实模型 API，没有验证生成效果、性能、计费或在线全量模型目录。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |


## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 五个精确文本模型 ID；不允许未声明模型。 |
| `messages` | message[] | 是 | `messages` | 统一历史与当前输入；图片仅 user，Kimi 须 Data URL，GLM 仅文本。 |
| `instructions` | string | 否 | `messages[].content` | 统一系统指令由宿主注入 system 消息。 |
| `max_tokens` | integer | 否 | `max_tokens / max_completion_tokens` | 统一输出上限按模型映射；Kimi 扩展配置使用 max_completion_tokens。 |
| `max_completion_tokens` | integer | 否 | `max_completion_tokens` | 仅 Kimi K3；不能与 max_tokens 同时配置。 |
| `thinking` | object | 否 | `thinking` | enabled/disabled；Flash/GLM 不可关闭，GLM 可配置 clear_thinking。 |
| `reasoning_effort` | string | 否 | `reasoning_effort` | 按型号校验档位；DeepSeek 兼容档位归一；关闭用 thinking.type。 |
| `temperature` | number | 否 | `temperature` | Flash/GLM [0,1]，Lite/DeepSeek [0,2]，Kimi 固定 1；不生效的模型模式不发送。 |
| `top_p` | number | 否 | `top_p` | (0,1]；GLM 至少 0.01，Kimi 固定 0.95；DeepSeek 按思考模式规整。 |
| `tools` | array | 否 | `tools` | Function Calling 声明；parameters 是工具 JSON Schema；GLM 最多 128 项。 |
| `tool_choice` | object|string | 否 | `tool_choice` | auto/none/required 或指定函数；GLM 仅字符串。 |
| `parallel_tool_calls` | boolean | 否 | `parallel_tool_calls` | 仅 Lite/Kimi；其他型号的 Agent 宿主固定 false 不发送。 |
| `response_format` | object | 否 | `response_format` | json_object；text 仅 DeepSeek/GLM；json_schema 仅 DeepSeek，严格子集未核验。 |
| `stream` | boolean | 否 | `stream` | Chat SSE；宿主可强制开启流式。 |
| `stream_options` | object | 否 | `stream_options` | 非 GLM 流式请求固定 include_usage=true，用于本地用量结算；显式 false 拒绝，GLM 不发送。 |
| `do_sample` | boolean | 否 | `do_sample` | 仅 GLM；false 时不发送 temperature/top_p。 |
| `tool_stream` | boolean | 否 | `tool_stream` | 仅 GLM；流式且含 tools 时强制 true。 |
| `n` | integer | 否 | `n` | Flash/Lite 1–7；GLM 1–4；DeepSeek 仅 1；Kimi 未声明。 |
| `stop` | string|array | 否 | `stop` | GLM 仅数组且最多 4 项；DeepSeek 最多 16 项。 |
| `presence_penalty` | number | 否 | `presence_penalty` | SenseNova [0,2]；DeepSeek [-2,2]且思考下不发送；Kimi 固定 0；GLM 未声明。 |
| `frequency_penalty` | number | 否 | `frequency_penalty` | SenseNova [0,2]；DeepSeek [-2,2]且思考下不发送；Kimi 固定 0；GLM 未声明。 |
| `repetition_penalty` | number | 否 | `repetition_penalty` | 仅 SenseNova 6.8 Flash，[1,2]。 |
| `seed` | integer | 否 | `seed` | 仅 Flash/Lite/Kimi，[0,9999999)；不承诺确定复现。 |
| `logprobs` | boolean | 否 | `logprobs` | 仅 DeepSeek。 |
| `top_logprobs` | integer | 否 | `top_logprobs` | 仅 DeepSeek，[0,20] 且 logprobs=true。 |


## 上游请求模板逐字段清单

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/chat/completions"` |
| `create.contentType` | `"application/json"` |
| `create.body` | `{"$ref":"bindings.body"}` |
| `agent.method` | `"POST"` |
| `agent.path` | `"/chat/completions"` |
| `agent.contentType` | `"application/json"` |
| `agent.body` | `{"$ref":"bindings.body"}` |


## Provider 扩展键

- 无额外扩展键。


## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `{"$if":{"condition":{"$in":[{"$ref":"response.choices.0.finish_reason"},["length","content_filter"]]},"then":"failed","else":"succeeded"}}` |
| `response.message` | `{"$switch":{"cases":[{"when":{"$eq":[{"$ref":"response.choices.0.finish_reason"},"length"]},"then":"SenseNova 输出达到 Token 或上下文上限，内容已截断，请提高输出上限后重试"},{"when":{"$eq":[{"$ref":"response.choices.0.finish_reason"},"content_filter"]},"then":"SenseNova 安全过滤拦截了输出，请调整输入后重试"}],"default":{"$ref":"response.error.message"}}}` |
| `response.textPaths[0]` | `"choices.0.message.content"` |
| `response.reasoningPaths[0]` | `"choices.0.message.reasoning"` |
| `response.reasoningPaths[1]` | `"choices.0.message.reasoning_content"` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error"` |
| `response.messagePaths[0]` | `"error.message"` |
| `agentResponse.textPaths[0]` | `"choices.0.message.content"` |
| `agentResponse.reasoningPaths[0]` | `"choices.0.message.reasoning"` |
| `agentResponse.reasoningPaths[1]` | `"choices.0.message.reasoning_content"` |
| `agentResponse.toolCallsPath` | `"choices.0.message.tool_calls"` |
| `agentResponse.toolCallIdPaths[0]` | `"id"` |
| `agentResponse.toolCallNamePaths[0]` | `"function.name"` |
| `agentResponse.toolCallArgumentsPaths[0]` | `"function.arguments"` |

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "sensenova-chat",
  "name": "SenseNova Chat",
  "version": "1.0.0",
  "author": "SenseNova / 影策",
  "description": "SenseNova 五模型 Chat Completions 文本与视觉理解协议。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "sensenova-chat",
        "label": "SenseNova Chat",
        "capabilities": [
          "text"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://token.sensenova.cn/v1",
        "requiresPublicMediaUrls": false,
        "hostTextPolicy": "before_mapping",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "五个精确文本模型 ID；不允许未声明模型。"
          },
          {
            "name": "messages",
            "type": "message[]",
            "required": true,
            "mapping": "messages",
            "description": "统一历史与当前输入；图片仅 user，Kimi 须 Data URL，GLM 仅文本。"
          },
          {
            "name": "instructions",
            "type": "string",
            "required": false,
            "mapping": "messages[].content",
            "description": "统一系统指令由宿主注入 system 消息。"
          },
          {
            "name": "max_tokens",
            "type": "integer",
            "required": false,
            "mapping": "max_tokens / max_completion_tokens",
            "description": "统一输出上限按模型映射；Kimi 扩展配置使用 max_completion_tokens。"
          },
          {
            "name": "max_completion_tokens",
            "type": "integer",
            "required": false,
            "mapping": "max_completion_tokens",
            "description": "仅 Kimi K3；不能与 max_tokens 同时配置。"
          },
          {
            "name": "thinking",
            "type": "object",
            "required": false,
            "mapping": "thinking",
            "description": "enabled/disabled；Flash/GLM 不可关闭，GLM 可配置 clear_thinking。"
          },
          {
            "name": "reasoning_effort",
            "type": "string",
            "required": false,
            "mapping": "reasoning_effort",
            "description": "按型号校验档位；DeepSeek 兼容档位归一；关闭用 thinking.type。"
          },
          {
            "name": "temperature",
            "type": "number",
            "required": false,
            "mapping": "temperature",
            "description": "Flash/GLM [0,1]，Lite/DeepSeek [0,2]，Kimi 固定 1；不生效的模型模式不发送。"
          },
          {
            "name": "top_p",
            "type": "number",
            "required": false,
            "mapping": "top_p",
            "description": "(0,1]；GLM 至少 0.01，Kimi 固定 0.95；DeepSeek 按思考模式规整。"
          },
          {
            "name": "tools",
            "type": "array",
            "required": false,
            "mapping": "tools",
            "description": "Function Calling 声明；parameters 是工具 JSON Schema；GLM 最多 128 项。"
          },
          {
            "name": "tool_choice",
            "type": "object|string",
            "required": false,
            "mapping": "tool_choice",
            "description": "auto/none/required 或指定函数；GLM 仅字符串。"
          },
          {
            "name": "parallel_tool_calls",
            "type": "boolean",
            "required": false,
            "mapping": "parallel_tool_calls",
            "description": "仅 Lite/Kimi；其他型号的 Agent 宿主固定 false 不发送。"
          },
          {
            "name": "response_format",
            "type": "object",
            "required": false,
            "mapping": "response_format",
            "description": "json_object；text 仅 DeepSeek/GLM；json_schema 仅 DeepSeek，严格子集未核验。"
          },
          {
            "name": "stream",
            "type": "boolean",
            "required": false,
            "mapping": "stream",
            "description": "Chat SSE；宿主可强制开启流式。"
          },
          {
            "name": "stream_options",
            "type": "object",
            "required": false,
            "mapping": "stream_options",
            "description": "非 GLM 流式请求固定 include_usage=true，用于本地用量结算；显式 false 拒绝，GLM 不发送。"
          },
          {
            "name": "do_sample",
            "type": "boolean",
            "required": false,
            "mapping": "do_sample",
            "description": "仅 GLM；false 时不发送 temperature/top_p。"
          },
          {
            "name": "tool_stream",
            "type": "boolean",
            "required": false,
            "mapping": "tool_stream",
            "description": "仅 GLM；流式且含 tools 时强制 true。"
          },
          {
            "name": "n",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "Flash/Lite 1–7；GLM 1–4；DeepSeek 仅 1；Kimi 未声明。"
          },
          {
            "name": "stop",
            "type": "string|array",
            "required": false,
            "mapping": "stop",
            "description": "GLM 仅数组且最多 4 项；DeepSeek 最多 16 项。"
          },
          {
            "name": "presence_penalty",
            "type": "number",
            "required": false,
            "mapping": "presence_penalty",
            "description": "SenseNova [0,2]；DeepSeek [-2,2]且思考下不发送；Kimi 固定 0；GLM 未声明。"
          },
          {
            "name": "frequency_penalty",
            "type": "number",
            "required": false,
            "mapping": "frequency_penalty",
            "description": "SenseNova [0,2]；DeepSeek [-2,2]且思考下不发送；Kimi 固定 0；GLM 未声明。"
          },
          {
            "name": "repetition_penalty",
            "type": "number",
            "required": false,
            "mapping": "repetition_penalty",
            "description": "仅 SenseNova 6.8 Flash，[1,2]。"
          },
          {
            "name": "seed",
            "type": "integer",
            "required": false,
            "mapping": "seed",
            "description": "仅 Flash/Lite/Kimi，[0,9999999)；不承诺确定复现。"
          },
          {
            "name": "logprobs",
            "type": "boolean",
            "required": false,
            "mapping": "logprobs",
            "description": "仅 DeepSeek。"
          },
          {
            "name": "top_logprobs",
            "type": "integer",
            "required": false,
            "mapping": "top_logprobs",
            "description": "仅 DeepSeek，[0,20] 且 logprobs=true。"
          }
        ],
        "requestBindings": [
          {
            "name": "isAgent",
            "value": {
              "$ne": [
                {
                  "$ref": "request.extra.agent.chatCompletion"
                },
                null
              ]
            }
          },
          {
            "name": "rawOptions",
            "value": {
              "$if": {
                "condition": {
                  "$ref": "bindings.isAgent"
                },
                "then": {
                  "$if": {
                    "condition": {
                      "$eq": [
                        {
                          "$ref": "request.extra.agent.chatCompletion"
                        },
                        null
                      ]
                    },
                    "then": {},
                    "else": {
                      "$ref": "request.extra.agent.chatCompletion"
                    }
                  }
                },
                "else": {
                  "$if": {
                    "condition": {
                      "$eq": [
                        {
                          "$ref": "request.providerOptions.sensenova-chat"
                        },
                        null
                      ]
                    },
                    "then": {},
                    "else": {
                      "$ref": "request.providerOptions.sensenova-chat"
                    }
                  }
                }
              }
            }
          },
          {
            "name": "options",
            "value": {
              "$if": {
                "condition": {
                  "$ref": "bindings.isAgent"
                },
                "then": {
                  "temperature": {
                    "$ref": "bindings.rawOptions.temperature"
                  },
                  "top_p": {
                    "$ref": "bindings.rawOptions.top_p"
                  },
                  "max_tokens": {
                    "$ref": "bindings.rawOptions.max_tokens"
                  },
                  "max_completion_tokens": {
                    "$ref": "bindings.rawOptions.max_completion_tokens"
                  },
                  "thinking": {
                    "$ref": "bindings.rawOptions.thinking"
                  },
                  "reasoning_effort": {
                    "$ref": "bindings.rawOptions.reasoning_effort"
                  },
                  "n": {
                    "$ref": "bindings.rawOptions.n"
                  },
                  "stop": {
                    "$ref": "bindings.rawOptions.stop"
                  },
                  "presence_penalty": {
                    "$ref": "bindings.rawOptions.presence_penalty"
                  },
                  "frequency_penalty": {
                    "$ref": "bindings.rawOptions.frequency_penalty"
                  },
                  "repetition_penalty": {
                    "$ref": "bindings.rawOptions.repetition_penalty"
                  },
                  "seed": {
                    "$ref": "bindings.rawOptions.seed"
                  },
                  "tools": {
                    "$ref": "bindings.rawOptions.tools"
                  },
                  "tool_choice": {
                    "$ref": "bindings.rawOptions.tool_choice"
                  },
                  "parallel_tool_calls": {
                    "$ref": "bindings.rawOptions.parallel_tool_calls"
                  },
                  "response_format": {
                    "$ref": "bindings.rawOptions.response_format"
                  },
                  "stream": {
                    "$ref": "bindings.rawOptions.stream"
                  },
                  "stream_options": {
                    "$ref": "bindings.rawOptions.stream_options"
                  },
                  "do_sample": {
                    "$ref": "bindings.rawOptions.do_sample"
                  },
                  "tool_stream": {
                    "$ref": "bindings.rawOptions.tool_stream"
                  },
                  "logprobs": {
                    "$ref": "bindings.rawOptions.logprobs"
                  },
                  "top_logprobs": {
                    "$ref": "bindings.rawOptions.top_logprobs"
                  },
                  "messages": {
                    "$ref": "bindings.rawOptions.messages"
                  },
                  "model": {
                    "$ref": "bindings.rawOptions.model"
                  },
                  "prompt_cache_key": {
                    "$ref": "bindings.rawOptions.prompt_cache_key"
                  }
                },
                "else": {
                  "temperature": {
                    "$ref": "bindings.rawOptions.temperature"
                  },
                  "top_p": {
                    "$ref": "bindings.rawOptions.top_p"
                  },
                  "max_tokens": {
                    "$ref": "bindings.rawOptions.max_tokens"
                  },
                  "max_completion_tokens": {
                    "$ref": "bindings.rawOptions.max_completion_tokens"
                  },
                  "thinking": {
                    "$if": {
                      "condition": {
                        "$ne": [
                          {
                            "$ref": "request.extra.thinking"
                          },
                          null
                        ]
                      },
                      "then": {
                        "$ref": "request.extra.thinking"
                      },
                      "else": {
                        "$ref": "bindings.rawOptions.thinking"
                      }
                    }
                  },
                  "reasoning_effort": {
                    "$if": {
                      "condition": {
                        "$or": [
                          {
                            "$ne": [
                              {
                                "$ref": "request.extra.thinking"
                              },
                              null
                            ]
                          },
                          {
                            "$ne": [
                              {
                                "$ref": "request.extra.reasoning_effort"
                              },
                              null
                            ]
                          }
                        ]
                      },
                      "then": {
                        "$ref": "request.extra.reasoning_effort"
                      },
                      "else": {
                        "$ref": "bindings.rawOptions.reasoning_effort"
                      }
                    }
                  },
                  "n": {
                    "$ref": "bindings.rawOptions.n"
                  },
                  "stop": {
                    "$ref": "bindings.rawOptions.stop"
                  },
                  "presence_penalty": {
                    "$ref": "bindings.rawOptions.presence_penalty"
                  },
                  "frequency_penalty": {
                    "$ref": "bindings.rawOptions.frequency_penalty"
                  },
                  "repetition_penalty": {
                    "$ref": "bindings.rawOptions.repetition_penalty"
                  },
                  "seed": {
                    "$ref": "bindings.rawOptions.seed"
                  },
                  "tools": {
                    "$ref": "bindings.rawOptions.tools"
                  },
                  "tool_choice": {
                    "$ref": "bindings.rawOptions.tool_choice"
                  },
                  "parallel_tool_calls": {
                    "$ref": "bindings.rawOptions.parallel_tool_calls"
                  },
                  "response_format": {
                    "$ref": "bindings.rawOptions.response_format"
                  },
                  "stream": {
                    "$ref": "bindings.rawOptions.stream"
                  },
                  "stream_options": {
                    "$ref": "bindings.rawOptions.stream_options"
                  },
                  "do_sample": {
                    "$ref": "bindings.rawOptions.do_sample"
                  },
                  "tool_stream": {
                    "$ref": "bindings.rawOptions.tool_stream"
                  },
                  "logprobs": {
                    "$ref": "bindings.rawOptions.logprobs"
                  },
                  "top_logprobs": {
                    "$ref": "bindings.rawOptions.top_logprobs"
                  }
                }
              }
            }
          },
          {
            "name": "messages",
            "value": {
              "$if": {
                "condition": {
                  "$ref": "bindings.isAgent"
                },
                "then": {
                  "$ref": "bindings.options.messages"
                },
                "else": {
                  "$ref": "request.messages"
                }
              }
            }
          },
          {
            "name": "thinkingType",
            "value": {
              "$coalesce": [
                {
                  "$ref": "bindings.options.thinking.type"
                },
                {
                  "$if": {
                    "condition": {
                      "$eq": [
                        {
                          "$ref": "bindings.options.reasoning_effort"
                        },
                        "none"
                      ]
                    },
                    "then": "disabled",
                    "else": "enabled"
                  }
                }
              ]
            }
          },
          {
            "name": "thinkingEnabled",
            "value": {
              "$eq": [
                {
                  "$ref": "bindings.thinkingType"
                },
                "enabled"
              ]
            }
          },
          {
            "name": "effort",
            "value": {
              "$coalesce": [
                {
                  "$ref": "bindings.options.reasoning_effort"
                },
                {
                  "$if": {
                    "condition": {
                      "$or": [
                        {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "glm-5.3"
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "kimi-k3"
                          ]
                        }
                      ]
                    },
                    "then": "max",
                    "else": "high"
                  }
                }
              ]
            }
          },
          {
            "name": "outputLimit",
            "value": {
              "$coalesce": [
                {
                  "$ref": "request.extra.max_tokens"
                },
                {
                  "$ref": "bindings.options.max_completion_tokens"
                },
                {
                  "$ref": "bindings.options.max_tokens"
                }
              ]
            }
          },
          {
            "name": "stream",
            "value": {
              "$coalesce": [
                {
                  "$ref": "request.extra.stream"
                },
                {
                  "$ref": "bindings.options.stream"
                }
              ]
            }
          },
          {
            "name": "body",
            "value": {
              "model": {
                "$ref": "request.model"
              },
              "messages": {
                "$map": {
                  "from": {
                    "$ref": "bindings.messages"
                  },
                  "as": "m",
                  "in": {
                    "role": {
                      "$ref": "m.role"
                    },
                    "content": {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$ref": "m.content"
                            },
                            {
                              "$toString": {
                                "$ref": "m.content"
                              }
                            }
                          ]
                        },
                        "then": {
                          "$ref": "m.content"
                        },
                        "else": {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "m.content"
                                },
                                null
                              ]
                            },
                            "then": null,
                            "else": {
                              "$map": {
                                "from": {
                                  "$ref": "m.content"
                                },
                                "as": "p",
                                "in": {
                                  "$if": {
                                    "condition": {
                                      "$eq": [
                                        {
                                          "$ref": "p.type"
                                        },
                                        "text"
                                      ]
                                    },
                                    "then": {
                                      "type": "text",
                                      "text": {
                                        "$ref": "p.text"
                                      }
                                    },
                                    "else": {
                                      "type": "image_url",
                                      "image_url": {
                                        "url": {
                                          "$ref": "p.image_url.url"
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    },
                    "tool_call_id": {
                      "$omitEmpty": {
                        "$ref": "m.tool_call_id"
                      }
                    },
                    "tool_calls": {
                      "$omitEmpty": {
                        "$map": {
                          "from": {
                            "$ref": "m.tool_calls"
                          },
                          "as": "t",
                          "in": {
                            "id": {
                              "$ref": "t.id"
                            },
                            "type": "function",
                            "function": {
                              "name": {
                                "$ref": "t.function.name"
                              },
                              "arguments": {
                                "$ref": "t.function.arguments"
                              }
                            }
                          }
                        }
                      }
                    },
                    "reasoning": {
                      "$if": {
                        "condition": {
                          "$and": [
                            {
                              "$or": [
                                {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "sensenova-6.8-flash"
                                  ]
                                },
                                {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "sensenova-6.8-flash-lite"
                                  ]
                                }
                              ]
                            },
                            {
                              "$eq": [
                                {
                                  "$ref": "m.role"
                                },
                                "assistant"
                              ]
                            }
                          ]
                        },
                        "then": {
                          "$omitEmpty": {
                            "$coalesce": [
                              {
                                "$ref": "m.reasoning_content"
                              },
                              {
                                "$ref": "m.reasoning"
                              }
                            ]
                          }
                        },
                        "else": null
                      }
                    },
                    "reasoning_content": {
                      "$if": {
                        "condition": {
                          "$and": [
                            {
                              "$not": {
                                "$or": [
                                  {
                                    "$eq": [
                                      {
                                        "$ref": "request.model"
                                      },
                                      "sensenova-6.8-flash"
                                    ]
                                  },
                                  {
                                    "$eq": [
                                      {
                                        "$ref": "request.model"
                                      },
                                      "sensenova-6.8-flash-lite"
                                    ]
                                  }
                                ]
                              }
                            },
                            {
                              "$eq": [
                                {
                                  "$ref": "m.role"
                                },
                                "assistant"
                              ]
                            }
                          ]
                        },
                        "then": {
                          "$omitEmpty": {
                            "$coalesce": [
                              {
                                "$ref": "m.reasoning_content"
                              },
                              {
                                "$ref": "m.reasoning"
                              }
                            ]
                          }
                        },
                        "else": null
                      }
                    }
                  }
                }
              },
              "thinking": {
                "type": {
                  "$ref": "bindings.thinkingType"
                },
                "clear_thinking": {
                  "$if": {
                    "condition": {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "glm-5.3"
                      ]
                    },
                    "then": {
                      "$ref": "bindings.options.thinking.clear_thinking"
                    },
                    "else": null
                  }
                }
              },
              "reasoning_effort": {
                "$if": {
                  "condition": {
                    "$ref": "bindings.thinkingEnabled"
                  },
                  "then": {
                    "$if": {
                      "condition": {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "deepseek-flash"
                        ]
                      },
                      "then": {
                        "$if": {
                          "condition": {
                            "$eq": [
                              {
                                "$ref": "bindings.effort"
                              },
                              "minimal"
                            ]
                          },
                          "then": "low",
                          "else": {
                            "$if": {
                              "condition": {
                                "$in": [
                                  {
                                    "$ref": "bindings.effort"
                                  },
                                  [
                                    "medium",
                                    "xhigh"
                                  ]
                                ]
                              },
                              "then": "high",
                              "else": {
                                "$if": {
                                  "condition": {
                                    "$eq": [
                                      {
                                        "$ref": "bindings.effort"
                                      },
                                      "ultra"
                                    ]
                                  },
                                  "then": "max",
                                  "else": {
                                    "$ref": "bindings.effort"
                                  }
                                }
                              }
                            }
                          }
                        }
                      },
                      "else": {
                        "$ref": "bindings.effort"
                      }
                    }
                  },
                  "else": null
                }
              },
              "max_tokens": {
                "$if": {
                  "condition": {
                    "$not": {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "kimi-k3"
                      ]
                    }
                  },
                  "then": {
                    "$ref": "bindings.outputLimit"
                  },
                  "else": null
                }
              },
              "max_completion_tokens": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "request.model"
                      },
                      "kimi-k3"
                    ]
                  },
                  "then": {
                    "$ref": "bindings.outputLimit"
                  },
                  "else": null
                }
              },
              "temperature": {
                "$if": {
                  "condition": {
                    "$not": {
                      "$or": [
                        {
                          "$and": [
                            {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "deepseek-flash"
                              ]
                            },
                            {
                              "$ref": "bindings.thinkingEnabled"
                            }
                          ]
                        },
                        {
                          "$and": [
                            {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "glm-5.3"
                              ]
                            },
                            {
                              "$eq": [
                                {
                                  "$ref": "bindings.options.do_sample"
                                },
                                false
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  },
                  "then": {
                    "$ref": "bindings.options.temperature"
                  },
                  "else": null
                }
              },
              "top_p": {
                "$if": {
                  "condition": {
                    "$not": {
                      "$and": [
                        {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "glm-5.3"
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.do_sample"
                            },
                            false
                          ]
                        }
                      ]
                    }
                  },
                  "then": {
                    "$if": {
                      "condition": {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "deepseek-flash"
                        ]
                      },
                      "then": {
                        "$if": {
                          "condition": {
                            "$ref": "bindings.thinkingEnabled"
                          },
                          "then": {
                            "$if": {
                              "condition": {
                                "$ne": [
                                  {
                                    "$ref": "bindings.options.top_p"
                                  },
                                  null
                                ]
                              },
                              "then": {
                                "$max": [
                                  {
                                    "$ref": "bindings.options.top_p"
                                  },
                                  0.95
                                ]
                              },
                              "else": null
                            }
                          },
                          "else": {
                            "$if": {
                              "condition": {
                                "$ne": [
                                  {
                                    "$ref": "bindings.options.top_p"
                                  },
                                  null
                                ]
                              },
                              "then": 1,
                              "else": null
                            }
                          }
                        }
                      },
                      "else": {
                        "$ref": "bindings.options.top_p"
                      }
                    }
                  },
                  "else": null
                }
              },
              "presence_penalty": {
                "$if": {
                  "condition": {
                    "$not": {
                      "$and": [
                        {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "deepseek-flash"
                          ]
                        },
                        {
                          "$ref": "bindings.thinkingEnabled"
                        }
                      ]
                    }
                  },
                  "then": {
                    "$ref": "bindings.options.presence_penalty"
                  },
                  "else": null
                }
              },
              "frequency_penalty": {
                "$if": {
                  "condition": {
                    "$not": {
                      "$and": [
                        {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "deepseek-flash"
                          ]
                        },
                        {
                          "$ref": "bindings.thinkingEnabled"
                        }
                      ]
                    }
                  },
                  "then": {
                    "$ref": "bindings.options.frequency_penalty"
                  },
                  "else": null
                }
              },
              "n": {
                "$ref": "bindings.options.n"
              },
              "stop": {
                "$ref": "bindings.options.stop"
              },
              "seed": {
                "$ref": "bindings.options.seed"
              },
              "repetition_penalty": {
                "$ref": "bindings.options.repetition_penalty"
              },
              "response_format": {
                "$ref": "bindings.options.response_format"
              },
              "stream": {
                "$ref": "bindings.stream"
              },
              "tools": {
                "$omitEmpty": {
                  "$map": {
                    "from": {
                      "$ref": "bindings.options.tools"
                    },
                    "as": "t",
                    "in": {
                      "type": "function",
                      "function": {
                        "name": {
                          "$ref": "t.function.name"
                        },
                        "description": {
                          "$ref": "t.function.description"
                        },
                        "parameters": {
                          "$ref": "t.function.parameters"
                        }
                      }
                    }
                  }
                }
              },
              "tool_choice": {
                "$ref": "bindings.options.tool_choice"
              },
              "parallel_tool_calls": {
                "$if": {
                  "condition": {
                    "$or": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "sensenova-6.8-flash-lite"
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "kimi-k3"
                        ]
                      }
                    ]
                  },
                  "then": {
                    "$ref": "bindings.options.parallel_tool_calls"
                  },
                  "else": null
                }
              },
              "do_sample": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "request.model"
                      },
                      "glm-5.3"
                    ]
                  },
                  "then": {
                    "$ref": "bindings.options.do_sample"
                  },
                  "else": null
                }
              },
              "tool_stream": {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "glm-5.3"
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "bindings.stream"
                          },
                          true
                        ]
                      },
                      {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "bindings.options.tools"
                            }
                          },
                          0
                        ]
                      }
                    ]
                  },
                  "then": true,
                  "else": null
                }
              },
              "logprobs": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "request.model"
                      },
                      "deepseek-flash"
                    ]
                  },
                  "then": {
                    "$ref": "bindings.options.logprobs"
                  },
                  "else": null
                }
              },
              "top_logprobs": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "request.model"
                      },
                      "deepseek-flash"
                    ]
                  },
                  "then": {
                    "$ref": "bindings.options.top_logprobs"
                  },
                  "else": null
                }
              },
              "stream_options": {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$not": {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "glm-5.3"
                          ]
                        }
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "bindings.stream"
                          },
                          true
                        ]
                      }
                    ]
                  },
                  "then": {
                    "include_usage": true
                  },
                  "else": null
                }
              }
            }
          }
        ],
        "validations": [
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.model"
                },
                [
                  "sensenova-6.8-flash",
                  "sensenova-6.8-flash-lite",
                  "deepseek-flash",
                  "glm-5.3",
                  "kimi-k3"
                ]
              ]
            },
            "message": "SenseNova 文本协议仅支持 sensenova-6.8-flash、sensenova-6.8-flash-lite、deepseek-flash、glm-5.3、kimi-k3"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ref": "bindings.isAgent"
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.textInput.invalidCount"
                    },
                    0
                  ]
                }
              ]
            },
            "message": "输入或历史消息包含无效的文本或图片数据"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "bindings.rawOptions"
                },
                {
                  "$if": {
                    "condition": {
                      "$ref": "bindings.isAgent"
                    },
                    "then": {
                      "temperature": {
                        "$ref": "bindings.rawOptions.temperature"
                      },
                      "top_p": {
                        "$ref": "bindings.rawOptions.top_p"
                      },
                      "max_tokens": {
                        "$ref": "bindings.rawOptions.max_tokens"
                      },
                      "max_completion_tokens": {
                        "$ref": "bindings.rawOptions.max_completion_tokens"
                      },
                      "thinking": {
                        "$ref": "bindings.rawOptions.thinking"
                      },
                      "reasoning_effort": {
                        "$ref": "bindings.rawOptions.reasoning_effort"
                      },
                      "n": {
                        "$ref": "bindings.rawOptions.n"
                      },
                      "stop": {
                        "$ref": "bindings.rawOptions.stop"
                      },
                      "presence_penalty": {
                        "$ref": "bindings.rawOptions.presence_penalty"
                      },
                      "frequency_penalty": {
                        "$ref": "bindings.rawOptions.frequency_penalty"
                      },
                      "repetition_penalty": {
                        "$ref": "bindings.rawOptions.repetition_penalty"
                      },
                      "seed": {
                        "$ref": "bindings.rawOptions.seed"
                      },
                      "tools": {
                        "$ref": "bindings.rawOptions.tools"
                      },
                      "tool_choice": {
                        "$ref": "bindings.rawOptions.tool_choice"
                      },
                      "parallel_tool_calls": {
                        "$ref": "bindings.rawOptions.parallel_tool_calls"
                      },
                      "response_format": {
                        "$ref": "bindings.rawOptions.response_format"
                      },
                      "stream": {
                        "$ref": "bindings.rawOptions.stream"
                      },
                      "stream_options": {
                        "$ref": "bindings.rawOptions.stream_options"
                      },
                      "do_sample": {
                        "$ref": "bindings.rawOptions.do_sample"
                      },
                      "tool_stream": {
                        "$ref": "bindings.rawOptions.tool_stream"
                      },
                      "logprobs": {
                        "$ref": "bindings.rawOptions.logprobs"
                      },
                      "top_logprobs": {
                        "$ref": "bindings.rawOptions.top_logprobs"
                      },
                      "messages": {
                        "$ref": "bindings.rawOptions.messages"
                      },
                      "model": {
                        "$ref": "bindings.rawOptions.model"
                      },
                      "prompt_cache_key": {
                        "$ref": "bindings.rawOptions.prompt_cache_key"
                      }
                    },
                    "else": {
                      "temperature": {
                        "$ref": "bindings.rawOptions.temperature"
                      },
                      "top_p": {
                        "$ref": "bindings.rawOptions.top_p"
                      },
                      "max_tokens": {
                        "$ref": "bindings.rawOptions.max_tokens"
                      },
                      "max_completion_tokens": {
                        "$ref": "bindings.rawOptions.max_completion_tokens"
                      },
                      "thinking": {
                        "$ref": "bindings.rawOptions.thinking"
                      },
                      "reasoning_effort": {
                        "$ref": "bindings.rawOptions.reasoning_effort"
                      },
                      "n": {
                        "$ref": "bindings.rawOptions.n"
                      },
                      "stop": {
                        "$ref": "bindings.rawOptions.stop"
                      },
                      "presence_penalty": {
                        "$ref": "bindings.rawOptions.presence_penalty"
                      },
                      "frequency_penalty": {
                        "$ref": "bindings.rawOptions.frequency_penalty"
                      },
                      "repetition_penalty": {
                        "$ref": "bindings.rawOptions.repetition_penalty"
                      },
                      "seed": {
                        "$ref": "bindings.rawOptions.seed"
                      },
                      "tools": {
                        "$ref": "bindings.rawOptions.tools"
                      },
                      "tool_choice": {
                        "$ref": "bindings.rawOptions.tool_choice"
                      },
                      "parallel_tool_calls": {
                        "$ref": "bindings.rawOptions.parallel_tool_calls"
                      },
                      "response_format": {
                        "$ref": "bindings.rawOptions.response_format"
                      },
                      "stream": {
                        "$ref": "bindings.rawOptions.stream"
                      },
                      "stream_options": {
                        "$ref": "bindings.rawOptions.stream_options"
                      },
                      "do_sample": {
                        "$ref": "bindings.rawOptions.do_sample"
                      },
                      "tool_stream": {
                        "$ref": "bindings.rawOptions.tool_stream"
                      },
                      "logprobs": {
                        "$ref": "bindings.rawOptions.logprobs"
                      },
                      "top_logprobs": {
                        "$ref": "bindings.rawOptions.top_logprobs"
                      }
                    }
                  }
                }
              ]
            },
            "message": "SenseNova 参数包含未声明字段；不支持 body、extra_body 或任意厂商扩展旁路"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.model"
                    },
                    null
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.model"
                    },
                    {
                      "$ref": "request.model"
                    }
                  ]
                }
              ]
            },
            "message": "Agent model 不得覆盖所选模型"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$eq": [
                      {
                        "$ref": "request.model"
                      },
                      "kimi-k3"
                    ]
                  }
                },
                {
                  "$ref": "bindings.isAgent"
                },
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.max_tokens"
                    },
                    null
                  ]
                }
              ]
            },
            "message": "Kimi K3 扩展参数必须使用 max_completion_tokens；统一输出上限由宿主转换"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "kimi-k3"
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.max_completion_tokens"
                    },
                    null
                  ]
                }
              ]
            },
            "message": "max_completion_tokens 仅适用于 Kimi K3"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.max_tokens"
                    },
                    null
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.max_completion_tokens"
                    },
                    null
                  ]
                }
              ]
            },
            "message": "不能同时指定 max_tokens 与 max_completion_tokens"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.outputLimit"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.outputLimit"
                        },
                        {
                          "$toInt": {
                            "$ref": "bindings.outputLimit"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.outputLimit"
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.outputLimit"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "kimi-k3"
                              ]
                            },
                            "then": 1048576,
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "sensenova-6.8-flash-lite"
                                  ]
                                },
                                "then": 65536,
                                "else": {
                                  "$if": {
                                    "condition": {
                                      "$eq": [
                                        {
                                          "$ref": "request.model"
                                        },
                                        "deepseek-flash"
                                      ]
                                    },
                                    "then": 393216,
                                    "else": 131072
                                  }
                                }
                              }
                            }
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "输出 Token 上限必须是模型允许范围内的正整数；Kimi 仍受剩余上下文约束"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.thinking"
                    },
                    null
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.thinking"
                    },
                    {
                      "type": {
                        "$ref": "bindings.options.thinking.type"
                      },
                      "clear_thinking": {
                        "$ref": "bindings.options.thinking.clear_thinking"
                      }
                    }
                  ]
                }
              ]
            },
            "message": "thinking 仅允许 type 及 GLM 的 clear_thinking"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "bindings.thinkingType"
                },
                [
                  "enabled",
                  "disabled"
                ]
              ]
            },
            "message": "thinking.type 仅支持 enabled 或 disabled"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$or": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "sensenova-6.8-flash"
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "glm-5.3"
                        ]
                      }
                    ]
                  }
                },
                {
                  "$ref": "bindings.thinkingEnabled"
                }
              ]
            },
            "message": "SenseNova 6.8 Flash 与 GLM-5.3 不能关闭思考"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ref": "bindings.thinkingEnabled"
                },
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.reasoning_effort"
                    },
                    null
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.reasoning_effort"
                    },
                    "none"
                  ]
                }
              ]
            },
            "message": "关闭思考不能同时指定开启档位的 reasoning_effort"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.reasoning_effort"
                    },
                    null
                  ]
                },
                {
                  "$in": [
                    {
                      "$ref": "bindings.options.reasoning_effort"
                    },
                    {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "sensenova-6.8-flash"
                          ]
                        },
                        "then": [
                          "minimal",
                          "low",
                          "medium",
                          "high",
                          "xhigh",
                          "max"
                        ],
                        "else": {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "sensenova-6.8-flash-lite"
                              ]
                            },
                            "then": [
                              "none",
                              "low",
                              "medium",
                              "high",
                              "max"
                            ],
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "deepseek-flash"
                                  ]
                                },
                                "then": [
                                  "none",
                                  "minimal",
                                  "low",
                                  "medium",
                                  "high",
                                  "xhigh",
                                  "max",
                                  "ultra"
                                ],
                                "else": {
                                  "$if": {
                                    "condition": {
                                      "$eq": [
                                        {
                                          "$ref": "request.model"
                                        },
                                        "glm-5.3"
                                      ]
                                    },
                                    "then": [
                                      "low",
                                      "high",
                                      "max"
                                    ],
                                    "else": [
                                      "low",
                                      "medium",
                                      "high",
                                      "max"
                                    ]
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  ]
                }
              ]
            },
            "message": "reasoning_effort 不属于所选模型支持的档位"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.thinking.clear_thinking"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "glm-5.3"
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$ref": "bindings.options.thinking.clear_thinking"
                        },
                        [
                          true,
                          false
                        ]
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "thinking.clear_thinking 仅支持 GLM-5.3 布尔值"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.temperature"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.temperature"
                        },
                        {
                          "$toFloat": {
                            "$ref": "bindings.options.temperature"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.options.temperature"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.options.temperature"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$or": [
                                {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "sensenova-6.8-flash"
                                  ]
                                },
                                {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "glm-5.3"
                                  ]
                                }
                              ]
                            },
                            "then": 1,
                            "else": 2
                          }
                        }
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "kimi-k3"
                            ]
                          }
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.temperature"
                            },
                            1
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "temperature 超出模型范围；Kimi K3 固定为 1"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.top_p"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.top_p"
                        },
                        {
                          "$toFloat": {
                            "$ref": "bindings.options.top_p"
                          }
                        }
                      ]
                    },
                    {
                      "$gt": [
                        {
                          "$ref": "bindings.options.top_p"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.options.top_p"
                        },
                        1
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "glm-5.3"
                            ]
                          }
                        },
                        {
                          "$gte": [
                            {
                              "$ref": "bindings.options.top_p"
                            },
                            0.01
                          ]
                        }
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "kimi-k3"
                            ]
                          }
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.top_p"
                            },
                            0.95
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "top_p 超出模型范围；GLM 至少 0.01，Kimi K3 固定 0.95"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.presence_penalty"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$not": {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "glm-5.3"
                        ]
                      }
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.presence_penalty"
                        },
                        {
                          "$toFloat": {
                            "$ref": "bindings.options.presence_penalty"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.options.presence_penalty"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "deepseek-flash"
                              ]
                            },
                            "then": -2,
                            "else": 0
                          }
                        }
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.options.presence_penalty"
                        },
                        2
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "kimi-k3"
                            ]
                          }
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.presence_penalty"
                            },
                            0
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "presence_penalty 超出模型范围；GLM 未声明支持，Kimi K3 固定为 0"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.frequency_penalty"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$not": {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "glm-5.3"
                        ]
                      }
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.frequency_penalty"
                        },
                        {
                          "$toFloat": {
                            "$ref": "bindings.options.frequency_penalty"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.options.frequency_penalty"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "deepseek-flash"
                              ]
                            },
                            "then": -2,
                            "else": 0
                          }
                        }
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.options.frequency_penalty"
                        },
                        2
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "kimi-k3"
                            ]
                          }
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.frequency_penalty"
                            },
                            0
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "frequency_penalty 超出模型范围；GLM 未声明支持，Kimi K3 固定为 0"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.repetition_penalty"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "sensenova-6.8-flash"
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.repetition_penalty"
                        },
                        {
                          "$toFloat": {
                            "$ref": "bindings.options.repetition_penalty"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.options.repetition_penalty"
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.options.repetition_penalty"
                        },
                        2
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "repetition_penalty 仅支持 SenseNova 6.8 Flash，范围 [1,2]"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.seed"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$or": [
                        {
                          "$or": [
                            {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "sensenova-6.8-flash"
                              ]
                            },
                            {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "sensenova-6.8-flash-lite"
                              ]
                            }
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "kimi-k3"
                          ]
                        }
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.seed"
                        },
                        {
                          "$toInt": {
                            "$ref": "bindings.options.seed"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.options.seed"
                        },
                        0
                      ]
                    },
                    {
                      "$lt": [
                        {
                          "$ref": "bindings.options.seed"
                        },
                        9999999
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "seed 仅支持 SenseNova Flash/Lite 和 Kimi K3，须为 [0,9999999) 整数"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.n"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$not": {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "kimi-k3"
                        ]
                      }
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.n"
                        },
                        {
                          "$toInt": {
                            "$ref": "bindings.options.n"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.options.n"
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.options.n"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "glm-5.3"
                              ]
                            },
                            "then": 4,
                            "else": 7
                          }
                        }
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "deepseek-flash"
                            ]
                          }
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.n"
                            },
                            1
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "n 必须符合模型范围；DeepSeek 仅 1 生效，Kimi K3 未声明 n"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.stop"
                    },
                    null
                  ]
                },
                {
                  "$or": [
                    {
                      "$and": [
                        {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "glm-5.3"
                            ]
                          }
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.stop"
                            },
                            {
                              "$toString": {
                                "$ref": "bindings.options.stop"
                              }
                            }
                          ]
                        },
                        {
                          "$gt": [
                            {
                              "$len": {
                                "$ref": "bindings.options.stop"
                              }
                            },
                            0
                          ]
                        }
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.stop"
                            },
                            {
                              "$map": {
                                "from": {
                                  "$ref": "bindings.options.stop"
                                },
                                "as": "v",
                                "in": {
                                  "$ref": "v"
                                }
                              }
                            }
                          ]
                        },
                        {
                          "$gt": [
                            {
                              "$len": {
                                "$ref": "bindings.options.stop"
                              }
                            },
                            0
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$len": {
                                "$filter": {
                                  "from": {
                                    "$ref": "bindings.options.stop"
                                  },
                                  "as": "s",
                                  "where": {
                                    "$not": {
                                      "$and": [
                                        {
                                          "$eq": [
                                            {
                                              "$ref": "s"
                                            },
                                            {
                                              "$toString": {
                                                "$ref": "s"
                                              }
                                            }
                                          ]
                                        },
                                        {
                                          "$gt": [
                                            {
                                              "$len": {
                                                "$ref": "s"
                                              }
                                            },
                                            0
                                          ]
                                        }
                                      ]
                                    }
                                  }
                                }
                              }
                            },
                            0
                          ]
                        },
                        {
                          "$lte": [
                            {
                              "$len": {
                                "$ref": "bindings.options.stop"
                              }
                            },
                            {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "deepseek-flash"
                                  ]
                                },
                                "then": 16,
                                "else": {
                                  "$if": {
                                    "condition": {
                                      "$eq": [
                                        {
                                          "$ref": "request.model"
                                        },
                                        "glm-5.3"
                                      ]
                                    },
                                    "then": 4,
                                    "else": 1048576
                                  }
                                }
                              }
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "stop 必须是非空字符串或字符串数组；GLM 仅数组最多 4 项，DeepSeek 最多 16 项"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.stream"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$in": [
                        {
                          "$ref": "bindings.options.stream"
                        },
                        [
                          true,
                          false
                        ]
                      ]
                    },
                    true
                  ]
                }
              ]
            },
            "message": "stream 类型或模型支持范围不正确"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.do_sample"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$in": [
                        {
                          "$ref": "bindings.options.do_sample"
                        },
                        [
                          true,
                          false
                        ]
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "glm-5.3"
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "do_sample 类型或模型支持范围不正确"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.tool_stream"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$in": [
                        {
                          "$ref": "bindings.options.tool_stream"
                        },
                        [
                          true,
                          false
                        ]
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "glm-5.3"
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "tool_stream 类型或模型支持范围不正确"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.logprobs"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$in": [
                        {
                          "$ref": "bindings.options.logprobs"
                        },
                        [
                          true,
                          false
                        ]
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "deepseek-flash"
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "logprobs 类型或模型支持范围不正确"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.parallel_tool_calls"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$in": [
                        {
                          "$ref": "bindings.options.parallel_tool_calls"
                        },
                        [
                          true,
                          false
                        ]
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "sensenova-6.8-flash-lite"
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "request.model"
                            },
                            "kimi-k3"
                          ]
                        },
                        {
                          "$and": [
                            {
                              "$ref": "bindings.isAgent"
                            },
                            {
                              "$eq": [
                                {
                                  "$ref": "bindings.options.parallel_tool_calls"
                                },
                                false
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "parallel_tool_calls 类型或模型支持范围不正确"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.stream_options"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$not": {
                        "$eq": [
                          {
                            "$ref": "request.model"
                          },
                          "glm-5.3"
                        ]
                      }
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.stream_options"
                        },
                        {
                          "include_usage": {
                            "$ref": "bindings.options.stream_options.include_usage"
                          }
                        }
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.stream_options.include_usage"
                        },
                        true
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "本地 SenseNova 流式协议要求 include_usage=true，不能关闭用量统计；GLM 未声明 stream_options"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.top_logprobs"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "deepseek-flash"
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.logprobs"
                        },
                        true
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.top_logprobs"
                        },
                        {
                          "$toInt": {
                            "$ref": "bindings.options.top_logprobs"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.options.top_logprobs"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.options.top_logprobs"
                        },
                        20
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "top_logprobs 仅支持 DeepSeek 且须启用 logprobs，范围 [0,20]"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.response_format"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.response_format"
                        },
                        {
                          "$merge": [
                            {
                              "$ref": "bindings.options.response_format"
                            }
                          ]
                        }
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$ref": "bindings.options.response_format.type"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "deepseek-flash"
                              ]
                            },
                            "then": [
                              "text",
                              "json_object",
                              "json_schema"
                            ],
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "glm-5.3"
                                  ]
                                },
                                "then": [
                                  "text",
                                  "json_object"
                                ],
                                "else": [
                                  "json_object"
                                ]
                              }
                            }
                          }
                        }
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.response_format"
                        },
                        {
                          "type": {
                            "$ref": "bindings.options.response_format.type"
                          },
                          "json_schema": {
                            "$ref": "bindings.options.response_format.json_schema"
                          }
                        }
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$and": [
                            {
                              "$eq": [
                                {
                                  "$ref": "bindings.options.response_format.type"
                                },
                                "json_schema"
                              ]
                            },
                            {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "deepseek-flash"
                              ]
                            },
                            {
                              "$eq": [
                                {
                                  "$ref": "bindings.options.response_format.json_schema"
                                },
                                {
                                  "$merge": [
                                    {
                                      "$ref": "bindings.options.response_format.json_schema"
                                    }
                                  ]
                                }
                              ]
                            },
                            {
                              "$gt": [
                                {
                                  "$len": {
                                    "$ref": "bindings.options.response_format.json_schema"
                                  }
                                },
                                0
                              ]
                            }
                          ]
                        },
                        {
                          "$and": [
                            {
                              "$ne": [
                                {
                                  "$ref": "bindings.options.response_format.type"
                                },
                                "json_schema"
                              ]
                            },
                            {
                              "$eq": [
                                {
                                  "$ref": "bindings.options.response_format.json_schema"
                                },
                                null
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "response_format 不符合模型支持范围；json_schema 仅支持 DeepSeek 的非空 schema 对象，严格子集待官方核验"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.messages"
                    },
                    {
                      "$map": {
                        "from": {
                          "$ref": "bindings.messages"
                        },
                        "as": "v",
                        "in": {
                          "$ref": "v"
                        }
                      }
                    }
                  ]
                },
                {
                  "$gt": [
                    {
                      "$len": {
                        "$ref": "bindings.messages"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "文本或 Agent 请求缺少有效 messages 数组"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "bindings.messages"
                      },
                      "as": "m",
                      "where": {
                        "$not": {
                          "$and": [
                            {
                              "$in": [
                                {
                                  "$ref": "m.role"
                                },
                                [
                                  "system",
                                  "user",
                                  "assistant",
                                  "tool"
                                ]
                              ]
                            },
                            {
                              "$or": [
                                {
                                  "$eq": [
                                    {
                                      "$ref": "m.content"
                                    },
                                    {
                                      "$toString": {
                                        "$ref": "m.content"
                                      }
                                    }
                                  ]
                                },
                                {
                                  "$and": [
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "m.role"
                                        },
                                        "assistant"
                                      ]
                                    },
                                    {
                                      "$gt": [
                                        {
                                          "$len": {
                                            "$ref": "m.tool_calls"
                                          }
                                        },
                                        0
                                      ]
                                    },
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "m.content"
                                        },
                                        null
                                      ]
                                    }
                                  ]
                                },
                                {
                                  "$and": [
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "m.content"
                                        },
                                        {
                                          "$map": {
                                            "from": {
                                              "$ref": "m.content"
                                            },
                                            "as": "v",
                                            "in": {
                                              "$ref": "v"
                                            }
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "$gt": [
                                        {
                                          "$len": {
                                            "$ref": "m.content"
                                          }
                                        },
                                        0
                                      ]
                                    },
                                    {
                                      "$eq": [
                                        {
                                          "$len": {
                                            "$filter": {
                                              "from": {
                                                "$ref": "m.content"
                                              },
                                              "as": "p",
                                              "where": {
                                                "$not": {
                                                  "$or": [
                                                    {
                                                      "$and": [
                                                        {
                                                          "$eq": [
                                                            {
                                                              "$ref": "p.type"
                                                            },
                                                            "text"
                                                          ]
                                                        },
                                                        {
                                                          "$eq": [
                                                            {
                                                              "$ref": "p.text"
                                                            },
                                                            {
                                                              "$toString": {
                                                                "$ref": "p.text"
                                                              }
                                                            }
                                                          ]
                                                        }
                                                      ]
                                                    },
                                                    {
                                                      "$and": [
                                                        {
                                                          "$eq": [
                                                            {
                                                              "$ref": "p.type"
                                                            },
                                                            "image_url"
                                                          ]
                                                        },
                                                        {
                                                          "$eq": [
                                                            {
                                                              "$ref": "m.role"
                                                            },
                                                            "user"
                                                          ]
                                                        },
                                                        {
                                                          "$not": {
                                                            "$eq": [
                                                              {
                                                                "$ref": "request.model"
                                                              },
                                                              "glm-5.3"
                                                            ]
                                                          }
                                                        },
                                                        {
                                                          "$or": [
                                                            {
                                                              "$and": [
                                                                {
                                                                  "$eq": [
                                                                    {
                                                                      "$countMatches": [
                                                                        {
                                                                          "$ref": "p.image_url.url"
                                                                        },
                                                                        "^https?://[^\\s]+$"
                                                                      ]
                                                                    },
                                                                    1
                                                                  ]
                                                                },
                                                                {
                                                                  "$not": {
                                                                    "$eq": [
                                                                      {
                                                                        "$ref": "request.model"
                                                                      },
                                                                      "kimi-k3"
                                                                    ]
                                                                  }
                                                                }
                                                              ]
                                                            },
                                                            {
                                                              "$and": [
                                                                {
                                                                  "$gt": [
                                                                    {
                                                                      "$len": {
                                                                        "$dataPayload": {
                                                                          "$ref": "p.image_url.url"
                                                                        }
                                                                      }
                                                                    },
                                                                    0
                                                                  ]
                                                                },
                                                                {
                                                                  "$eq": [
                                                                    {
                                                                      "$countMatches": [
                                                                        {
                                                                          "$ref": "p.image_url.url"
                                                                        },
                                                                        "^data:image/(jpeg|png|webp|gif|bmp|heic|heif);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
                                                                      ]
                                                                    },
                                                                    1
                                                                  ]
                                                                },
                                                                {
                                                                  "$in": [
                                                                    {
                                                                      "$dataMime": {
                                                                        "$ref": "p.image_url.url"
                                                                      }
                                                                    },
                                                                    {
                                                                      "$if": {
                                                                        "condition": {
                                                                          "$or": [
                                                                            {
                                                                              "$eq": [
                                                                                {
                                                                                  "$ref": "request.model"
                                                                                },
                                                                                "sensenova-6.8-flash"
                                                                              ]
                                                                            },
                                                                            {
                                                                              "$eq": [
                                                                                {
                                                                                  "$ref": "request.model"
                                                                                },
                                                                                "sensenova-6.8-flash-lite"
                                                                              ]
                                                                            }
                                                                          ]
                                                                        },
                                                                        "then": [
                                                                          "image/jpeg",
                                                                          "image/png",
                                                                          "image/webp"
                                                                        ],
                                                                        "else": {
                                                                          "$if": {
                                                                            "condition": {
                                                                              "$eq": [
                                                                                {
                                                                                  "$ref": "request.model"
                                                                                },
                                                                                "deepseek-flash"
                                                                              ]
                                                                            },
                                                                            "then": [
                                                                              "image/jpeg",
                                                                              "image/png",
                                                                              "image/gif",
                                                                              "image/webp"
                                                                            ],
                                                                            "else": [
                                                                              "image/jpeg",
                                                                              "image/png",
                                                                              "image/webp",
                                                                              "image/gif",
                                                                              "image/bmp",
                                                                              "image/heic",
                                                                              "image/heif"
                                                                            ]
                                                                          }
                                                                        }
                                                                      }
                                                                    }
                                                                  ]
                                                                }
                                                              ]
                                                            }
                                                          ]
                                                        }
                                                      ]
                                                    }
                                                  ]
                                                }
                                              }
                                            }
                                          }
                                        },
                                        0
                                      ]
                                    }
                                  ]
                                }
                              ]
                            },
                            {
                              "$or": [
                                {
                                  "$ne": [
                                    {
                                      "$ref": "m.role"
                                    },
                                    "tool"
                                  ]
                                },
                                {
                                  "$and": [
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "m.tool_call_id"
                                        },
                                        {
                                          "$toString": {
                                            "$ref": "m.tool_call_id"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "$gt": [
                                        {
                                          "$len": {
                                            "$ref": "m.tool_call_id"
                                          }
                                        },
                                        0
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "消息角色、内容块或工具结果无效；仅 user 可含图片，GLM 禁止图片，Kimi 图片须 Data URL，视频/音频不支持"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.tools"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.tools"
                        },
                        {
                          "$map": {
                            "from": {
                              "$ref": "bindings.options.tools"
                            },
                            "as": "v",
                            "in": {
                              "$ref": "v"
                            }
                          }
                        }
                      ]
                    },
                    {
                      "$or": [
                        {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "glm-5.3"
                            ]
                          }
                        },
                        {
                          "$lte": [
                            {
                              "$len": {
                                "$ref": "bindings.options.tools"
                              }
                            },
                            128
                          ]
                        }
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$filter": {
                              "from": {
                                "$ref": "bindings.options.tools"
                              },
                              "as": "t",
                              "where": {
                                "$not": {
                                  "$and": [
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "t.type"
                                        },
                                        "function"
                                      ]
                                    },
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "t.function"
                                        },
                                        {
                                          "$merge": [
                                            {
                                              "$ref": "t.function"
                                            }
                                          ]
                                        }
                                      ]
                                    },
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "t.function.name"
                                        },
                                        {
                                          "$toString": {
                                            "$ref": "t.function.name"
                                          }
                                        }
                                      ]
                                    },
                                    {
                                      "$gt": [
                                        {
                                          "$len": {
                                            "$ref": "t.function.name"
                                          }
                                        },
                                        0
                                      ]
                                    },
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "t.function.parameters"
                                        },
                                        {
                                          "$merge": [
                                            {
                                              "$ref": "t.function.parameters"
                                            }
                                          ]
                                        }
                                      ]
                                    },
                                    {
                                      "$or": [
                                        {
                                          "$not": {
                                            "$eq": [
                                              {
                                                "$ref": "request.model"
                                              },
                                              "glm-5.3"
                                            ]
                                          }
                                        },
                                        {
                                          "$and": [
                                            {
                                              "$eq": [
                                                {
                                                  "$countMatches": [
                                                    {
                                                      "$ref": "t.function.name"
                                                    },
                                                    "^[A-Za-z0-9_-]{1,64}$"
                                                  ]
                                                },
                                                1
                                              ]
                                            },
                                            {
                                              "$eq": [
                                                {
                                                  "$ref": "t.function.description"
                                                },
                                                {
                                                  "$toString": {
                                                    "$ref": "t.function.description"
                                                  }
                                                }
                                              ]
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              }
                            }
                          }
                        },
                        0
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "tools 必须是 function 工具数组；GLM 最多 128 项，名称 1–64 字符且 description/parameters 必填"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.tool_choice"
                    },
                    null
                  ]
                },
                {
                  "$or": [
                    {
                      "$in": [
                        {
                          "$ref": "bindings.options.tool_choice"
                        },
                        [
                          "auto",
                          "none",
                          "required"
                        ]
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "glm-5.3"
                            ]
                          }
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.tool_choice"
                            },
                            {
                              "type": "function",
                              "function": {
                                "name": {
                                  "$ref": "bindings.options.tool_choice.function.name"
                                }
                              }
                            }
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$ref": "bindings.options.tool_choice.function.name"
                            },
                            {
                              "$toString": {
                                "$ref": "bindings.options.tool_choice.function.name"
                              }
                            }
                          ]
                        },
                        {
                          "$gt": [
                            {
                              "$len": {
                                "$ref": "bindings.options.tool_choice.function.name"
                              }
                            },
                            0
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "tool_choice 必须是支持的策略或指定函数；GLM 未声明对象形式"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.max_tokens"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.max_tokens"
                        },
                        {
                          "$toInt": {
                            "$ref": "bindings.options.max_tokens"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.options.max_tokens"
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.options.max_tokens"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "kimi-k3"
                              ]
                            },
                            "then": 1048576,
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "sensenova-6.8-flash-lite"
                                  ]
                                },
                                "then": 65536,
                                "else": {
                                  "$if": {
                                    "condition": {
                                      "$eq": [
                                        {
                                          "$ref": "request.model"
                                        },
                                        "deepseek-flash"
                                      ]
                                    },
                                    "then": 393216,
                                    "else": 131072
                                  }
                                }
                              }
                            }
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "max_tokens 必须是所选模型允许范围内的正整数"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.max_completion_tokens"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.options.max_completion_tokens"
                        },
                        {
                          "$toInt": {
                            "$ref": "bindings.options.max_completion_tokens"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "bindings.options.max_completion_tokens"
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.options.max_completion_tokens"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.model"
                                },
                                "kimi-k3"
                              ]
                            },
                            "then": 1048576,
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.model"
                                    },
                                    "sensenova-6.8-flash-lite"
                                  ]
                                },
                                "then": 65536,
                                "else": {
                                  "$if": {
                                    "condition": {
                                      "$eq": [
                                        {
                                          "$ref": "request.model"
                                        },
                                        "deepseek-flash"
                                      ]
                                    },
                                    "then": 393216,
                                    "else": 131072
                                  }
                                }
                              }
                            }
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "max_completion_tokens 必须是所选模型允许范围内的正整数"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.tool_stream"
                    },
                    null
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "bindings.options.tool_stream"
                    },
                    false
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "bindings.stream"
                    },
                    true
                  ]
                }
              ]
            },
            "message": "tool_stream=true 须同时启用 stream=true"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/chat/completions",
          "contentType": "application/json",
          "body": {
            "$ref": "bindings.body"
          }
        },
        "agent": {
          "method": "POST",
          "path": "/chat/completions",
          "contentType": "application/json",
          "body": {
            "$ref": "bindings.body"
          }
        },
        "response": {
          "status": {
            "$if": {
              "condition": {
                "$in": [
                  {
                    "$ref": "response.choices.0.finish_reason"
                  },
                  [
                    "length",
                    "content_filter"
                  ]
                ]
              },
              "then": "failed",
              "else": "succeeded"
            }
          },
          "message": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.choices.0.finish_reason"
                      },
                      "length"
                    ]
                  },
                  "then": "SenseNova 输出达到 Token 或上下文上限，内容已截断，请提高输出上限后重试"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.choices.0.finish_reason"
                      },
                      "content_filter"
                    ]
                  },
                  "then": "SenseNova 安全过滤拦截了输出，请调整输入后重试"
                }
              ],
              "default": {
                "$ref": "response.error.message"
              }
            }
          },
          "textPaths": [
            "choices.0.message.content"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning",
            "choices.0.message.reasoning_content"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error"
          ],
          "messagePaths": [
            "error.message"
          ]
        },
        "agentResponse": {
          "textPaths": [
            "choices.0.message.content"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning",
            "choices.0.message.reasoning_content"
          ],
          "toolCallsPath": "choices.0.message.tool_calls",
          "toolCallIdPaths": [
            "id"
          ],
          "toolCallNamePaths": [
            "function.name"
          ],
          "toolCallArgumentsPaths": [
            "function.arguments"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
