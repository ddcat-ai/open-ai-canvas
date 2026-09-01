import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const scopes = ["admin.system-channel", "user.custom-channel", "canvas", "creation", "agent"];
const ref = (path) => ({ $ref: path });
const omit = (value) => ({ $omitEmpty: value });
const coalesce = (...values) => ({ $coalesce: values });
const map = (from, as, body) => ({ $map: { from, as, in: body } });
const filter = (from, as, where) => ({ $filter: { from, as, where } });
const eq = (left, right) => ({ $eq: [left, right] });
const ne = (left, right) => ({ $ne: [left, right] });
const gt = (left, right) => ({ $gt: [left, right] });
const len = (value) => ({ $len: value });
const conditional = (condition, thenValue, elseValue = null) => ({ $if: { condition, then: thenValue, else: elseValue } });
const first = (value) => ({ $first: value });
const sorted = (value) => ({ $sortByOrder: value });
const mediaWithRoles = (path, roles) => filter(sorted(ref(path)), "media", { $in: [ref("media.role"), roles] });
const firstMediaWithRoles = (path, roles) => first(mediaWithRoles(path, roles));
const firstMediaFieldWithRoles = (path, roles, field) => first(map(mediaWithRoles(path, roles), "media", ref(`media.${field}`)));

const textParams = [
  ["model", "string", true, "model", "上游模型 ID。"],
  ["messages", "message[]", true, "provider message container", "包含历史消息和当前用户输入。"],
  ["instructions", "string", false, "system/instructions", "系统指令。"],
  ["temperature", "number", false, "temperature", "采样温度。"],
  ["top_p", "number", false, "top_p", "核采样参数。"],
  ["max_tokens", "integer", false, "max_tokens/max_output_tokens", "最大输出 token。"],
  ["tools", "array", false, "tools/toolConfig", "工具定义。"],
  ["tool_choice", "object|string", false, "tool_choice", "工具选择策略。"],
  ["response_format", "object", false, "response_format/text", "结构化输出配置。"],
  ["stream", "boolean", false, "stream", "流式开关；后台任务当前以最终响应归一。"]
];

const imageParams = [
  ["model", "string", true, "model", "图片模型 ID。"],
  ["prompt", "string", true, "prompt", "图片提示词。"],
  ["images", "media[]", false, "provider image/reference fields", "参考图或编辑源图，role 由业务层确定。"],
  ["imageCount", "integer", false, "n/sample_count", "输出数量。"],
  ["aspectRatio", "string", false, "size/aspect_ratio", "比例或尺寸，语义按协议说明。"],
  ["resolution", "string", false, "resolution/imageSize", "分辨率档位。"],
  ["quality", "string", false, "quality", "质量档位。"],
  ["providerOptions", "object", false, "provider-specific fields", "插件命名空间内的厂商扩展字段。"]
];

const videoParams = [
  ["model", "string", true, "model", "视频模型 ID。"],
  ["prompt", "string", true, "prompt/content/input", "视频提示词。"],
  ["images", "media[]", false, "first/last/reference image", "显式 role 图片输入。"],
  ["videos", "media[]", false, "reference video", "参考视频。"],
  ["audios", "media[]", false, "reference audio/voice", "参考音频或音色。"],
  ["duration", "integer", false, "duration/seconds", "时长秒数。"],
  ["aspectRatio", "string", false, "ratio/aspect_ratio/size", "画幅比例或尺寸。"],
  ["resolution", "string", false, "resolution", "分辨率档位。"],
  ["generateAudio", "boolean", false, "generate_audio", "是否生成音频。"],
  ["watermark", "boolean", false, "watermark", "水印开关。"],
  ["providerOptions", "object", false, "provider-specific fields", "插件命名空间内的厂商扩展字段。"]
];

const parameters = (items) => items.map(([name, type, required, mapping, description]) => ({ name, type, required, mapping, description }));
const config = (extra = []) => ({
  fields: [
    { name: "apiKey", type: "secret", label: "API Key", required: true },
    ...extra
  ]
});
const bearer = { type: "bearer", field: "apiKey" };
const jsonCreate = (path, body, extra = {}) => ({ method: "POST", path, contentType: "application/json", body, ...extra });
const asyncResponse = (kind, overrides = {}) => ({
  taskId: coalesce(ref("response.id"), ref("response.task_id"), ref("response.taskId"), ref("response.data.id"), ref("taskId")),
  status: coalesce(ref("response.status"), ref("response.state"), ref("response.data.status"), "pending"),
  message: coalesce(ref("response.error.message"), ref("response.message"), ref("response.fail_reason")),
  [kind + "s"]: coalesce(ref(`response.${kind}_url`), ref(`response.${kind}Url`), ref("response.result_url"), ref("response.url"), ref(`response.data.${kind}_url`), ref("response.output.url")),
  errorPaths: ["error.code"],
  resultEphemeral: true,
  ...overrides
});

const specs = [];

function add(spec) {
  specs.push(spec);
}

add({
  id: "openai-chat-completions", providerId: "chat-completion", name: "OpenAI Chat Completions", vendor: "OpenAI", capability: "text",
  baseUrl: "https://api.openai.com", auth: bearer, params: textParams,
  create: jsonCreate("/v1/chat/completions", {
    model: ref("request.model"), messages: ref("request.messages"),
    temperature: omit(ref("request.providerOptions.chat-completion.temperature")),
    top_p: omit(ref("request.providerOptions.chat-completion.top_p")),
    max_tokens: omit(coalesce(ref("request.extra.max_tokens"), ref("request.providerOptions.chat-completion.max_tokens"))),
    tools: omit(ref("request.providerOptions.chat-completion.tools")),
    tool_choice: omit(ref("request.providerOptions.chat-completion.tool_choice")),
    response_format: omit(ref("request.providerOptions.chat-completion.response_format")),
    stream: omit(ref("request.providerOptions.chat-completion.stream")),
    stop: omit(ref("request.providerOptions.chat-completion.stop")),
    seed: omit(ref("request.providerOptions.chat-completion.seed")),
    frequency_penalty: omit(ref("request.providerOptions.chat-completion.frequency_penalty")),
    presence_penalty: omit(ref("request.providerOptions.chat-completion.presence_penalty")),
    logprobs: omit(ref("request.providerOptions.chat-completion.logprobs")),
    top_logprobs: omit(ref("request.providerOptions.chat-completion.top_logprobs")),
    user: omit(ref("request.providerOptions.chat-completion.user"))
  }),
  agent: jsonCreate("/v1/chat/completions", { $merge: [ref("request.extra.agent.chatCompletion"), { model: ref("request.model") }] }),
  agentResponse: { textPaths: ["choices.0.message.content", "choices.0.text"], reasoningPaths: ["choices.0.message.reasoning_content"], toolCallsPath: "choices.0.message.tool_calls", toolCallIdPaths: ["id"], toolCallNamePaths: ["function.name"], toolCallArgumentsPaths: ["function.arguments"] },
  response: { status: "succeeded", textPaths: ["choices.0.message.content", "choices.0.text"], reasoningPaths: ["choices.0.message.reasoning_content"], usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "openai-responses", providerId: "openai-response", name: "OpenAI Responses", vendor: "OpenAI", capability: "text",
  baseUrl: "https://api.openai.com", auth: bearer, params: textParams,
  create: jsonCreate("/v1/responses", {
    model: ref("request.model"), input: ref("request.messages"), instructions: omit(ref("request.instructions")),
    temperature: omit(ref("request.providerOptions.openai-response.temperature")),
    top_p: omit(ref("request.providerOptions.openai-response.top_p")),
    max_output_tokens: omit(coalesce(ref("request.extra.max_output_tokens"), ref("request.providerOptions.openai-response.max_output_tokens"))),
    tools: omit(ref("request.providerOptions.openai-response.tools")), tool_choice: omit(ref("request.providerOptions.openai-response.tool_choice")),
    text: omit(ref("request.providerOptions.openai-response.text")), reasoning: omit(ref("request.providerOptions.openai-response.reasoning")),
    previous_response_id: omit(ref("request.providerOptions.openai-response.previous_response_id")),
    store: omit(ref("request.providerOptions.openai-response.store")), metadata: omit(ref("request.providerOptions.openai-response.metadata")),
    stream: omit(ref("request.providerOptions.openai-response.stream")), truncation: omit(ref("request.providerOptions.openai-response.truncation")),
    user: omit(ref("request.providerOptions.openai-response.user"))
  }),
  agent: jsonCreate("/v1/responses", { $merge: [ref("request.extra.agent.responses"), { model: ref("request.model") }] }),
  agentResponse: { textPaths: ["output_text"], reasoningPaths: ["reasoning.summary.0.text"], toolCallsPath: "output", toolCallIdPaths: ["call_id", "id"], toolCallNamePaths: ["name"], toolCallArgumentsPaths: ["arguments"] },
  response: { status: "succeeded", textPaths: ["output_text"], reasoningPaths: ["reasoning.summary.0.text"], usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "anthropic-messages", providerId: "claude-api", name: "Anthropic Messages", vendor: "Anthropic", capability: "text",
  baseUrl: "https://api.anthropic.com", auth: { type: "anthropic", field: "apiKey" }, params: textParams,
  create: jsonCreate("/v1/messages", {
    model: ref("request.model"),
    max_tokens: coalesce(ref("request.extra.max_tokens"), ref("request.providerOptions.claude-api.max_tokens"), 4096),
    system: omit(coalesce(ref("request.instructions"), ref("request.providerOptions.claude-api.system"))),
    messages: filter(ref("request.messages"), "message", ne(ref("message.role"), "system")),
    temperature: omit(ref("request.providerOptions.claude-api.temperature")), top_p: omit(ref("request.providerOptions.claude-api.top_p")),
    top_k: omit(ref("request.providerOptions.claude-api.top_k")), stop_sequences: omit(ref("request.providerOptions.claude-api.stop_sequences")),
    tools: omit(ref("request.providerOptions.claude-api.tools")), tool_choice: omit(ref("request.providerOptions.claude-api.tool_choice")),
    metadata: omit(ref("request.providerOptions.claude-api.metadata")), stream: omit(ref("request.providerOptions.claude-api.stream")),
    thinking: omit(ref("request.providerOptions.claude-api.thinking")), service_tier: omit(ref("request.providerOptions.claude-api.service_tier"))
  }, { headers: { "anthropic-version": coalesce(ref("request.providerOptions.claude-api.anthropic-version"), "2023-06-01"), "anthropic-beta": omit(ref("request.providerOptions.claude-api.anthropic-beta")) } }),
  agent: jsonCreate("/v1/messages", { $merge: [ref("request.extra.agent.claude"), { model: ref("request.model") }] }, { headers: { "anthropic-version": "2023-06-01" } }),
  agentResponse: { textPaths: ["content.0.text"], reasoningPaths: ["content.0.thinking"], toolCallsPath: "content", toolCallIdPaths: ["id"], toolCallNamePaths: ["name"], toolCallArgumentsPaths: ["input"] },
  response: {
    status: "succeeded",
    text: map(filter(ref("response.content"), "part", eq(ref("part.type"), "text")), "part", ref("part.text")),
    reasoning: map(filter(ref("response.content"), "part", eq(ref("part.type"), "thinking")), "part", ref("part.thinking")),
    usage: ref("response.usage"), errorPaths: ["error.type"], messagePaths: ["error.message"]
  }
});

add({
  id: "google-gemini-generate-content", providerId: "gemini-generate-content", name: "Google Gemini generateContent", vendor: "Google", capability: "text",
  baseUrl: "https://generativelanguage.googleapis.com", auth: { type: "google-api-key", field: "apiKey" }, params: textParams,
  create: jsonCreate("/v1beta/models/{{model}}:generateContent", {
    contents: map(ref("request.messages"), "message", {
      role: conditional(eq(ref("message.role"), "assistant"), "model", "user"),
      parts: [{ text: ref("message.content") }]
    }),
    systemInstruction: conditional(ref("request.instructions"), { parts: [{ text: ref("request.instructions") }] }),
    generationConfig: omit(ref("request.providerOptions.gemini-generate-content.generationConfig")),
    safetySettings: omit(ref("request.providerOptions.gemini-generate-content.safetySettings")),
    tools: omit(ref("request.providerOptions.gemini-generate-content.tools")),
    toolConfig: omit(ref("request.providerOptions.gemini-generate-content.toolConfig")),
    cachedContent: omit(ref("request.providerOptions.gemini-generate-content.cachedContent"))
  }),
  agent: jsonCreate("/v1beta/models/{{model}}:generateContent", ref("request.extra.agent.gemini")),
  agentResponse: { textPaths: ["candidates.0.content.parts.0.text"], toolCallsPath: "candidates.0.content.parts", toolCallIdPaths: ["functionCall.id"], toolCallNamePaths: ["functionCall.name"], toolCallArgumentsPaths: ["functionCall.args"], toolCallThoughtSignaturePaths: ["thoughtSignature", "thought_signature"] },
  response: { status: "succeeded", text: map(ref("response.candidates.0.content.parts"), "part", omit(ref("part.text"))), usage: ref("response.usageMetadata"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "cohere-chat-v2", providerId: "cohere-chat-v2", name: "Cohere Chat v2", vendor: "Cohere", capability: "text",
  baseUrl: "https://api.cohere.com", auth: bearer, params: textParams,
  create: jsonCreate("/v2/chat", {
    model: ref("request.model"), messages: ref("request.messages"),
    temperature: omit(ref("request.providerOptions.cohere-chat-v2.temperature")), max_tokens: omit(ref("request.extra.max_tokens")),
    stop_sequences: omit(ref("request.providerOptions.cohere-chat-v2.stop_sequences")), tools: omit(ref("request.providerOptions.cohere-chat-v2.tools")),
    tool_choice: omit(ref("request.providerOptions.cohere-chat-v2.tool_choice")), response_format: omit(ref("request.providerOptions.cohere-chat-v2.response_format")),
    documents: omit(ref("request.providerOptions.cohere-chat-v2.documents")), citation_options: omit(ref("request.providerOptions.cohere-chat-v2.citation_options")),
    safety_mode: omit(ref("request.providerOptions.cohere-chat-v2.safety_mode")), seed: omit(ref("request.providerOptions.cohere-chat-v2.seed")), stream: omit(ref("request.providerOptions.cohere-chat-v2.stream"))
  }),
  response: { status: "succeeded", textPaths: ["message.content.0.text", "text"], usage: ref("response.usage"), errorPaths: ["error.type"], messagePaths: ["message"] }
});

add({
  id: "ollama-chat", providerId: "ollama-chat", name: "Ollama Chat", vendor: "Ollama", capability: "text",
  baseUrl: "http://127.0.0.1:11434", auth: { type: "none", field: "apiKey" }, params: textParams,
  create: jsonCreate("/api/chat", {
    model: ref("request.model"), messages: ref("request.messages"), stream: false,
    format: omit(ref("request.providerOptions.ollama-chat.format")), options: omit(ref("request.providerOptions.ollama-chat.options")),
    keep_alive: omit(ref("request.providerOptions.ollama-chat.keep_alive")), tools: omit(ref("request.providerOptions.ollama-chat.tools")),
    think: omit(ref("request.providerOptions.ollama-chat.think"))
  }),
  response: { status: "succeeded", textPaths: ["message.content", "response"], reasoningPaths: ["message.thinking", "thinking"], errorPaths: ["error"], messagePaths: ["error"] }
});

for (const [id, name, vendor, baseUrl] of [
  ["xai-grok-chat", "xAI Grok Chat", "xAI", "https://api.x.ai"],
  ["deepseek-chat", "DeepSeek Chat", "DeepSeek", "https://api.deepseek.com"],
  ["mistral-chat", "Mistral Chat", "Mistral AI", "https://api.mistral.ai"],
  ["kimi-chat", "Kimi OpenAI-Compatible", "Moonshot AI", "https://api.moonshot.cn"],
  ["zhipu-glm-chat", "智谱 GLM Chat", "Zhipu AI", "https://open.bigmodel.cn/api/paas"],
  ["baichuan-chat", "百川 Chat", "Baichuan", "https://api.baichuan-ai.com"],
  ["yi-chat", "零一万物 Yi Chat", "01.AI", "https://api.lingyiwanwu.com"],
  ["siliconflow-chat", "SiliconFlow Chat", "SiliconFlow", "https://api.siliconflow.cn"],
  ["together-chat", "Together AI Chat", "Together AI", "https://api.together.xyz"],
  ["groq-chat", "Groq Chat", "Groq", "https://api.groq.com/openai"],
  ["fireworks-chat", "Fireworks Chat", "Fireworks AI", "https://api.fireworks.ai/inference"],
  ["nvidia-nim-chat", "NVIDIA NIM Chat", "NVIDIA", "https://integrate.api.nvidia.com"],
  ["openrouter-chat", "OpenRouter Chat", "OpenRouter", "https://openrouter.ai/api"],
  ["litellm-proxy-chat", "LiteLLM Proxy Chat", "LiteLLM", "http://127.0.0.1:4000"],
  ["newapi-chat", "NewAPI Chat", "NewAPI", "http://127.0.0.1:3000"],
  ["vllm-chat", "vLLM OpenAI-Compatible", "vLLM", "http://127.0.0.1:8000"],
  ["localai-chat", "LocalAI Chat", "LocalAI", "http://127.0.0.1:8080"]
]) {
  add({
    id, providerId: id, name, vendor, capability: "text", baseUrl, auth: bearer, params: textParams,
    notes: "该插件实现该平台公开的 OpenAI Chat Completions 线协议 profile；平台专有字段通过 providerOptions 命名空间透传，未声明支持的 OpenAI 字段仍由模型 capability profile 校验。",
    create: jsonCreate("/v1/chat/completions", {
      model: ref("request.model"), messages: ref("request.messages"),
      temperature: omit(ref(`request.providerOptions.${id}.temperature`)), top_p: omit(ref(`request.providerOptions.${id}.top_p`)),
      max_tokens: omit(coalesce(ref("request.extra.max_tokens"), ref(`request.providerOptions.${id}.max_tokens`))),
      tools: omit(ref(`request.providerOptions.${id}.tools`)), tool_choice: omit(ref(`request.providerOptions.${id}.tool_choice`)),
      response_format: omit(ref(`request.providerOptions.${id}.response_format`)), stream: omit(ref(`request.providerOptions.${id}.stream`)),
      provider: omit(ref(`request.providerOptions.${id}.provider`)), transforms: omit(ref(`request.providerOptions.${id}.transforms`)),
      extra_body: omit(ref(`request.providerOptions.${id}.extra_body`))
    }),
    agent: jsonCreate("/v1/chat/completions", { $merge: [ref("request.extra.agent.chatCompletion"), { model: ref("request.model") }] }),
    agentResponse: { textPaths: ["choices.0.message.content", "choices.0.text"], reasoningPaths: ["choices.0.message.reasoning_content"], toolCallsPath: "choices.0.message.tool_calls", toolCallIdPaths: ["id"], toolCallNamePaths: ["function.name"], toolCallArgumentsPaths: ["function.arguments"] },
    response: { status: "succeeded", textPaths: ["choices.0.message.content", "choices.0.text"], reasoningPaths: ["choices.0.message.reasoning_content"], usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
  });
}

add({
  id: "xai-grok-images", providerId: "grok-image", name: "xAI Grok Images", vendor: "xAI", capability: "image",
  baseUrl: "https://api.x.ai", auth: bearer, params: imageParams,
  create: jsonCreate("/v1/images/generations", {
    model: ref("request.model"), prompt: ref("request.prompt"),
    image: conditional(gt(len(ref("request.images")), 0), { url: firstMediaFieldWithRoles("request.images", ["edit_source", "reference_image", ""], "value") }),
    n: conditional(gt(ref("request.imageCount"), 0), ref("request.imageCount"), 1),
    response_format: coalesce(ref("request.providerOptions.grok-image.response_format"), "url"),
    aspect_ratio: omit(ref("request.aspectRatio")), resolution: omit(coalesce(ref("request.resolution"), ref("request.quality"))),
    user: omit(ref("request.providerOptions.grok-image.user"))
  }),
  response: { status: "succeeded", images: map(ref("response.data"), "item", { url: omit(ref("item.url")), dataUrl: conditional(ref("item.b64_json"), { $concat: ["data:image/png;base64,", ref("item.b64_json")] }) }), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "volcengine-ark-seedream", providerId: "volcengine-ark-image", name: "Volcengine Ark Seedream Images", vendor: "Volcengine", capability: "image",
  baseUrl: "https://ark.cn-beijing.volces.com", auth: bearer, params: imageParams,
  create: jsonCreate("/api/v3/images/generations", {
    model: ref("request.model"), prompt: ref("request.prompt"), size: omit(ref("request.aspectRatio")),
    image: omit(map(ref("request.images"), "media", ref("media.value"))),
    sequential_image_generation: omit(ref("request.providerOptions.volcengine-ark-image.sequential_image_generation")),
    sequential_image_generation_options: omit(ref("request.providerOptions.volcengine-ark-image.sequential_image_generation_options")),
    watermark: ref("request.watermark"), seed: omit(ref("request.providerOptions.volcengine-ark-image.seed")),
    response_format: omit(ref("request.providerOptions.volcengine-ark-image.response_format"))
  }),
  response: { status: "succeeded", images: ref("response.data"), usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "google-gemini-image", providerId: "gemini-image", name: "Google Gemini Image", vendor: "Google", capability: "image",
  baseUrl: "https://generativelanguage.googleapis.com", auth: { type: "google-api-key", field: "apiKey" }, params: imageParams,
  create: jsonCreate("/v1beta/models/{{model}}:generateContent", {
    contents: [{ role: "user", parts: { $concatArrays: [
      [{ text: ref("request.prompt") }],
      map(ref("request.images"), "media", conditional(ref("media.dataUrl"), { inlineData: { mimeType: { $dataMime: ref("media.dataUrl") }, data: { $dataPayload: ref("media.dataUrl") } } }, { fileData: { mimeType: omit(ref("media.mimeType")), fileUri: ref("media.url") } }))
    ] } }],
    generationConfig: {
      responseModalities: coalesce(ref("request.providerOptions.gemini-image.responseModalities"), ["TEXT", "IMAGE"]),
      imageConfig: { aspectRatio: omit(ref("request.aspectRatio")), imageSize: omit(coalesce(ref("request.resolution"), ref("request.quality"))) },
      candidateCount: omit(ref("request.imageCount")), temperature: omit(ref("request.providerOptions.gemini-image.temperature")), topP: omit(ref("request.providerOptions.gemini-image.topP")), topK: omit(ref("request.providerOptions.gemini-image.topK")), seed: omit(ref("request.providerOptions.gemini-image.seed"))
    },
    safetySettings: omit(ref("request.providerOptions.gemini-image.safetySettings")), systemInstruction: omit(ref("request.providerOptions.gemini-image.systemInstruction"))
  }),
  response: {
    status: "succeeded",
    images: map(filter(ref("response.candidates.0.content.parts"), "part", { $or: [ref("part.inlineData"), ref("part.inline_data")] }), "part", {
      dataUrl: { $concat: ["data:", coalesce(ref("part.inlineData.mimeType"), ref("part.inline_data.mime_type"), "image/png"), ";base64,", coalesce(ref("part.inlineData.data"), ref("part.inline_data.data"))] }
    }),
    text: map(filter(ref("response.candidates.0.content.parts"), "part", ref("part.text")), "part", ref("part.text")),
    usage: ref("response.usageMetadata"), errorPaths: ["error.code"], messagePaths: ["error.message"]
  }
});

add({
  id: "volcengine-jimeng-image", providerId: "volcengine-jimeng-image", name: "Volcengine Jimeng Image", vendor: "Volcengine", capability: "image",
  baseUrl: "https://visual.volcengineapi.com", auth: { type: "volcengine-v4", field: "apiKey", secretField: "secretKey", service: "cv", region: "cn-north-1" }, params: imageParams,
  configuration: config([{ name: "secretKey", type: "secret", label: "Secret Key", required: true }]),
  create: jsonCreate("/", {
    req_key: ref("request.model"), prompt: ref("request.prompt"), image_urls: omit(map(ref("request.images"), "media", ref("media.value"))),
    seed: omit(ref("request.providerOptions.volcengine-jimeng-image.seed")), width: omit(ref("request.output.width")), height: omit(ref("request.output.height")),
    req_json: omit(ref("request.providerOptions.volcengine-jimeng-image.req_json"))
  }, { originPath: true, query: { Action: "CVSync2AsyncSubmitTask", Version: "2022-08-31" } }),
  poll: { method: "POST", path: "/", originPath: true, contentType: "application/json", query: { Action: "CVSync2AsyncGetResult", Version: "2022-08-31" }, body: { req_key: ref("request.model"), task_id: ref("taskId"), req_json: "{\"return_url\":true}" } },
  response: asyncResponse("image", { taskId: coalesce(ref("response.data.task_id"), ref("response.task_id"), ref("taskId")), status: coalesce(ref("response.data.status"), ref("response.status"), "pending"), images: coalesce(ref("response.data.image_urls"), ref("response.data.binary_data_base64")), errorPaths: ["code"], messagePaths: ["message"] })
});

add({
  id: "openai-videos", providerId: "newapi", name: "OpenAI Videos / Sora", vendor: "OpenAI", capability: "video",
  baseUrl: "https://api.openai.com", auth: bearer, params: videoParams, requiresPublicMediaUrls: false,
  create: {
    method: "POST", path: "/v1/videos", contentType: "multipart/form-data",
    body: {
      model: ref("request.model"), prompt: ref("request.prompt"), seconds: { $toString: ref("request.duration") },
      size: omit(ref("request.aspectRatio")), variants: omit(ref("request.providerOptions.newapi.variants"))
    },
    files: [{ name: "input_reference", source: first(filter(sorted(ref("request.images")), "media", ne(ref("media.role"), "mask"))), filename: "input-reference.png" }]
  },
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" },
  cancel: { method: "DELETE", path: "/v1/videos/{{taskId}}" },
  result: { method: "GET", path: "/v1/videos/{{taskId}}/content", headers: { Accept: "video/mp4" } },
  response: asyncResponse("video", { videos: coalesce(ref("response.url"), ref("response.video_url"), ref("response.output.url")), errorPaths: ["error.code"], messagePaths: ["error.message"] })
});

add({
  id: "newapi-media-task-v1", providerId: "newapi-channel-1", name: "NewAPI Media Task Channel 1", vendor: "NewAPI", capability: "video",
  baseUrl: "http://127.0.0.1:3000", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  create: jsonCreate("/v1/videos", {
    model: ref("request.model"),
    input: {
      prompt: ref("request.prompt"),
      media: omit({ $concatArrays: [
        map(sorted(ref("request.images")), "media", { type: coalesce(ref("media.role"), "reference_image"), url: ref("media.value") }),
        map(sorted(ref("request.videos")), "media", { type: coalesce(ref("media.role"), "reference_video"), url: ref("media.value") }),
        map(sorted(ref("request.audios")), "media", { type: coalesce(ref("media.role"), "reference_voice"), url: ref("media.value") })
      ] })
    },
    parameters: {
      resolution: coalesce(ref("request.resolution"), "720P"), ratio: coalesce(ref("request.aspectRatio"), "16:9"),
      duration: conditional(gt(ref("request.duration"), 0), ref("request.duration"), 5), watermark: ref("request.watermark"),
      prompt_extend: coalesce(ref("request.providerOptions.newapi-channel-1.prompt_extend"), false)
    }
  }),
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" }, response: asyncResponse("video")
});

add({
  id: "newapi-video-generations-v1", providerId: "newapi-channel-2", name: "NewAPI Video Generations Channel 2", vendor: "NewAPI", capability: "video",
  baseUrl: "http://127.0.0.1:3000", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  create: jsonCreate("/v1/video/generations", {
    model: ref("request.model"), prompt: ref("request.prompt"), seconds: { $toString: ref("request.duration") },
    aspect_ratio: coalesce(ref("request.aspectRatio"), "16:9"), resolution: omit(ref("request.resolution")), generate_audio: ref("request.generateAudio"),
    image_urls: omit(map({ $sortByOrder: ref("request.images") }, "media", ref("media.value"))),
    video_urls: omit(map({ $sortByOrder: ref("request.videos") }, "media", ref("media.value"))),
    audio_urls: omit(map({ $sortByOrder: ref("request.audios") }, "media", ref("media.value")))
  }),
  poll: { method: "GET", path: "/v1/video/generations/{{taskId}}" }, response: asyncResponse("video")
});

add({
  id: "rolldek-wan-video", providerId: "rolldek-wan-video", name: "RollDek WAN 3.0 Video", vendor: "RollDek", capability: "video",
  baseUrl: "https://rolldek.com", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  notes: "该协议严格对应 RollDek WAN 3.0 的 JSON /v1/videos 合同。RollDek 同时暴露的其他兼容创建入口不共享任务查询路径，不能与 NewAPI Video Generations Channel 2 混用。",
  create: jsonCreate("/v1/videos", {
    model: ref("request.model"), prompt: ref("request.prompt"), seconds: { $toString: ref("request.duration") },
    size: omit({ $upper: ref("request.resolution") }), aspect_ratio: omit(ref("request.aspectRatio")),
    reference_images: omit(map(sorted(ref("request.images")), "media", {
      url: ref("media.value"), role: coalesce(ref("media.role"), "reference_image")
    })),
    reference_videos: omit(map(sorted(ref("request.videos")), "media", {
      url: ref("media.value"), duration: omit({ $multiply: [ref("media.metadata.durationMs"), 0.001] })
    })),
    reference_audios: omit(map(sorted(ref("request.audios")), "media", { url: ref("media.value") }))
  }),
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" },
  result: { method: "GET", path: "/v1/videos/{{taskId}}/content", headers: { Accept: "video/mp4" } },
  response: asyncResponse("video", {
    videos: coalesce(ref("response.metadata.url"), ref("response.data.metadata.url"), ref("response.video_url"), ref("response.url")),
    errorPaths: ["error.code", "code"], messagePaths: ["error.message", "message", "fail_reason"]
  })
});

add({
  id: "xai-video", providerId: "xai-video", name: "xAI Video", vendor: "xAI", capability: "video",
  baseUrl: "https://api.x.ai", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [
    { assert: { $lte: [len(filter(ref("request.images"), "media", { $in: [ref("media.role"), ["first_frame", "last_frame"]] })), 1] }, message: "xAI Video 最多支持一个帧输入，当前 profile 不支持尾帧" },
    { assert: { $not: { $and: [gt(len(filter(ref("request.images"), "media", { $in: [ref("media.role"), ["first_frame", "last_frame"]] })), 0), gt(len(filter(ref("request.images"), "media", { $in: [ref("media.role"), ["reference_image", "subject_reference", "style_reference"]] })), 0)] } }, message: "xAI Video 不能同时混用起始帧和角色参考图" }
  ],
  create: jsonCreate("/v1/videos/generations", {
    model: ref("request.model"), prompt: ref("request.prompt"), duration: conditional(gt(ref("request.duration"), 0), ref("request.duration"), 6),
    aspect_ratio: coalesce(ref("request.aspectRatio"), "16:9"), resolution: coalesce(ref("request.resolution"), "720p"),
    image: conditional(gt(len(mediaWithRoles("request.images", ["first_frame", ""])), 0), { url: firstMediaFieldWithRoles("request.images", ["first_frame", ""], "value") }),
    reference_images: omit(map(filter(ref("request.images"), "media", { $in: [ref("media.role"), ["reference_image", "subject_reference", "style_reference"]] }), "media", { url: ref("media.value") }))
  }),
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" }, response: asyncResponse("video")
});

add({
  id: "google-gemini-veo", providerId: "gemini-veo", name: "Google Gemini Veo", vendor: "Google", capability: "video",
  baseUrl: "https://generativelanguage.googleapis.com", auth: { type: "google-api-key", field: "apiKey" }, params: videoParams,
  validations: [{ assert: { $eq: [len(filter(ref("request.images"), "media", eq(ref("media.role"), "reference_image"))), 0] }, message: "Gemini Veo 当前 profile 不支持角色参考图，请使用首帧输入或支持 reference_to_video 的协议" }],
  create: jsonCreate("/v1beta/models/{{model}}:predictLongRunning", {
    instances: [{
      prompt: ref("request.prompt"),
      image: conditional(gt(len(mediaWithRoles("request.images", ["first_frame", ""])), 0), conditional(firstMediaFieldWithRoles("request.images", ["first_frame", ""], "dataUrl"), { inlineData: { mimeType: { $dataMime: firstMediaFieldWithRoles("request.images", ["first_frame", ""], "dataUrl") }, data: { $dataPayload: firstMediaFieldWithRoles("request.images", ["first_frame", ""], "dataUrl") } } }, { fileUri: firstMediaFieldWithRoles("request.images", ["first_frame", ""], "url"), mimeType: omit(firstMediaFieldWithRoles("request.images", ["first_frame", ""], "mimeType")) }))
    }],
    parameters: {
      aspectRatio: omit(ref("request.aspectRatio")), durationSeconds: omit(ref("request.duration")), resolution: omit(ref("request.resolution")),
      generateAudio: ref("request.generateAudio"), sampleCount: omit(ref("request.imageCount")), negativePrompt: omit(ref("request.providerOptions.gemini-veo.negativePrompt")),
      personGeneration: omit(ref("request.providerOptions.gemini-veo.personGeneration")), seed: omit(ref("request.providerOptions.gemini-veo.seed"))
    }
  }),
  poll: { method: "GET", path: "/v1beta/{{taskId}}" },
  response: asyncResponse("video", { taskId: coalesce(ref("response.name"), ref("taskId")), status: conditional(ref("response.error"), "failed", conditional(ref("response.done"), "succeeded", "processing")), videos: coalesce(ref("response.response.generateVideoResponse.generatedSamples"), ref("response.response.generatedVideos"), ref("response.response.videos")), message: ref("response.error.message") })
});

add({
  id: "novita-video", providerId: "novita-video", name: "Novita Video", vendor: "Novita", capability: "video",
  baseUrl: "https://api.novita.ai", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [{ assert: { $eq: [len(filter(ref("request.images"), "media", eq(ref("media.role"), "reference_image"))), 0] }, message: "Novita Video 当前 profile 只支持起始图，不支持角色参考图" }],
  create: jsonCreate("/v3/video/create", {
    model_name: ref("request.model"), prompt: ref("request.prompt"), duration: conditional(gt(ref("request.duration"), 0), ref("request.duration"), 5),
    aspect_ratio: coalesce(ref("request.aspectRatio"), "16:9"), image_url: omit(firstMediaFieldWithRoles("request.images", ["first_frame", ""], "value")),
    seed: omit(ref("request.providerOptions.novita-video.seed")), negative_prompt: omit(ref("request.providerOptions.novita-video.negative_prompt"))
  }),
  poll: { method: "GET", path: "/v3/async/task-result", query: { task_id: ref("taskId") } }, response: asyncResponse("video")
});

add({
  id: "volcengine-jimeng-video", providerId: "volcengine-jimeng-video", name: "Volcengine Jimeng Video", vendor: "Volcengine", capability: "video",
  baseUrl: "https://visual.volcengineapi.com", auth: { type: "volcengine-v4", field: "apiKey", secretField: "secretKey", service: "cv", region: "cn-north-1" }, params: videoParams,
  configuration: config([{ name: "secretKey", type: "secret", label: "Secret Key", required: true }]),
  create: jsonCreate("/", {
    req_key: ref("request.model"), prompt: ref("request.prompt"), image_urls: omit(map({ $sortByOrder: ref("request.images") }, "media", ref("media.value"))),
    duration: omit(ref("request.duration")), ratio: omit(ref("request.aspectRatio")), resolution: omit(ref("request.resolution")),
    req_json: omit(ref("request.providerOptions.volcengine-jimeng-video.req_json"))
  }, { originPath: true, query: { Action: "CVSync2AsyncSubmitTask", Version: "2022-08-31" } }),
  poll: { method: "POST", path: "/", originPath: true, contentType: "application/json", query: { Action: "CVSync2AsyncGetResult", Version: "2022-08-31" }, body: { req_key: ref("request.model"), task_id: ref("taskId") } },
  response: asyncResponse("video", { taskId: coalesce(ref("response.data.task_id"), ref("response.task_id"), ref("taskId")), status: coalesce(ref("response.data.status"), ref("response.status"), "pending"), videos: coalesce(ref("response.data.video_urls"), ref("response.data.video_url")), errorPaths: ["code"], messagePaths: ["message"] })
});

const agnesFrameImages = mediaWithRoles("request.images", ["first_frame", "last_frame"]);
const agnesReferenceImages = mediaWithRoles("request.images", ["reference_image", "subject_reference", "style_reference"]);
const agnesReferenceMode = { $or: [gt(len(agnesReferenceImages), 0), gt(len(ref("request.videos")), 0), gt(len(ref("request.audios")), 0)] };

add({
  id: "agnes-video-25", providerId: "agnes-video", name: "Agnes Video 2.5 / 2.5 Flash", vendor: "Agnes AI", capability: "video",
  baseUrl: "https://apihub.agnes-ai.com/v1", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [
    { assert: { $in: [ref("request.model"), ["agnes-video-2.5", "agnes-video-2.5-flash"]] }, message: "Agnes 2.5 插件仅支持 agnes-video-2.5 与 agnes-video-2.5-flash" },
    { assert: { $and: [{ $gte: [ref("request.duration"), 4] }, { $lte: [ref("request.duration"), 12] }] }, message: "Agnes Video 2.5 时长必须在 4–12 秒之间" },
    { assert: { $in: [{ $upper: coalesce(ref("request.resolution"), "720P") }, ["720P", "960P", "2K"]] }, message: "Agnes Video 2.5 分辨率必须是 720P、960P 或 2K" },
    { assert: { $not: { $and: [gt(len(agnesFrameImages), 0), agnesReferenceMode] } }, message: "Agnes Video 2.5 不能同时混用首尾帧和角色、视频或音频参考素材" },
    { assert: { $or: [ne(ref("request.model"), "agnes-video-2.5-flash"), eq({ $upper: coalesce(ref("request.resolution"), "720P") }, "720P")] }, message: "Agnes Video 2.5 Flash 仅支持 720P" },
    { assert: { $or: [ne(ref("request.model"), "agnes-video-2.5-flash"), { $lte: [len(ref("request.images")), 5] }] }, message: "Agnes Video 2.5 Flash 最多支持 5 张参考图" },
    { assert: { $or: [ne(ref("request.model"), "agnes-video-2.5-flash"), eq(len(ref("request.videos")), 0)] }, message: "Agnes Video 2.5 Flash 不支持参考视频" }
  ],
  create: jsonCreate("/videos", {
    model: ref("request.model"), prompt: ref("request.prompt"),
    mode: conditional(agnesReferenceMode, "reference", conditional(gt(len(ref("request.images")), 0), "keyframe", "text")),
    seconds: { $toString: ref("request.duration") }, size: { $upper: coalesce(ref("request.resolution"), "720P") },
    aspect_ratio: coalesce(ref("request.aspectRatio"), "16:9"), n: coalesce(ref("request.output.count"), 1),
    first_frame: conditional({ $not: agnesReferenceMode }, omit(coalesce(firstMediaFieldWithRoles("request.images", ["first_frame"], "value"), first(map(sorted(ref("request.images")), "media", ref("media.value"))))), null),
    last_frame: conditional({ $not: agnesReferenceMode }, omit(firstMediaFieldWithRoles("request.images", ["last_frame"], "value")), null),
    images: conditional(agnesReferenceMode, omit(map(sorted(ref("request.images")), "media", ref("media.value"))), null),
    videos: conditional(agnesReferenceMode, omit(map(sorted(ref("request.videos")), "media", { url: ref("media.value") })), null),
    audios: conditional(agnesReferenceMode, omit(map(sorted(ref("request.audios")), "media", ref("media.value"))), null)
  }),
  poll: { method: "GET", path: "/agnesapi", originPath: true, query: { video_id: ref("taskId"), model_name: ref("request.model") } },
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.data.video_id"), ref("response.video_id"), ref("response.data.id"), ref("response.id"), ref("taskId")),
    status: coalesce(ref("response.data.status"), ref("response.status"), "pending"),
    videos: coalesce(ref("response.data.metadata.url"), ref("response.metadata.url"), ref("response.data.url"), ref("response.url")),
    message: coalesce(ref("response.data.error.message"), ref("response.error.message"), ref("response.message"), ref("response.detail"))
  })
});

add({
  id: "agnes-video-v20", providerId: "agnes-video-v20", name: "Agnes Video V2.0", vendor: "Agnes AI", capability: "video",
  baseUrl: "https://apihub.agnes-ai.com/v1", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [
    { assert: eq(ref("request.model"), "agnes-video-v2.0"), message: "Agnes Video V2.0 插件仅支持 agnes-video-v2.0" },
    { assert: eq(len(ref("request.videos")), 0), message: "Agnes Video V2.0 不支持参考视频" },
    { assert: eq(len(ref("request.audios")), 0), message: "Agnes Video V2.0 不支持参考音频" },
    { assert: eq(len(agnesReferenceImages), 0), message: "Agnes Video V2.0 不支持角色或风格参考图" },
    { assert: { $lte: [len(agnesFrameImages), 2] }, message: "Agnes Video V2.0 最多支持首帧和尾帧各一张" }
  ],
  create: jsonCreate("/videos", {
    model: ref("request.model"), prompt: ref("request.prompt"), frame_rate: 24,
    num_frames: { $min: [441, { $add: [{ $ceilStep: [{ $multiply: [coalesce(ref("request.duration"), 5), 24] }, 8] }, 1] }] },
    image: conditional(eq(len(agnesFrameImages), 1), firstMediaFieldWithRoles("request.images", ["first_frame", "last_frame"], "value")),
    extra_body: conditional(gt(len(agnesFrameImages), 1), { image: map(agnesFrameImages, "media", ref("media.value")), mode: "keyframes" })
  }),
  poll: { method: "GET", path: "/agnesapi", originPath: true, query: { video_id: ref("taskId"), model_name: ref("request.model") } },
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.data.video_id"), ref("response.video_id"), ref("response.data.id"), ref("response.id"), ref("taskId")),
    status: coalesce(ref("response.data.status"), ref("response.status"), "pending"),
    videos: coalesce(ref("response.data.metadata.url"), ref("response.metadata.url"), ref("response.data.url"), ref("response.url")),
    message: coalesce(ref("response.data.error.message"), ref("response.error.message"), ref("response.message"), ref("response.detail"))
  })
});

add({
  id: "stability-image", providerId: "stability-image", name: "Stability AI Image", vendor: "Stability AI", capability: "image",
  baseUrl: "https://api.stability.ai", auth: bearer, params: imageParams,
  create: {
    method: "POST",
    pathTemplate: coalesce(ref("request.providerOptions.stability-image.endpoint"), "/v2beta/stable-image/generate/core"),
    contentType: "multipart/form-data",
    headers: { Accept: "application/json" },
    body: {
      prompt: ref("request.prompt"), negative_prompt: omit(ref("request.providerOptions.stability-image.negative_prompt")),
      aspect_ratio: omit(ref("request.aspectRatio")), output_format: coalesce(ref("request.output.format"), ref("request.providerOptions.stability-image.output_format"), "png"),
      seed: omit(ref("request.providerOptions.stability-image.seed")), style_preset: omit(ref("request.providerOptions.stability-image.style_preset")),
      strength: omit(ref("request.providerOptions.stability-image.strength")), cfg_scale: omit(ref("request.providerOptions.stability-image.cfg_scale")),
      grow_mask: omit(ref("request.providerOptions.stability-image.grow_mask")), creativity: omit(ref("request.providerOptions.stability-image.creativity"))
    },
    files: [
      { name: "image", source: first(mediaWithRoles("request.images", ["edit_source", "reference_image", ""])), filename: "image.png" },
      { name: "mask", source: first(mediaWithRoles("request.images", ["mask"])), filename: "mask.png" }
    ]
  },
  response: {
    status: conditional(ref("response.errors"), "failed", "succeeded"),
    message: coalesce(ref("response.errors"), ref("response.message")),
    images: conditional(ref("response.image"), [
      { dataUrl: { $concat: ["data:", coalesce(ref("response.mime_type"), "image/png"), ";base64,", ref("response.image")] } }
    ]),
    errorPaths: ["errors"]
  }
});

add({
  id: "ideogram-image", providerId: "ideogram-image", name: "Ideogram Image", vendor: "Ideogram", capability: "image",
  baseUrl: "https://api.ideogram.ai", auth: { type: "header", field: "apiKey", header: "Api-Key" }, params: imageParams,
  create: {
    method: "POST", pathTemplate: coalesce(ref("request.providerOptions.ideogram-image.endpoint"), "/v1/ideogram-v3/generate"), contentType: "multipart/form-data",
    body: {
      prompt: ref("request.prompt"), negative_prompt: omit(ref("request.providerOptions.ideogram-image.negative_prompt")),
      aspect_ratio: omit(ref("request.aspectRatio")), resolution: omit(ref("request.resolution")), num_images: coalesce(ref("request.imageCount"), 1),
      rendering_speed: omit(ref("request.providerOptions.ideogram-image.rendering_speed")), style_type: omit(ref("request.providerOptions.ideogram-image.style_type")),
      magic_prompt: omit(ref("request.providerOptions.ideogram-image.magic_prompt")), seed: omit(ref("request.providerOptions.ideogram-image.seed")),
      color_palette: omit(ref("request.providerOptions.ideogram-image.color_palette")), character_reference_images_mask: omit(ref("request.providerOptions.ideogram-image.character_reference_images_mask"))
    },
    files: [
      { name: "image", source: first(mediaWithRoles("request.images", ["edit_source", "reference_image", "subject_reference", "style_reference", ""])), filename: "reference.png" },
      { name: "mask", source: first(mediaWithRoles("request.images", ["mask"])), filename: "mask.png" }
    ]
  },
  response: { status: "succeeded", images: coalesce(ref("response.data"), ref("response.images")), errorPaths: ["error.code"], messagePaths: ["error.message", "message"] }
});

add({
  id: "dashscope-wan-video", providerId: "dashscope-wan-video", name: "DashScope Wan Video", vendor: "Alibaba Cloud", capability: "video",
  baseUrl: "https://dashscope.aliyuncs.com", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [
    { assert: { $lte: [len(mediaWithRoles("request.images", ["first_frame"])), 1] }, message: "Wan 视频最多只能有一个首帧" },
    { assert: { $lte: [len(mediaWithRoles("request.images", ["last_frame"])), 1] }, message: "Wan 视频最多只能有一个尾帧" },
    { assert: { $or: [eq(len(mediaWithRoles("request.images", ["last_frame"])), 0), eq(len(mediaWithRoles("request.images", ["first_frame"])), 1)] }, message: "Wan 视频使用尾帧时必须同时提供首帧" }
  ],
  create: jsonCreate("/api/v1/services/aigc/video-generation/video-synthesis", {
    model: ref("request.model"),
    input: {
      prompt: ref("request.prompt"),
      negative_prompt: omit(ref("request.providerOptions.dashscope-wan-video.negative_prompt")),
      img_url: omit(conditional({ $and: [ne(ref("request.operation"), "reference_to_video"), eq(len(mediaWithRoles("request.images", ["last_frame"])), 0)] }, coalesce(firstMediaFieldWithRoles("request.images", ["first_frame"], "value"), firstMediaFieldWithRoles("request.images", ["reference_image", "edit_source", ""], "value")))),
      first_frame_url: omit(conditional(gt(len(mediaWithRoles("request.images", ["last_frame"])), 0), firstMediaFieldWithRoles("request.images", ["first_frame"], "value"))),
      last_frame_url: omit(firstMediaFieldWithRoles("request.images", ["last_frame"], "value")),
      reference_images: omit(conditional(eq(ref("request.operation"), "reference_to_video"), map(mediaWithRoles("request.images", ["reference_image", "subject_reference", "style_reference"]), "media", ref("media.value")))),
      video_url: omit(firstMediaFieldWithRoles("request.videos", ["reference_video", ""], "value")),
      audio_url: omit(firstMediaFieldWithRoles("request.audios", ["reference_audio", "reference_voice", ""], "value"))
    },
    parameters: {
      size: omit(ref("request.resolution")), duration: omit(ref("request.duration")),
      prompt_extend: omit(ref("request.providerOptions.dashscope-wan-video.prompt_extend")),
      watermark: ref("request.watermark"), seed: omit(ref("request.providerOptions.dashscope-wan-video.seed")),
      shot_type: omit(ref("request.providerOptions.dashscope-wan-video.shot_type")),
      audio: ref("request.generateAudio"), template: omit(ref("request.providerOptions.dashscope-wan-video.template"))
    }
  }, { headers: { "X-DashScope-Async": "enable" } }),
  poll: { method: "GET", path: "/api/v1/tasks/{{taskId}}" },
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.output.task_id"), ref("response.task_id"), ref("taskId")),
    status: coalesce(ref("response.output.task_status"), ref("response.status"), "pending"),
    videos: coalesce(ref("response.output.video_url"), ref("response.output.results"), ref("response.video_url")),
    usage: ref("response.usage"), errorPaths: ["code"], messagePaths: ["message", "output.message"]
  })
});

add({
  id: "dashscope-wanx-image", providerId: "dashscope-wanx-image", name: "DashScope Wanx Image", vendor: "Alibaba Cloud", capability: "image",
  baseUrl: "https://dashscope.aliyuncs.com", auth: bearer, params: imageParams, requiresPublicMediaUrls: true,
  create: jsonCreate("/api/v1/services/aigc/text2image/image-synthesis", {
    model: ref("request.model"),
    input: {
      prompt: ref("request.prompt"), negative_prompt: omit(ref("request.providerOptions.dashscope-wanx-image.negative_prompt")),
      ref_img: omit(conditional(eq(len(ref("request.images")), 1), firstMediaFieldWithRoles("request.images", ["edit_source", "reference_image", "subject_reference", "style_reference", ""], "value"))),
      ref_images: omit(conditional(gt(len(ref("request.images")), 1), map(sorted(ref("request.images")), "media", ref("media.value"))))
    },
    parameters: {
      size: omit(ref("request.aspectRatio")), n: coalesce(ref("request.imageCount"), 1),
      seed: omit(ref("request.providerOptions.dashscope-wanx-image.seed")), style: omit(ref("request.providerOptions.dashscope-wanx-image.style")),
      prompt_extend: omit(ref("request.providerOptions.dashscope-wanx-image.prompt_extend")), watermark: ref("request.watermark")
    }
  }, { headers: { "X-DashScope-Async": "enable" } }),
  poll: { method: "GET", path: "/api/v1/tasks/{{taskId}}" },
  response: asyncResponse("image", {
    taskId: coalesce(ref("response.output.task_id"), ref("response.task_id"), ref("taskId")),
    status: coalesce(ref("response.output.task_status"), ref("response.status"), "pending"),
    images: coalesce(ref("response.output.results"), ref("response.output.image_url")),
    usage: ref("response.usage"), errorPaths: ["code"], messagePaths: ["message", "output.message"]
  })
});

for (const [id, name, vendor, capability, baseUrl, createPath, pollPath, requestShape] of [
  ["dashscope-qwen-native", "DashScope Qwen Native", "Alibaba Cloud", "text", "https://dashscope.aliyuncs.com", "/api/v1/services/aigc/text-generation/generation", null, "input+parameters"],
  ["minimax-text-native", "MiniMax Text Native", "MiniMax", "text", "https://api.minimax.chat", "/v1/text/chatcompletion_v2", null, "messages+tokens_to_generate"],
  ["azure-openai", "Azure OpenAI", "Microsoft Azure", "text", "https://{resource}.openai.azure.com", "/openai/deployments/{{model}}/chat/completions", null, "OpenAI body + api-version query"],
  ["vertex-gemini", "Vertex AI Gemini", "Google Cloud", "text", "https://{location}-aiplatform.googleapis.com", "/v1/projects/{{request.providerOptions.vertex-gemini.project}}/locations/{{request.providerOptions.vertex-gemini.location}}/publishers/google/models/{{model}}:generateContent", null, "Gemini contents/parts"],
  ["aws-bedrock-converse", "AWS Bedrock Converse", "AWS", "text", "https://bedrock-runtime.{region}.amazonaws.com", "/model/{{model}}/converse", null, "messages+system+inferenceConfig+toolConfig"],
  ["aws-bedrock-invoke-model", "AWS Bedrock InvokeModel", "AWS", "text", "https://bedrock-runtime.{region}.amazonaws.com", "/model/{{model}}/invoke", null, "model-specific arbitrary body"],
  ["vertex-imagen", "Vertex Imagen", "Google Cloud", "image", "https://{location}-aiplatform.googleapis.com", "/v1/projects/{{request.providerOptions.vertex-imagen.project}}/locations/{{request.providerOptions.vertex-imagen.location}}/publishers/google/models/{{model}}:predict", null, "instances+parameters"],
  ["minimax-image", "MiniMax Image", "MiniMax", "image", "https://api.minimax.io", "/v1/image_generation", null, "model-specific image body"],
  ["kling-image", "Kling Image", "Kuaishou", "image", "https://api.klingai.com", "/v1/images/generations", "/v1/images/generations/{{taskId}}", "task JSON"],
  ["zhipu-cogview", "智谱 CogView", "Zhipu AI", "image", "https://open.bigmodel.cn/api/paas", "/v4/images/generations", null, "OpenAI-like image JSON"],
  ["bfl-flux", "Black Forest Labs FLUX", "Black Forest Labs", "image", "https://api.bfl.ai", "/v1/{{model}}", "/v1/get_result", "async model schema"],
  ["recraft-image", "Recraft Image", "Recraft", "image", "https://external.api.recraft.ai", "/v1/images/generations", null, "raster/vector image JSON"],
  ["adobe-firefly", "Adobe Firefly", "Adobe", "image", "https://firefly-api.adobe.io", "/v3/images/generate", null, "versioned Firefly request"],
  ["runway-image", "Runway Image", "Runway", "image", "https://api.dev.runwayml.com", "/v1/text_to_image", "/v1/tasks/{{taskId}}", "async Runway image schema"],
  ["vertex-veo", "Vertex AI Veo", "Google Cloud", "video", "https://{location}-aiplatform.googleapis.com", "/v1/projects/{{request.providerOptions.vertex-veo.project}}/locations/{{request.providerOptions.vertex-veo.location}}/publishers/google/models/{{model}}:predictLongRunning", "/v1/{{taskId}}", "Vertex long-running operation"],
  ["seedance-videos-compatible", "Seedance Compatible /videos", "Gateway profile", "video", "http://127.0.0.1:3000", "/v1/videos", "/v1/videos/{{taskId}}", "gateway-specific videos JSON"],
  ["kling-video", "Kling Video", "Kuaishou", "video", "https://api.klingai.com", "/v1/videos/generations", "/v1/videos/generations/{{taskId}}", "text/image/multi-image task"],
  ["runway-video", "Runway Video", "Runway", "video", "https://api.dev.runwayml.com", "/v1/image_to_video", "/v1/tasks/{{taskId}}", "promptImage+promptText+ratio+duration"],
  ["luma-dream-machine", "Luma Dream Machine", "Luma AI", "video", "https://api.lumalabs.ai", "/dream-machine/v1/generations", "/dream-machine/v1/generations/{{taskId}}", "prompt+keyframes"],
  ["vidu-video", "Vidu Video", "Vidu", "video", "https://api.vidu.com", "/v1/videos", "/v1/tasks/{{taskId}}", "text/image/reference video task"],
  ["pixverse-video", "PixVerse Video", "PixVerse", "video", "https://app-api.pixverse.ai", "/openapi/v2/video/text/generate", "/openapi/v2/video/result/{{taskId}}", "model+duration+quality+effect"],
  ["zhipu-cogvideox", "智谱 CogVideoX", "Zhipu AI", "video", "https://open.bigmodel.cn/api/paas", "/v4/videos/generations", "/v4/async-result/{{taskId}}", "model+prompt+image_url+quality+with_audio"],
  ["baidu-video", "百度千帆视频", "Baidu AI Cloud", "video", "https://qianfan.baidubce.com", "/v2/video/generations", "/v2/video/generations/{{taskId}}", "model-specific input"],
  ["tencent-hunyuan-video", "腾讯混元视频", "Tencent Cloud", "video", "https://hunyuan.tencentcloudapi.com", "/", "/", "TC3 Action task"],
  ["tencent-hunyuan-image", "腾讯混元图片", "Tencent Cloud", "image", "https://hunyuan.tencentcloudapi.com", "/", "/", "TC3 Action task"],
  ["baidu-qianfan-image", "百度千帆图片", "Baidu AI Cloud", "image", "https://qianfan.baidubce.com", "/v2/images/generations", null, "model-specific image input"]
]) {
  const params = capability === "text" ? textParams : capability === "image" ? imageParams : videoParams;
  const optionPath = `request.providerOptions.${id}`;
  const standardFields = capability === "text"
    ? { model: ref("request.model"), messages: ref("request.messages"), input: omit(ref("request.prompt")), parameters: omit(ref(`${optionPath}.parameters`)) }
    : capability === "image"
      ? { model: ref("request.model"), prompt: ref("request.prompt"), images: omit(map(ref("request.images"), "media", ref("media.value"))), parameters: omit(ref(`${optionPath}.parameters`)) }
      : { model: ref("request.model"), prompt: ref("request.prompt"), images: omit(map(ref("request.images"), "media", ref("media.value"))), videos: omit(map(ref("request.videos"), "media", ref("media.value"))), audios: omit(map(ref("request.audios"), "media", ref("media.value"))), duration: omit(ref("request.duration")), aspect_ratio: omit(ref("request.aspectRatio")), resolution: omit(ref("request.resolution")), parameters: omit(ref(`${optionPath}.parameters`)) };
  const standard = { $merge: [standardFields, coalesce(ref(`${optionPath}.body`), ref(`${optionPath}.extra_body`), {})] };
  let auth = bearer;
  let configuration;
  let operationExtra = id.startsWith("dashscope-") ? { headers: { "X-DashScope-Async": "enable" } } : {};
  if (id.startsWith("aws-bedrock-")) {
    auth = { type: "aws-sigv4", field: "apiKey", secretField: "secretKey", service: "bedrock" };
    configuration = { fields: [{ name: "apiKey", type: "secret", label: "Access Key ID", required: true }, { name: "secretKey", type: "secret", label: "Secret Access Key", required: true }] };
  } else if (id.startsWith("tencent-")) {
    auth = { type: "tc3", field: "apiKey", secretField: "secretKey", service: "hunyuan" };
    configuration = { fields: [{ name: "apiKey", type: "secret", label: "SecretId", required: true }, { name: "secretKey", type: "secret", label: "SecretKey", required: true }] };
    operationExtra = { headers: { "X-TC-Action": ref(`${optionPath}.action`), "X-TC-Version": ref(`${optionPath}.version`) } };
  } else if (id === "azure-openai") {
    auth = { type: "header", field: "apiKey", header: "api-key" };
    operationExtra = { query: { "api-version": coalesce(ref(`${optionPath}.api-version`), "2024-10-21") } };
  }
  add({
    id, providerId: id, name, vendor, capability, baseUrl, auth, params, configuration,
    notes: `该协议的模型级字段变化快或依赖云资源配置。插件固定线协议入口和统一字段，完整厂商对象通过 providerOptions.${id} 的 parameters/input/extra_body 传入；${requestShape}。云签名型入口在未配置对应鉴权驱动时会明确失败，不会伪装成 Bearer 成功。`,
    create: jsonCreate(createPath, standard, operationExtra),
    poll: pollPath ? { method: "GET", path: pollPath } : undefined,
    response: capability === "text"
      ? { status: "succeeded", textPaths: ["output.text", "output_text", "choices.0.message.content", "result"], reasoningPaths: ["reasoning_content"], usage: ref("response.usage"), errorPaths: ["error.code", "code"], messagePaths: ["error.message", "message"] }
      : pollPath ? asyncResponse(capability) : { status: "succeeded", [capability + "s"]: coalesce(ref("response.data"), ref("response.output"), ref("response.url")), errorPaths: ["error.code", "code"], messagePaths: ["error.message", "message"] }
  });
}

for (const [id, name, capability, createPath, pollPath, resultPath] of [
  ["fal-queue-image", "fal.ai Queue Image", "image", "/{{model}}", "/{{request.providerOptions.fal-queue-image.statusPath}}", "response.images"],
  ["fal-queue-video", "fal.ai Queue Video", "video", "/{{model}}", "/{{request.providerOptions.fal-queue-video.statusPath}}", "response.video"],
  ["replicate-prediction-image", "Replicate Predictions Image", "image", "/v1/predictions", "/v1/predictions/{{taskId}}", "response.output"],
  ["replicate-prediction-video", "Replicate Predictions Video", "video", "/v1/predictions", "/v1/predictions/{{taskId}}", "response.output"],
  ["comfyui-workflow", "ComfyUI Workflow", "video", "/prompt", "/history/{{taskId}}", "response.output"],
  ["runninghub-workflow", "RunningHub Workflow", "video", "/task/openapi/create", "/task/openapi/status", "response.data"],
  ["pika-via-fal", "Pika via fal.ai", "video", "/{{model}}", "/{{request.providerOptions.pika-via-fal.statusPath}}", "response.video"]
]) {
  const optionPath = `request.providerOptions.${id}`;
  add({
    id, providerId: id, name, vendor: id.includes("replicate") ? "Replicate" : id.includes("comfy") ? "ComfyUI" : id.includes("runninghub") ? "RunningHub" : "fal.ai", capability,
    baseUrl: id.includes("replicate") ? "https://api.replicate.com" : id.includes("fal") || id.includes("pika") ? "https://queue.fal.run" : "http://127.0.0.1:8188",
    auth: id.includes("comfy") ? { type: "none", field: "apiKey" } : bearer,
    params: capability === "image" ? imageParams : videoParams,
    notes: "这是运行时/工作流协议，模型字段由 endpoint、version 或 workflow schema 决定。插件不伪造固定模型字段；providerOptions.input/workflow/prompt 是完整请求对象，并由 conformance fixture 锁定实际接入版本。",
    create: jsonCreate(createPath, {
      version: omit(ref(`${optionPath}.version`)), model: omit(coalesce(ref(`${optionPath}.model`), ref("request.model"))),
      input: omit(coalesce(ref(`${optionPath}.input`), { prompt: ref("request.prompt"), images: map(ref("request.images"), "media", ref("media.value")), videos: map(ref("request.videos"), "media", ref("media.value")), audios: map(ref("request.audios"), "media", ref("media.value")) })),
      prompt: omit(ref(`${optionPath}.workflow`)), client_id: omit(ref(`${optionPath}.client_id`)), webhook: omit(ref(`${optionPath}.webhook`)), webhook_events_filter: omit(ref(`${optionPath}.webhook_events_filter`))
    }),
    poll: pollPath ? { method: "GET", path: pollPath } : undefined,
    cancel: id.includes("replicate") ? { method: "POST", path: "/v1/predictions/{{taskId}}/cancel" } : undefined,
    response: asyncResponse(capability, { [capability + "s"]: ref(resultPath), taskId: coalesce(ref("response.id"), ref("response.request_id"), ref("response.prompt_id"), ref("taskId")) })
  });
}

function manifestFor(spec) {
  return {
    apiVersion: "yingce.plugin/v2",
    id: spec.id,
    name: spec.name,
    version: "2.0.0",
    author: `${spec.vendor} / 影策`,
    description: `${spec.name} 独立请求协议插件。`,
    documentation: `# ${spec.name}\n\n完整字段、映射、响应、鉴权和兼容边界见包内 README.md 与 docs/interface.md。\n\n## 影策运行时合同\n\n用户只操作统一的文本、图片或视频能力；插件负责把统一请求转换为 ${spec.name} 上游协议。`,
    permissions: ["generation.run", "media.read"],
    configuration: spec.configuration || config(),
    contributes: {
      providers: [{
        id: spec.providerId,
        label: spec.name,
        capabilities: [spec.capability],
        scopes,
        baseUrl: spec.baseUrl,
        requiresPublicMediaUrls: spec.requiresPublicMediaUrls === true,
        auth: spec.auth,
        parameters: parameters(spec.params),
        ...(spec.validations ? { validations: spec.validations } : {}),
        create: spec.create,
        ...(spec.agent ? { agent: spec.agent } : {}),
        ...(spec.poll ? { poll: spec.poll } : {}),
        ...(spec.cancel ? { cancel: spec.cancel } : {}),
        ...(spec.result ? { result: spec.result } : {}),
        response: spec.response,
        ...(spec.agentResponse ? { agentResponse: spec.agentResponse } : {})
      }]
    }
  };
}

function collectTemplateFields(value, prefix, rows) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    if (value.length === 0) rows.push([prefix, "[]"]);
    value.forEach((item, index) => collectTemplateFields(item, `${prefix}[${index}]`, rows));
    return;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0].startsWith("$")) {
      rows.push([prefix, JSON.stringify(value)]);
      return;
    }
    if (keys.length === 0) rows.push([prefix, "{}"]);
    for (const key of keys) collectTemplateFields(value[key], prefix ? `${prefix}.${key}` : key, rows);
    return;
  }
  rows.push([prefix, JSON.stringify(value)]);
}

function operationFieldRows(operation, label) {
  if (!operation) return [];
  const rows = [
    [`${label}.method`, JSON.stringify(operation.method)],
    [`${label}.path`, JSON.stringify(operation.path || "dynamic")],
    [`${label}.contentType`, JSON.stringify(operation.contentType || "application/json")]
  ];
  collectTemplateFields(operation.body, `${label}.body`, rows);
  collectTemplateFields(operation.query, `${label}.query`, rows);
  collectTemplateFields(operation.headers, `${label}.headers`, rows);
  collectTemplateFields(operation.files, `${label}.files`, rows);
  return rows;
}

function docsFor(spec) {
  const rows = spec.params.map(([name, type, required, mapping, description]) => `| \`${name}\` | ${type} | ${required ? "是" : "否"} | \`${mapping}\` | ${description} |`).join("\n");
  const operationRows = [
    ...operationFieldRows(spec.create, "create"),
    ...operationFieldRows(spec.agent, "agent"),
    ...operationFieldRows(spec.poll, "poll"),
    ...operationFieldRows(spec.cancel, "cancel"),
    ...operationFieldRows(spec.result, "result")
  ].map(([path, expression]) => `| \`${path}\` | \`${String(expression).replaceAll("|", "\\|")}\` |`).join("\n");
  const responseRows = [];
  collectTemplateFields(spec.response, "response", responseRows);
  collectTemplateFields(spec.agentResponse, "agentResponse", responseRows);
  const mappedResponseRows = responseRows.map(([path, expression]) => `| \`${path}\` | \`${String(expression).replaceAll("|", "\\|")}\` |`).join("\n");
  const manifestJSON = JSON.stringify({ create: spec.create, agent: spec.agent, poll: spec.poll, cancel: spec.cancel, result: spec.result, response: spec.response, agentResponse: spec.agentResponse });
  const optionRefs = [...new Set([...manifestJSON.matchAll(new RegExp(`request\\.providerOptions\\.${spec.providerId.replaceAll("-", "\\-")}\\.([A-Za-z0-9_.-]+)`, "g"))].map((match) => match[1]))].sort();
  const optionRows = optionRefs.length ? optionRefs.map((name) => `- \`providerOptions.${spec.providerId}.${name}\``).join("\n") : "- 无额外扩展键。";
  const configRows = (spec.configuration || config()).fields.map((field) => `| \`${field.name}\` | ${field.type} | ${field.required ? "是" : "否"} | ${field.label || ""} |`).join("\n");
  return `# ${spec.name} 接口字段\n\n## 协议身份\n\n- 插件 ID：\`${spec.id}\`。\n- Provider ID：\`${spec.providerId}\`。\n- 能力：\`${spec.capability}\`。\n- 默认 Base URL：\`${spec.baseUrl}\`。\n- 鉴权驱动：\`${spec.auth?.type || "默认"}\`。\n- 创建：\`${spec.create.method} ${spec.create.path || "动态路径"}\`。\n${spec.agent ? `- Agent：\`${spec.agent.method} ${spec.agent.path || "动态路径"}\`。\n` : ""}${spec.poll ? `- 查询：\`${spec.poll.method} ${spec.poll.path}\`。\n` : "- 生命周期：同步响应。\n"}${spec.cancel ? `- 取消：\`${spec.cancel.method} ${spec.cancel.path}\`。\n` : ""}\n## 配置字段\n\n| 字段 | 类型 | 必填 | 含义 |\n| --- | --- | --- | --- |\n${configRows}\n\n## 统一字段映射\n\n| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## 上游请求模板逐字段清单\n\n下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。\n\n| 上游位置 | 值或转换表达式 |\n| --- | --- |\n${operationRows || "| `create` | 无请求字段 |"}\n\n## Provider 扩展键\n\n${optionRows}\n\n动态模型或工作流允许使用文档声明的完整 \`parameters/input/extra_body\` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。\n\n## 响应映射逐字段清单\n\n| 映射位置 | 上游路径或转换表达式 |\n| --- | --- |\n${mappedResponseRows || "| `response` | 无显式映射 |"}\n\n## 响应与错误\n\n插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。\n\n## 兼容边界\n\n${spec.notes || "该包只代表上述线协议 profile；同一品牌的其他 endpoint、云区域或网关包装必须使用独立插件，不能根据模型名猜测。"}\n`;
}

const requestedPackageIDs = new Set(process.argv.slice(2).map((value) => value.trim()).filter(Boolean));
const selectedSpecs = requestedPackageIDs.size > 0 ? specs.filter((spec) => requestedPackageIDs.has(spec.id)) : specs;
if (requestedPackageIDs.size > 0 && selectedSpecs.length !== requestedPackageIDs.size) {
  const found = new Set(selectedSpecs.map((spec) => spec.id));
  const missing = [...requestedPackageIDs].filter((id) => !found.has(id));
  throw new Error(`unknown protocol package id(s): ${missing.join(", ")}`);
}

for (const spec of selectedSpecs) {
  const dir = join(root, spec.id);
  await mkdir(join(dir, "docs"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifestFor(spec), null, 2) + "\n");
  await writeFile(join(dir, "README.md"), `# ${spec.name}\n\n该目录是独立官方协议插件源码。后端从生成的 \`${spec.id}.yingce-plugin\` 包加载，不依赖系统内置 \`host:\` 适配器。\n\n完整接口见 [docs/interface.md](docs/interface.md)。\n`);
  await writeFile(join(dir, "docs", "interface.md"), docsFor(spec));
}

console.log(`generated ${selectedSpecs.length} protocol packages`);
await import("./embed-documentation.mjs");
