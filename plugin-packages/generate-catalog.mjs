import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { packageDirectories } from "./package-directories.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const scopes = ["admin.system-channel", "user.custom-channel", "canvas", "creation", "agent"];
const ref = (path) => ({ $ref: path });
const omit = (value) => ({ $omitEmpty: value });
const coalesce = (...values) => ({ $coalesce: values });
const addNumbers = (...values) => ({ $add: values });
const multiply = (...values) => ({ $multiply: values });
const map = (from, as, body) => ({ $map: { from, as, in: body } });
const filter = (from, as, where) => ({ $filter: { from, as, where } });
const eq = (left, right) => ({ $eq: [left, right] });
const ne = (left, right) => ({ $ne: [left, right] });
const gt = (left, right) => ({ $gt: [left, right] });
const gte = (left, right) => ({ $gte: [left, right] });
const lt = (left, right) => ({ $lt: [left, right] });
const lte = (left, right) => ({ $lte: [left, right] });
const and = (...values) => ({ $and: values });
const len = (value) => ({ $len: value });
const lower = (value) => ({ $lower: value });
const trim = (value) => ({ $trim: value });
const toFloat = (value) => ({ $toFloat: value });
const toInt = (value) => ({ $toInt: value });
const split = (value, separator) => ({ $split: [value, separator] });
const at = (value, index) => ({ $at: [value, index] });
const divide = (left, right) => ({ $divide: [left, right] });
const conditional = (condition, thenValue, elseValue = null) => ({ $if: { condition, then: thenValue, else: elseValue } });
const nonZeroFloat = (value) => conditional(ne(toFloat(value), 0), toFloat(value));
const first = (value) => ({ $first: value });
const sorted = (value) => ({ $sortByOrder: value });
const mediaWithRoles = (path, roles) => filter(sorted(ref(path)), "media", { $in: [ref("media.role"), roles] });
const firstMediaWithRoles = (path, roles) => first(mediaWithRoles(path, roles));
const firstMediaFieldWithRoles = (path, roles, field) => first(map(mediaWithRoles(path, roles), "media", ref(`media.${field}`)));

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

const audioParams = [
  ["model", "string", true, "model", "音频模型 ID。"],
  ["prompt", "string", true, "input", "待合成文本。"],
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
  id: "openai-images", providerId: "openai-image", name: "OpenAI Images", vendor: "OpenAI", capability: "image",
  baseUrl: "https://api.openai.com", auth: bearer, params: imageParams,
  notes: "无参考图走 JSON generations；有参考图或蒙版走 multipart edits（官方与 LiteLLM 等网关的通用格式），单张参考图用 image 字段、多张用 image[]，蒙版用 mask。quality 的 1k/2k/4k 映射为 OpenAI low/medium/high。",
  create: {
    method: "POST",
    path: "/v1/images/generations",
    pathTemplate: conditional(gt(len(ref("request.images")), 0), "/v1/images/edits", "/v1/images/generations"),
    contentType: "application/json",
    contentTypeTemplate: conditional(gt(len(ref("request.images")), 0), "multipart/form-data", "application/json"),
    files: [
      { name: "image", source: conditional(eq(len(filter(ref("request.images"), "media", ne(ref("media.role"), "mask"))), 1), filter(sorted(ref("request.images")), "media", ne(ref("media.role"), "mask"))), filename: "image.png" },
      { name: "image[]", source: conditional(gt(len(filter(ref("request.images"), "media", ne(ref("media.role"), "mask"))), 1), filter(sorted(ref("request.images")), "media", ne(ref("media.role"), "mask"))) },
      { name: "mask", source: first(filter(sorted(ref("request.images")), "media", eq(ref("media.role"), "mask"))), filename: "mask.png" }
    ],
    body: {
      model: ref("request.model"),
      prompt: ref("request.prompt"),
      n: omit(conditional(gt(ref("request.imageCount"), 0), ref("request.imageCount"), 1)),
      size: omit(conditional({ $in: [lower(trim(ref("request.aspectRatio"))), ["", "auto"]] }, null, ref("request.aspectRatio"))),
      quality: omit({
        $switch: {
          cases: [
            { when: { $in: [lower(trim(ref("request.quality"))), ["1k"]] }, then: "low" },
            { when: { $in: [lower(trim(ref("request.quality"))), ["2k"]] }, then: "medium" },
            { when: { $in: [lower(trim(ref("request.quality"))), ["4k"]] }, then: "high" },
            { when: { $in: [lower(trim(ref("request.quality"))), ["", "auto"]] }, then: null }
          ],
          default: ref("request.quality")
        }
      }),
      background: omit(coalesce(
        ref("request.providerOptions.openai-image.background"),
        conditional(eq(ref("request.extra.transparentBackground"), "true"), "transparent", null)
      )),
      output_format: omit(coalesce(ref("request.providerOptions.openai-image.output_format"), "png")),
      output_compression: omit(ref("request.providerOptions.openai-image.output_compression")),
      moderation: omit(ref("request.providerOptions.openai-image.moderation")),
      response_format: omit(ref("request.providerOptions.openai-image.response_format")),
      style: omit(ref("request.providerOptions.openai-image.style")),
      user: omit(ref("request.providerOptions.openai-image.user"))
    }
  },
  response: {
    status: "succeeded",
    images: map(ref("response.data"), "item", {
      url: omit(ref("item.url")),
      dataUrl: conditional(ref("item.b64_json"), { $concat: ["data:image/png;base64,", ref("item.b64_json")] })
    }),
    usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"]
  }
});

const grokAspectSource = lower(trim(ref("request.aspectRatio")));
const grokSizeParts = split(grokAspectSource, "x");
const grokSizeWidth = toFloat(at(grokSizeParts, 0));
const grokSizeHeight = toFloat(at(grokSizeParts, 1));
const grokSizeRatio = divide(grokSizeWidth, grokSizeHeight);
const grokHasPixelSize = and(eq(len(grokSizeParts), 2), gt(grokSizeWidth, 0), gt(grokSizeHeight, 0));
const grokAspectRatio = omit({
  $switch: {
    cases: [
      { when: { $in: [grokAspectSource, ["", "auto"]] }, then: null },
      { when: { $in: [grokAspectSource, ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "1:2", "2:1"]] }, then: grokAspectSource },
      { when: and(grokHasPixelSize, eq(grokSizeWidth, grokSizeHeight)), then: "1:1" },
      { when: and(grokHasPixelSize, gte(grokSizeRatio, 1.7), lte(grokSizeRatio, 1.8)), then: "16:9" },
      { when: and(grokHasPixelSize, gte(grokSizeRatio, 1.0 / 1.8), lte(grokSizeRatio, 1.0 / 1.7)), then: "9:16" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 1.2), lt(grokSizeRatio, 1.4)), then: "4:3" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 0.7), lt(grokSizeRatio, 0.85)), then: "3:4" },
      { when: and(grokHasPixelSize, gte(grokSizeRatio, 0.6), lt(grokSizeRatio, 0.72)), then: "2:3" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 1.35), lt(grokSizeRatio, 1.6)), then: "3:2" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 0.45), lt(grokSizeRatio, 0.55)), then: "1:2" },
      { when: and(grokHasPixelSize, gt(grokSizeRatio, 1.85), lt(grokSizeRatio, 2.2)), then: "2:1" },
      { when: and(grokHasPixelSize, gt(grokSizeWidth, grokSizeHeight)), then: "16:9" },
      { when: grokHasPixelSize, then: "9:16" }
    ],
    default: null
  }
});
const grokResolutionSource = lower(trim(coalesce(ref("request.resolution"), ref("request.quality"))));
const grokResolution = omit({
  $switch: {
    cases: [
      { when: { $in: [grokResolutionSource, ["1k", "low", "standard"]] }, then: "1k" },
      { when: { $in: [grokResolutionSource, ["2k", "medium", "hd", "high", "4k"]] }, then: "2k" }
    ],
    default: null
  }
});

add({
  id: "xai-grok-images", providerId: "grok-image", name: "xAI Grok Images", vendor: "xAI", capability: "image",
  baseUrl: "https://api.x.ai", auth: bearer, params: imageParams,
  notes: "有参考图时改走 /v1/images/edits；resolution 只接受 1k/2k；像素尺寸会换算为 aspect_ratio。",
  create: {
    method: "POST",
    path: "/v1/images/generations",
    pathTemplate: conditional(gt(len(ref("request.images")), 0), "/v1/images/edits", "/v1/images/generations"),
    contentType: "application/json",
    body: {
      model: ref("request.model"), prompt: ref("request.prompt"),
      image: conditional(gt(len(ref("request.images")), 0), { url: firstMediaFieldWithRoles("request.images", ["edit_source", "reference_image", ""], "value") }),
      n: conditional(gt(ref("request.imageCount"), 0), ref("request.imageCount"), 1),
      response_format: coalesce(ref("request.providerOptions.grok-image.response_format"), "url"),
      aspect_ratio: grokAspectRatio, resolution: grokResolution,
      user: omit(ref("request.providerOptions.grok-image.user"))
    }
  },
  response: { status: "succeeded", images: map(ref("response.data"), "item", { url: omit(ref("item.url")), dataUrl: conditional(ref("item.b64_json"), { $concat: ["data:image/png;base64,", ref("item.b64_json")] }) }), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

const arkSeedreamRatioSizes = [
  ["auto", "2k"], ["1:1", "2048x2048"], ["4:3", "2304x1728"], ["3:4", "1728x2304"], ["16:9", "2560x1440"], ["9:16", "1440x2560"],
  ["3:2", "2496x1664"], ["2:3", "1664x2496"], ["21:9", "3024x1296"]
];

const arkSeedreamImageBody = (optionNamespace) => ({
  model: ref("request.model"), prompt: ref("request.prompt"),
  // Ark 的 size 只接受 WIDTHxHEIGHT 或 2k/3k/4k；统一层的比例值在这里换算成 2K 档像素尺寸，像素或档位值原样透传。
  size: omit({ $switch: { cases: arkSeedreamRatioSizes.map(([ratio, size]) => ({ when: eq(ref("request.aspectRatio"), ratio), then: size })), default: ref("request.aspectRatio") } }),
  image: omit(conditional(
    eq(len(ref("request.images")), 1),
    first(map(ref("request.images"), "media", ref("media.value"))),
    conditional(gt(len(ref("request.images")), 1), map(ref("request.images"), "media", ref("media.value")), null)
  )),
  sequential_image_generation: omit(ref(`request.providerOptions.${optionNamespace}.sequential_image_generation`)),
  sequential_image_generation_options: omit(ref(`request.providerOptions.${optionNamespace}.sequential_image_generation_options`)),
  watermark: coalesce(ref(`request.providerOptions.${optionNamespace}.watermark`), ref("request.watermark"), false),
  seed: omit(ref(`request.providerOptions.${optionNamespace}.seed`)),
  response_format: coalesce(ref(`request.providerOptions.${optionNamespace}.response_format`), "b64_json")
});

add({
  id: "volcengine-ark-seedream", providerId: "volcengine-ark-image", name: "Volcengine Ark Seedream Images", vendor: "Volcengine", capability: "image",
  baseUrl: "https://ark.cn-beijing.volces.com", auth: bearer, params: imageParams,
  notes: "官方 Ark 推理接入：Base URL 使用 /api/v3，API Key 来自方舟推理接入控制台，不可与 Agent Plan 专属 Key 混用。",
  create: jsonCreate("/api/v3/images/generations", arkSeedreamImageBody("volcengine-ark-image")),
  response: { status: "succeeded", images: ref("response.data"), usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "volcengine-ark-agent-plan-seedream", providerId: "volcengine-ark-agent-plan-image", name: "Volcengine Ark Agent Plan Seedream Images", vendor: "Volcengine", capability: "image",
  baseUrl: "https://ark.cn-beijing.volces.com", auth: bearer, params: imageParams,
  notes: "Agent Plan 专属接入：请求路径为 /api/plan/v3/images/generations，必须使用 Agent Plan 控制台专属 API Key；请求体与官方 Seedream 协议一致，但凭证与额度按 AFP 套餐结算，不能与 /api/v3 官方 Key 混用。",
  create: jsonCreate("/api/plan/v3/images/generations", arkSeedreamImageBody("volcengine-ark-agent-plan-image")),
  response: { status: "succeeded", images: ref("response.data"), usage: ref("response.usage"), errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

const arkSeedanceValidations = [
  { assert: { $lte: [len(ref("request.images")), 9] }, message: "Seedance 最多支持 9 张参考图片" },
  { assert: { $lte: [len(ref("request.videos")), 3] }, message: "Seedance 最多支持 3 个参考视频" },
  { assert: { $lte: [len(ref("request.audios")), 3] }, message: "Seedance 最多支持 3 个参考音频" },
  { assert: { $or: [eq(len(ref("request.audios")), 0), gt({ $add: [len(ref("request.images")), len(ref("request.videos"))] }, 0)] }, message: "Seedance 不支持纯音频或文本+音频，请同时添加参考图片或参考视频" }
];

const arkSeedanceParams = [
  ["model", "string", true, "model", "Ark endpoint/model ID。"],
  ["prompt", "string", true, "content[type=text].text", "视频提示词。"],
  ["images", "media[]", false, "content[type=image_url]", "first_frame、last_frame、reference_image 等 role 原样映射。"],
  ["videos", "media[]", false, "content[type=video_url]", "reference_video。"],
  ["audios", "media[]", false, "content[type=audio_url]", "reference_audio/reference_voice。"],
  ["aspectRatio", "string", false, "ratio", "输出画幅。"],
  ["resolution", "string", false, "resolution", "输出分辨率档位。"],
  ["duration", "integer", false, "duration", "输出时长秒数。"],
  ["generateAudio", "boolean", false, "generate_audio", "是否生成音频。"],
  ["watermark", "boolean", false, "watermark", "是否带水印。"],
  ["seed", "integer", false, "seed", "providerOptions seed。"],
  ["camera_fixed", "boolean", false, "camera_fixed", "providerOptions camera_fixed。"]
];

const arkSeedanceBody = (optionNamespace) => ({
  model: ref("request.model"),
  content: {
    $concatArrays: [
      [{ type: "text", text: ref("request.prompt") }],
      map(sorted(ref("request.images")), "media", {
        type: "image_url",
        image_url: { url: ref("media.value") },
        role: coalesce(ref("media.role"), "reference_image")
      }),
      map(sorted(ref("request.videos")), "media", {
        type: "video_url",
        video_url: { url: ref("media.value") },
        role: coalesce(ref("media.role"), "reference_video")
      }),
      map(sorted(ref("request.audios")), "media", {
        type: "audio_url",
        audio_url: { url: ref("media.value") },
        role: coalesce(ref("media.role"), "reference_audio")
      })
    ]
  },
  ratio: coalesce(ref("request.aspectRatio"), "16:9"),
  resolution: coalesce(ref("request.resolution"), "720p"),
  duration: conditional(gt(ref("request.duration"), 0), ref("request.duration"), 5),
  generate_audio: ref("request.generateAudio"),
  watermark: ref("request.watermark"),
  seed: omit(ref(`request.providerOptions.${optionNamespace}.seed`)),
  camera_fixed: omit(ref(`request.providerOptions.${optionNamespace}.camera_fixed`))
});

const arkSeedanceResponse = {
  taskId: coalesce(ref("response.id"), ref("response.task_id"), ref("response.data.id"), ref("taskId")),
  status: coalesce(ref("response.status"), ref("response.data.status"), "pending"),
  message: coalesce(ref("response.error.message"), ref("response.message"), ref("response.fail_reason")),
  videos: coalesce(ref("response.content.video_url"), ref("response.video_url"), ref("response.output.video_url"), ref("response.data.video_url")),
  usage: ref("response.usage"),
  errorPaths: ["error.code"],
  resultEphemeral: true
};

add({
  id: "volcengine-ark-seedance", providerId: "volcengine-ark-video", name: "Volcengine Ark Seedance", vendor: "Volcengine", capability: "video",
  baseUrl: "https://ark.cn-beijing.volces.com", auth: bearer, params: arkSeedanceParams, requiresPublicMediaUrls: true,
  validations: arkSeedanceValidations,
  notes: "官方 Ark 推理接入：创建/查询/取消走 /api/v3/contents/generations/tasks；插件不根据图片下标推断首尾帧，role 由业务层确定。API Key 来自方舟推理接入控制台。",
  create: jsonCreate("/api/v3/contents/generations/tasks", arkSeedanceBody("volcengine-ark-video")),
  poll: { method: "GET", path: "/api/v3/contents/generations/tasks/{{taskId}}" },
  cancel: { method: "DELETE", path: "/api/v3/contents/generations/tasks/{{taskId}}" },
  response: arkSeedanceResponse
});

add({
  id: "volcengine-ark-agent-plan-seedance", providerId: "volcengine-ark-agent-plan-video", name: "Volcengine Ark Agent Plan Seedance", vendor: "Volcengine", capability: "video",
  baseUrl: "https://ark.cn-beijing.volces.com", auth: bearer, params: arkSeedanceParams, requiresPublicMediaUrls: true,
  validations: arkSeedanceValidations,
  notes: "Agent Plan 专属接入：创建/查询/取消走 /api/plan/v3/contents/generations/tasks；请求体与官方 Seedance 协议一致，但必须使用 Agent Plan 专属 API Key 与 AFP 额度，不能与 /api/v3 官方 Key 混用。",
  create: jsonCreate("/api/plan/v3/contents/generations/tasks", arkSeedanceBody("volcengine-ark-agent-plan-video")),
  poll: { method: "GET", path: "/api/plan/v3/contents/generations/tasks/{{taskId}}" },
  cancel: { method: "DELETE", path: "/api/plan/v3/contents/generations/tasks/{{taskId}}" },
  response: arkSeedanceResponse
});

// Gemini imageConfig.imageSize 只接受 1K/2K/4K；画布统一层用 1k/2k/4k 或 low/medium/high。
const geminiImageSize = omit({
  $coalesce: [
    {
      $switch: {
        cases: [
          { when: { $in: [lower(ref("request.quality")), ["1k", "low"]] }, then: "1K" },
          { when: { $in: [lower(ref("request.quality")), ["2k", "medium"]] }, then: "2K" },
          { when: { $in: [lower(ref("request.quality")), ["4k", "high"]] }, then: "4K" }
        ],
        default: null
      }
    },
    {
      $switch: {
        cases: [
          { when: { $in: [lower(ref("request.resolution")), ["1k", "low"]] }, then: "1K" },
          { when: { $in: [lower(ref("request.resolution")), ["2k", "medium"]] }, then: "2K" },
          { when: { $in: [lower(ref("request.resolution")), ["4k", "high"]] }, then: "4K" }
        ],
        default: null
      }
    }
  ]
});

add({
  id: "google-gemini-image", providerId: "gemini-image", name: "Google Gemini Image", vendor: "Google", capability: "image",
  baseUrl: "https://generativelanguage.googleapis.com", auth: { type: "google-api-key", field: "apiKey" }, params: imageParams,
  notes: "imageSize 只映射 1K/2K/4K；未知质量值（如视频清晰度 720）必须省略。多图输出由宿主按次创建，不映射 candidateCount。",
  create: jsonCreate("/v1beta/models/{{model}}:generateContent", {
    contents: [{ role: "user", parts: { $concatArrays: [
      [{ text: ref("request.prompt") }],
      map(ref("request.images"), "media", conditional(ref("media.dataUrl"), { inlineData: { mimeType: { $dataMime: ref("media.dataUrl") }, data: { $dataPayload: ref("media.dataUrl") } } }, { fileData: { mimeType: omit(ref("media.mimeType")), fileUri: ref("media.url") } }))
    ] } }],
    generationConfig: {
      responseModalities: coalesce(ref("request.providerOptions.gemini-image.responseModalities"), ["TEXT", "IMAGE"]),
      imageConfig: { aspectRatio: omit(ref("request.aspectRatio")), imageSize: geminiImageSize },
      temperature: omit(ref("request.providerOptions.gemini-image.temperature")), topP: omit(ref("request.providerOptions.gemini-image.topP")), topK: omit(ref("request.providerOptions.gemini-image.topK")), seed: omit(ref("request.providerOptions.gemini-image.seed"))
    },
    safetySettings: omit(ref("request.providerOptions.gemini-image.safetySettings")),
    systemInstruction: omit(coalesce(ref("request.providerOptions.gemini-image.systemInstruction"), conditional(ref("request.instructions"), { parts: [{ text: ref("request.instructions") }] }, null)))
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

const jimengSizeParts = split(lower(trim(ref("request.aspectRatio"))), "x");
const jimengHasPixelSize = and(eq(len(jimengSizeParts), 2), gt(toFloat(at(jimengSizeParts, 0)), 0), gt(toFloat(at(jimengSizeParts, 1)), 0));
// 火山视觉 OpenAPI 的成功码是 code=10000，其余 code 都是业务失败，不能按“非零即失败”的 errorPaths 处理。
// data.status=done 只表示处理结束，成败仍看 code；not_found / expired 是任务失效的终态。
const volcVisualBusinessFailed = and(ref("response.code"), ne({ $toString: ref("response.code") }, "10000"));
const jimengTaskGone = { $in: [lower(ref("response.data.status")), ["not_found", "expired"]] };
const jimengResponse = (kind, results) => asyncResponse(kind, {
  taskId: coalesce(ref("response.data.task_id"), ref("response.task_id"), ref("taskId")),
  status: { $switch: { cases: [{ when: volcVisualBusinessFailed, then: "failed" }, { when: jimengTaskGone, then: "failed" }], default: coalesce(ref("response.data.status"), "pending") } },
  message: conditional(and({ $not: volcVisualBusinessFailed }, jimengTaskGone), "即梦任务不存在或已过期，请重新生成", coalesce(ref("response.message"), ref("response.error.message"))),
  [kind + "s"]: results,
  errorPaths: undefined,
  messagePaths: ["message"]
});

add({
  id: "volcengine-jimeng-image", providerId: "volcengine-jimeng-image", name: "Volcengine Jimeng Image", vendor: "Volcengine", capability: "image",
  baseUrl: "https://visual.volcengineapi.com", auth: { type: "volcengine-v4", field: "apiKey", secretField: "secretKey", service: "cv", region: "cn-north-1" }, params: imageParams,
  configuration: config([{ name: "secretKey", type: "secret", label: "Secret Key", required: true }]),
  notes: "本地参考图走 binary_data_base64；公网 URL 走 image_urls。WxH 尺寸拆成 width/height。",
  create: jsonCreate("/", {
    req_key: ref("request.model"), prompt: ref("request.prompt"), force_single: true,
    binary_data_base64: omit(map(filter(ref("request.images"), "media", ref("media.dataUrl")), "media", { $dataPayload: ref("media.dataUrl") })),
    image_urls: omit(map(filter(ref("request.images"), "media", and({ $not: ref("media.dataUrl") }, ref("media.url"))), "media", ref("media.url"))),
    seed: omit(ref("request.providerOptions.volcengine-jimeng-image.seed")),
    width: omit(conditional(jimengHasPixelSize, toInt(at(jimengSizeParts, 0)), ref("request.output.width"))),
    height: omit(conditional(jimengHasPixelSize, toInt(at(jimengSizeParts, 1)), ref("request.output.height"))),
    req_json: omit(ref("request.providerOptions.volcengine-jimeng-image.req_json"))
  }, { originPath: true, query: { Action: "CVSync2AsyncSubmitTask", Version: "2022-08-31" } }),
  poll: { method: "POST", path: "/", originPath: true, contentType: "application/json", query: { Action: "CVSync2AsyncGetResult", Version: "2022-08-31" }, body: { req_key: ref("request.model"), task_id: ref("taskId"), req_json: "{\"return_url\":true}" } },
  response: jimengResponse("image", coalesce(ref("response.data.image_urls"), ref("response.data.binary_data_base64")))
});

add({
  id: "doubao-streaming-tts", providerId: "doubao-streaming-tts", name: "豆包音频生成", vendor: "Volcengine", capability: "audio",
  baseUrl: "https://openspeech.bytedance.com", auth: { type: "header", field: "apiKey", header: "X-Api-Key" }, params: audioParams,
  notes: "火山引擎 seed-audio-1.0 非流式音频生成。POST /api/v3/tts/create。不传 references 为纯文本生成；连接音频时写入 references 的 audio_url 或 audio_data，最多 3 段，参考音频少于 3 段且指定了音色时再追加一个 speaker；连接图片时写入 image_url 或 image_data，最多 1 张。图片和音频不能同时使用。没有参考素材时，speaker 只在用户明确指定音色时发送，且官方仅接受语音合成 2.0 音色或复刻音色。text_prompt 引用参考音频时使用 @Audio1、@Audio2。响应是单个 JSON，audio 为 Base64，url 两小时过期。",
  create: jsonCreate("/api/v3/tts/create", {
    model: ref("request.model"),
    text_prompt: ref("request.prompt"),
    references: omit(conditional(
      gt(len(ref("request.images")), 0),
      map(ref("request.images"), "media", {
        image_url: omit(conditional(eq(ref("media.source.type"), "url"), ref("media.url"))),
        image_data: omit(conditional(eq(ref("media.source.type"), "data"), { $dataPayload: ref("media.value") }))
      }),
      conditional(
        gt(len(ref("request.audios")), 0),
        {
          $concatArrays: [
            map(ref("request.audios"), "media", {
              audio_url: omit(conditional(eq(ref("media.source.type"), "url"), ref("media.url"))),
              audio_data: omit(conditional(eq(ref("media.source.type"), "data"), { $dataPayload: ref("media.value") }))
            }),
            conditional(and(ref("request.extra.audioVoice"), lt(len(ref("request.audios")), 3)), [{ speaker: ref("request.extra.audioVoice") }], [])
          ]
        },
        conditional(ref("request.extra.audioVoice"), [{ speaker: ref("request.extra.audioVoice") }], null)
      )
    )),
    audio_config: {
      format: coalesce(ref("request.extra.audioFormat"), "mp3"),
      speech_rate: omit(conditional(ne(toFloat(ref("request.extra.audioSpeed")), 0), addNumbers(multiply(toFloat(ref("request.extra.audioSpeed")), 100), -100)))
    }
  }, {
    headers: {
      "X-Api-Request-Id": ref("request.extra.idempotencyKey")
    }
  }),
  response: {
    errorPaths: ["code"],
    messagePaths: ["message"],
    status: "succeeded",
    resultKind: "audio",
    audios: conditional(
      ref("response.url"),
      { url: ref("response.url"), ephemeral: true },
      conditional(ref("response.audio"), {
        dataUrl: ref("response.audio"),
        mimeType: conditional(eq(ref("request.extra.audioFormat"), "wav"), "audio/wav", conditional(eq(ref("request.extra.audioFormat"), "pcm"), "audio/pcm", conditional(eq(ref("request.extra.audioFormat"), "ogg_opus"), "audio/ogg", "audio/mpeg")))
      })
    )
  }
});

add({
  id: "openai-audio", providerId: "openai-audio", name: "OpenAI Audio Speech", vendor: "OpenAI", capability: "audio",
  baseUrl: "https://api.openai.com", auth: bearer, params: audioParams,
  notes: "同步 /v1/audio/speech 返回原始音频流，由 binaryPayload 包装为统一音频结果。",
  create: jsonCreate("/v1/audio/speech", {
    model: ref("request.model"),
    input: ref("request.prompt"),
    voice: coalesce(ref("request.extra.audioVoice"), ref("request.providerOptions.openai-audio.voice"), "alloy"),
    response_format: coalesce(ref("request.extra.audioFormat"), ref("request.providerOptions.openai-audio.response_format"), "mp3"),
    speed: coalesce(nonZeroFloat(ref("request.extra.audioSpeed")), ref("request.providerOptions.openai-audio.speed"), 1),
    instructions: omit(coalesce(ref("request.extra.audioInstructions"), ref("request.providerOptions.openai-audio.instructions")))
  }),
  response: { binaryPayload: true, resultKind: "audio", status: "succeeded", errorPaths: ["error.code"], messagePaths: ["error.message"] }
});

add({
  id: "async-audio", providerId: "async-audio", name: "Async Audio Tasks", vendor: "OpenAI compatible", capability: "audio",
  baseUrl: "https://api.openai.com", auth: bearer, params: audioParams,
  notes: "异步音频任务：创建 /v1/audio/tasks，轮询同一路径，结果优先 URL，否则下载 /content。",
  create: jsonCreate("/v1/audio/tasks", {
    model: ref("request.model"),
    input: ref("request.prompt"),
    voice: coalesce(ref("request.extra.audioVoice"), ref("request.providerOptions.async-audio.voice"), "alloy"),
    response_format: coalesce(ref("request.extra.audioFormat"), ref("request.providerOptions.async-audio.response_format"), "mp3"),
    speed: coalesce(nonZeroFloat(ref("request.extra.audioSpeed")), ref("request.providerOptions.async-audio.speed"), 1),
    instructions: omit(coalesce(ref("request.extra.audioInstructions"), ref("request.providerOptions.async-audio.instructions")))
  }),
  poll: { method: "GET", path: "/v1/audio/tasks/{{taskId}}" },
  result: { method: "GET", path: "/v1/audio/tasks/{{taskId}}/content", headers: { Accept: "audio/*" } },
  response: asyncResponse("audio", {
    taskId: coalesce(ref("response.id"), ref("response.task_id"), ref("response.data.id"), ref("taskId")),
    status: coalesce(ref("response.status"), ref("response.data.status"), "pending"),
    audios: coalesce(ref("response.audio_url"), ref("response.audioUrl"), ref("response.result_url"), ref("response.url"), ref("response.data.audio_url"), ref("response.output.url")),
    errorPaths: ["error.code"], messagePaths: ["error.message"]
  })
});

add({
  id: "openai-videos", providerId: "newapi", name: "OpenAI Videos / Sora", vendor: "OpenAI", capability: "video",
  baseUrl: "https://api.openai.com", auth: bearer, params: videoParams, requiresPublicMediaUrls: false,
  create: {
    method: "POST", path: "/v1/videos", contentType: "multipart/form-data",
    body: {
      model: ref("request.model"), prompt: ref("request.prompt"), seconds: { $toString: ref("request.duration") },
      size: omit(ref("request.aspectRatio")), resolution_name: omit(ref("request.resolution")),
      variants: omit(ref("request.providerOptions.newapi.variants"))
    },
    files: [{ name: "input_reference", source: first(filter(sorted(ref("request.images")), "media", ne(ref("media.role"), "mask"))), filename: "input-reference.png" }]
  },
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" },
  cancel: { method: "DELETE", path: "/v1/videos/{{taskId}}" },
  result: { method: "GET", path: "/v1/videos/{{taskId}}/content", headers: { Accept: "video/mp4" } },
  response: asyncResponse("video", { videos: coalesce(ref("response.url"), ref("response.video_url"), ref("response.output.url")), errorPaths: ["error.code"], messagePaths: ["error.message"] })
});

// NewAPI 任务查询的失败原因在 data.fail_reason（外层 message 为空），兼容直接返回的扁平结构。
const newAPITaskMessage = coalesce(
  ref("response.error.message"), ref("response.message"), ref("response.fail_reason"),
  ref("response.data.fail_reason"), ref("response.data.error.message")
);

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
  poll: { method: "GET", path: "/v1/videos/{{taskId}}" }, response: asyncResponse("video", { message: newAPITaskMessage })
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
  poll: { method: "GET", path: "/v1/video/generations/{{taskId}}" },
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.data.task_id"), ref("response.data.taskId"), ref("response.task_id"), ref("response.taskId"), ref("response.data.id"), ref("response.id"), ref("taskId")),
    message: newAPITaskMessage,
    videos: coalesce(
      map(ref("response.data"), "item", coalesce(ref("item.url"), ref("item.video_url"), ref("item.videoUrl"), ref("item.output_url"), ref("item.outputUrl"))),
      ref("response.data.result_url"), ref("response.data.video_url"), ref("response.data.output_url"), ref("response.data.url"), ref("response.data.metadata.url"),
      ref("response.data.data.video_url"), ref("response.data.data.output_url"), ref("response.data.data.result_url"), ref("response.data.data.url"), ref("response.data.data.metadata.url"),
      ref("response.video_url"), ref("response.videoUrl"), ref("response.result_url"), ref("response.output_url"), ref("response.url"), ref("response.metadata.url"), ref("response.output.url")
    )
  })
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
  poll: { method: "GET", path: "/v3/async/task-result", query: { task_id: ref("taskId") } },
  // Novita 统一任务查询把状态和失败原因放在 task.status / task.reason（TASK_STATUS_* 枚举），结果在 videos[].video_url。
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.task.task_id"), ref("response.id"), ref("response.task_id"), ref("response.taskId"), ref("response.data.id"), ref("taskId")),
    status: coalesce(ref("response.task.status"), ref("response.status"), ref("response.state"), ref("response.data.status"), "pending"),
    message: coalesce(ref("response.task.reason"), ref("response.error.message"), ref("response.message"), ref("response.fail_reason")),
    videos: coalesce(ref("response.videos"), ref("response.video_url"), ref("response.videoUrl"), ref("response.result_url"), ref("response.url"), ref("response.data.video_url"), ref("response.output.url"))
  })
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
  response: jimengResponse("video", coalesce(ref("response.data.video_urls"), ref("response.data.video_url")))
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

// Agnes 图像是同步端点，文生图与图生图共用 POST /v1/images/generations：
// 不传 image 为文生图，传 image 为图生图或多图合成。官方参数表只承认
// model、prompt、size（必填，档位 1K/2K/3K/4K 或 WxH 精确尺寸）、ratio、image、
// return_base64 和 extra_body，因此这里不发送 n、output_format、quality、
// background 等 OpenAI 兼容字段。顶层 response_format 是官方明确列出的错误写法，
// 输出格式只能声明在 extra_body 内。参考图放 extra_body.image，支持公共 HTTPS URL
// 和 Data URI Base64，所以不强制公共媒体 URL，本地开发也能直接联调。
const agnesImageRatios = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];
const agnesImageAspect = trim(ref("request.aspectRatio"));
const agnesImageIsRatio = { $in: [agnesImageAspect, agnesImageRatios] };
const agnesImageIsPixel = eq(len(split(agnesImageAspect, "x")), 2);
// size 是官方必填项：像素尺寸原样透传，其余情况（比例、auto、空值）一律落到分辨率档位，不能省略。
const agnesImageSize = conditional(agnesImageIsPixel, agnesImageAspect, {
  $switch: {
    cases: [
      { when: { $in: [lower(trim(ref("request.quality"))), ["1k", "low", "standard"]] }, then: "1K" },
      { when: { $in: [lower(trim(ref("request.quality"))), ["2k", "medium", "hd", "high"]] }, then: "2K" },
      { when: { $in: [lower(trim(ref("request.quality"))), ["3k"]] }, then: "3K" },
      { when: { $in: [lower(trim(ref("request.quality"))), ["4k"]] }, then: "4K" }
    ],
    default: "1K"
  }
});

add({
  id: "agnes-image", providerId: "agnes-image", name: "Agnes Image", vendor: "Agnes AI", capability: "image",
  baseUrl: "https://api.agnes-ai.cn", auth: bearer, params: imageParams, requiresPublicMediaUrls: false,
  notes: "Agnes 官方图像端点，同步返回。文生图与图生图共用 /v1/images/generations：不传 image 为文生图，传 image 为图生图或多图合成。size 必填，取 1K/2K/3K/4K 档位或 WxH 精确尺寸；画面比例走独立的 ratio 字段。参考图放在 extra_body.image，支持公共 HTTPS URL 或 Data URI Base64。顶层 response_format 是官方明确列出的错误写法，输出格式只能声明在 extra_body.response_format。该端点不接受 n，单次请求固定返回一张图片，需要多张时由上层拆分为多个任务。",
  validations: [
    { assert: { $or: [{ $in: [agnesImageAspect, ["", "auto", ...agnesImageRatios]] }, eq(len(split(agnesImageAspect, "x")), 2)] }, message: "Agnes 图像只支持 1:1、3:4、4:3、16:9、9:16、2:3、3:2、21:9 比例或 WxH 像素尺寸" }
  ],
  create: jsonCreate("/v1/images/generations", {
    model: ref("request.model"),
    prompt: ref("request.prompt"),
    size: omit(agnesImageSize),
    ratio: omit(conditional(agnesImageIsRatio, agnesImageAspect)),
    extra_body: omit({
      image: omit(map(sorted(ref("request.images")), "media", coalesce(ref("media.dataUrl"), ref("media.url")))),
      response_format: coalesce(ref("request.providerOptions.agnes-image.response_format"), "url")
    })
  }, { originPath: true }),
  response: {
    status: "succeeded",
    images: map(ref("response.data"), "item", {
      url: omit(ref("item.url")),
      dataUrl: conditional(ref("item.b64_json"), { $concat: ["data:image/png;base64,", ref("item.b64_json")] })
    }),
    errorPaths: ["error.code", "code"], messagePaths: ["error.message", "message", "msg"]
  }
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

// MiniMax H3 Image 使用 OpenAI 风格的 /v1/images/generations 与 /v1/images/edits，
// 与旧 minimax-image（/v1/image_generation）是不同线协议，独立成包以免影响已配置的旧渠道。
const minimaxH3Models = ["MiniMax-H3-Image", "MiniMax-H3-Image-Highspeed"];
const minimaxH3Areas = ["1K", "2K", "4K"];
const minimaxH3Aspect = lower(trim(ref("request.aspectRatio")));
const minimaxH3PixelParts = split(minimaxH3Aspect, "x");
const minimaxH3PixelWidth = toFloat(at(minimaxH3PixelParts, 0));
const minimaxH3PixelHeight = toFloat(at(minimaxH3PixelParts, 1));
const minimaxH3HasPixelSize = and(eq(len(minimaxH3PixelParts), 2), gt(minimaxH3PixelWidth, 0), gt(minimaxH3PixelHeight, 0));
const minimaxH3RatioParts = split(minimaxH3Aspect, ":");
const minimaxH3RatioWidth = toFloat(at(minimaxH3RatioParts, 0));
const minimaxH3RatioHeight = toFloat(at(minimaxH3RatioParts, 1));
const minimaxH3IsInteger = (value) => eq(value, toInt(value));
// 1:3 到 3:1（含边界）用乘法比较，避免浮点除法误差和除零。
const minimaxH3WithinRatio = (width, height) => and(lte(width, multiply(height, 3)), lte(height, multiply(width, 3)));
const minimaxH3ValidPixelSize = and(
  minimaxH3HasPixelSize, minimaxH3IsInteger(minimaxH3PixelWidth), minimaxH3IsInteger(minimaxH3PixelHeight),
  gte(multiply(minimaxH3PixelWidth, minimaxH3PixelHeight), 655360), lte(multiply(minimaxH3PixelWidth, minimaxH3PixelHeight), 20000000),
  minimaxH3WithinRatio(minimaxH3PixelWidth, minimaxH3PixelHeight)
);
const minimaxH3ValidRatio = and(
  eq(len(minimaxH3RatioParts), 2), gte(minimaxH3RatioWidth, 1), lte(minimaxH3RatioWidth, 300), gte(minimaxH3RatioHeight, 1), lte(minimaxH3RatioHeight, 300),
  minimaxH3IsInteger(minimaxH3RatioWidth), minimaxH3IsInteger(minimaxH3RatioHeight), minimaxH3WithinRatio(minimaxH3RatioWidth, minimaxH3RatioHeight)
);
const minimaxH3Resolution = { $upper: trim(ref("request.resolution")) };
const minimaxH3OptionPath = "request.providerOptions.minimax-h3-image";
const minimaxH3SuccessItems = filter(ref("response.data"), "item", { $or: [ref("item.url"), ref("item.b64_json")] });

add({
  id: "minimax-h3-image", providerId: "minimax-h3-image", name: "MiniMax H3 Image", vendor: "MiniMax", capability: "image",
  baseUrl: "https://api.minimax.cn", auth: bearer, requiresPublicMediaUrls: false,
  imageParameters: [
    { name: "size", label: "画幅比例", type: "string", binding: "aspectRatio", encoding: "ratio", values: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "3:1", "1:3"], default: "1:1", pricing: true },
    { name: "imageResolution", label: "分辨率", type: "string", binding: "resolution", values: minimaxH3Areas, default: "2K", pricing: true },
    { name: "count", label: "生成数量", type: "integer", binding: "imageCount", min: 1, max: 10, step: 1, default: 1 },
    { name: "quality", label: "图片质量", type: "string", binding: "quality", enabled: false },
    { name: "transparentBackground", label: "透明背景", type: "boolean", binding: "transparentBackground", default: false, enabled: false },
    // 渠道套用 GPT Image 能力模板时会带上 outputFormat/outputCompression；这里声明本插件自己的安全映射，默认停用。
    { name: "outputFormat", label: "输出格式", type: "string", binding: "providerOptions.minimax-h3-image.output_format", values: ["jpeg", "png", "webp"], default: "jpeg", enabled: false },
    { name: "outputCompression", label: "压缩质量", type: "integer", binding: "providerOptions.minimax-h3-image.output_compression", min: 0, max: 100, step: 1, enabled: false }
  ],
  params: [
    ["model", "string", true, "model", "MiniMax-H3-Image 或 MiniMax-H3-Image-Highspeed。"],
    ["prompt", "string", true, "prompt", "图片提示词，去除首尾空白后不能为空，最长 32000 个字符。"],
    ["images", "media[]", false, "images[].image_url", "参考图，1 到 16 张，按 order 顺序下发；有参考图时改走 /v1/images/edits。不支持 mask。"],
    ["imageCount", "integer", false, "n", "输出数量，1 到 10，未设置时为 1。"],
    ["aspectRatio", "string", false, "aspect_ratio / size", "X:Y 比例（1 到 300 的整数，1:3 到 3:1）映射到 aspect_ratio，并固定 size=auto；宽x高像素尺寸映射到 size，不再发送 aspect_ratio 和 area。"],
    ["resolution", "string", false, "area", "分辨率档位 1K、2K、4K；未设置时为 2K，避免落到上游默认的 4K。"],
    ["providerOptions", "object", false, "output_format / output_compression", "仅开放 providerOptions.minimax-h3-image.output_format（jpeg/png/webp）与 output_compression（0-100）。"]
  ],
  validations: [
    { assert: { $in: [ref("request.model"), minimaxH3Models] }, message: "MiniMax H3 Image 仅支持 MiniMax-H3-Image 或 MiniMax-H3-Image-Highspeed" },
    { assert: and(gt(len(trim(ref("request.prompt"))), 0), lte(len(trim(ref("request.prompt"))), 32000)), message: "MiniMax H3 Image 提示词不能为空且不能超过 32000 个字符" },
    { assert: lte(len(ref("request.images")), 16), message: "MiniMax H3 Image 最多支持 16 张参考图" },
    { assert: eq(len(filter(ref("request.images"), "media", eq(ref("media.role"), "mask"))), 0), message: "MiniMax H3 Image 不支持蒙版（mask）局部编辑，请改用提示词描述需要修改的区域" },
    { assert: { $or: [eq(ref("request.imageCount"), null), eq(ref("request.imageCount"), 0), and(gte(ref("request.imageCount"), 1), lte(ref("request.imageCount"), 10))] }, message: "MiniMax H3 Image 生成数量必须为 1 到 10" },
    { assert: { $or: [{ $in: [minimaxH3Aspect, ["", "auto"]] }, minimaxH3ValidRatio, minimaxH3ValidPixelSize] }, message: "MiniMax H3 Image 比例须在 1:3 到 3:1 之间；像素尺寸须为「宽x高」整数，总像素 655360 到 20000000" },
    { assert: { $in: [minimaxH3Resolution, ["", "AUTO", ...minimaxH3Areas]] }, message: "MiniMax H3 Image 分辨率仅支持 1K、2K、4K" },
    { assert: { $in: [coalesce(lower(trim(ref(`${minimaxH3OptionPath}.output_format`))), "jpeg"), ["jpeg", "jpg", "png", "webp"]] }, message: "MiniMax H3 Image 输出格式仅支持 jpeg、png、webp" }
  ],
  create: {
    method: "POST",
    path: "/v1/images/generations",
    pathTemplate: conditional(gt(len(ref("request.images")), 0), "/v1/images/edits", "/v1/images/generations"),
    contentType: "application/json",
    body: {
      model: ref("request.model"),
      prompt: ref("request.prompt"),
      n: conditional(gt(ref("request.imageCount"), 0), ref("request.imageCount"), 1),
      // 宿主会为 /images/generations 补全 OpenAI 像素 size；这里必须显式声明 size，比例输入时固定为 auto。
      size: conditional(minimaxH3HasPixelSize, minimaxH3Aspect, "auto"),
      // 上游规定像素尺寸模式下不能出现 aspect_ratio 与 area（即使是 auto）。
      aspect_ratio: conditional({ $or: [minimaxH3HasPixelSize, { $in: [minimaxH3Aspect, ["", "auto"]] }] }, null, minimaxH3Aspect),
      area: conditional(minimaxH3HasPixelSize, null, conditional({ $in: [minimaxH3Resolution, minimaxH3Areas] }, minimaxH3Resolution, "2K")),
      images: conditional(gt(len(ref("request.images")), 0), map(sorted(ref("request.images")), "media", { image_url: ref("media.value") })),
      response_format: "url",
      output_format: omit(lower(trim(ref(`${minimaxH3OptionPath}.output_format`)))),
      output_compression: conditional({ $ne: [ref(`${minimaxH3OptionPath}.output_compression`), null] }, toInt(ref(`${minimaxH3OptionPath}.output_compression`))),
      // 显式占位但不发送：阻止宿主按 OpenAI 规则补 quality/background，H3 不支持这两个字段。
      quality: null,
      background: null
    }
  },
  response: {
    // data[] 中失败的单张只有 error 字段；全部失败时上游返回 4xx/5xx，宿主按 HTTP 错误处理。
    status: conditional(gt(len(minimaxH3SuccessItems), 0), "succeeded", "failed"),
    message: coalesce(ref("response.error.message"), first(map(filter(ref("response.data"), "item", ref("item.error")), "item", ref("item.error.message"))), conditional(eq(len(minimaxH3SuccessItems), 0), "MiniMax H3 Image 没有返回可用图片")),
    images: map(minimaxH3SuccessItems, "item", {
      url: omit(ref("item.url")),
      dataUrl: omit(ref("item.b64_json")),
      output_format: omit(ref("response.output_format"))
    }),
    usage: ref("response.usage"),
    resultEphemeral: true,
    errorPaths: ["error.code", "error.type"],
    messagePaths: ["error.message"]
  },
  notes: `适配 MiniMax 开放平台 H3 图片接口，模型为 MiniMax-H3-Image 与 MiniMax-H3-Image-Highspeed（参数和限制相同）。默认 Base URL 为国内站 https://api.minimax.cn，国际站可改为 https://api.minimax.io；API Key 需与站点对应。\n\n无参考图走 POST /v1/images/generations，有参考图走 POST /v1/images/edits（JSON，images[].image_url），参考图 1 到 16 张、按 order 保持顺序，支持公网 URL 或 data URI；请求体总大小上限 64 MiB。不支持 mask、透明背景和质量档位：mask 会在校验阶段明确拒绝，quality/background 不会发送。区域改色等局部修改只能通过提示词描述实现。\n\n比例输入发送 size=auto + aspect_ratio + area；「宽x高」像素输入只发送 size（总像素 655360 到 20000000，比例 1:3 到 3:1），不发送 aspect_ratio 与 area。area 未设置时固定发送 2K，避免落到上游默认的 4K。output_format 与 output_compression 只能通过本插件 providerOptions 命名空间设置，默认不发送（上游默认 jpeg、95）。\n\n同步返回，response_format 固定为 url；图片 URL 不保证长期可用，已声明 resultEphemeral，由宿主立即下载持久化。data[] 中只有 error 的失败项会被跳过，至少一张成功即成功；全部失败时上游返回 402/422/500，按 HTTP 错误失败。usage 原样保留供核对，不改写本地计费规则。\n\n风险：上游最长处理 600 秒，而宿主请求超时固定为 5 分钟，4K 多图可能先超时；上游接口不幂等，客户端超时或断开后仍会完成生成并对成功图片扣费，重试会再次扣费。\n\n官方接口：[文生图](https://platform.minimax.io/docs/api-reference/image-generation-h3-generations)、[图片编辑](https://platform.minimax.io/docs/api-reference/image-generation-h3-edits)、[国内站图片生成指南](https://platform.minimax.cn/docs/guides/image-generation)。`
});

const minimaxInputs = coalesce({ $concatArrays: [
  ...[["images", "image"], ["videos", "video"], ["audios", "audio"]].map(([field, kind]) =>
    map(ref(`request.${field}`), "media", { $merge: [ref("media"), { kind }] })
  )
] }, ref("request.inputs"));
const minimaxMedia = (kind, roles) => filter(minimaxInputs, "media", and(
  eq(ref("media.kind"), kind), ...(roles ? [{ $in: [ref("media.role"), roles] }] : [])
));
const minimaxKeyframes = filter(minimaxInputs, "media", { $in: [ref("media.role"), ["first_frame", "last_frame"]] });
const minimaxRatio = ref("request.output.aspectRatio");

add({
  id: "dashscope-minimax-video", providerId: "dashscope-minimax-video", name: "百炼 MiniMax H3 Video", vendor: "Alibaba Cloud", capability: "video",
  baseUrl: "", auth: bearer, requiresPublicMediaUrls: true,
  params: [
    ["model", "string", true, "model", "固定为 MiniMax/MiniMax-H3。"],
    ["prompt", "string", true, "input.prompt", "中英文提示词，最多 7000 个字符。"],
    ["images", "media[]", false, "input.media", "显式首帧、尾帧或参考图；支持仅尾帧。"],
    ["videos", "media[]", false, "input.media[type=feature]", "最多 3 个参考视频。"],
    ["audios", "media[]", false, "input.media[type=driving_audio]", "最多 3 个参考音频。"],
    ["duration", "integer", true, "parameters.duration", "4-15 秒整数，不沿用原生 MiniMax 的 30 秒上限。"],
    ["aspectRatio", "string", false, "parameters.ratio", "文生视频必须指定具体比例；首尾帧恒为 adaptive，多模态默认 adaptive。"],
    ["resolution", "string", true, "parameters.resolution", "768P 或 2K。"],
    ["watermark", "boolean", false, "parameters.watermark", "是否添加 AI 生成水印，默认关闭。"]
  ],
  validations: [
    { assert: eq(ref("request.model"), "MiniMax/MiniMax-H3"), message: "百炼 MiniMax 视频仅支持 MiniMax/MiniMax-H3" },
    { assert: and(gt(len(trim(ref("request.prompt"))), 0), lte(len(ref("request.prompt")), 7000)), message: "百炼 MiniMax 提示词不能为空且不能超过 7000 个字符" },
    { assert: { $in: [ref("request.output.duration"), Array.from({ length: 12 }, (_, index) => index + 4)] }, message: "百炼 MiniMax duration 必须为 4-15 秒整数" },
    { assert: { $in: [{ $upper: ref("request.output.resolution") }, ["768P", "2K"]] }, message: "百炼 MiniMax resolution 仅支持 768P 或 2K" },
    { assert: eq(len(filter(minimaxInputs, "media", { $not: { $or: [
      and(eq(ref("media.kind"), "image"), { $in: [ref("media.role"), ["", "first_frame", "last_frame", "reference_image", "subject_reference", "style_reference"]] }),
      and(eq(ref("media.kind"), "video"), { $in: [ref("media.role"), ["", "reference_video"]] }),
      and(eq(ref("media.kind"), "audio"), { $in: [ref("media.role"), ["", "reference_audio", "reference_voice"]] })
    ] } })), 0), message: "百炼 MiniMax 媒体类型或角色不受支持" },
    { assert: eq(len(filter(minimaxInputs, "media", { $not: { $in: [first(split(ref("media.value"), "://")), ["http", "https"]] } })), 0), message: "百炼 MiniMax 媒体必须使用 HTTP 或 HTTPS 公网 URL" },
    { assert: lte(len(minimaxMedia("image")), 9), message: "百炼 MiniMax 最多支持 9 张参考图片" },
    { assert: lte(len(minimaxMedia("video")), 3), message: "百炼 MiniMax 最多支持 3 个参考视频" },
    { assert: lte(len(minimaxMedia("audio")), 3), message: "百炼 MiniMax 最多支持 3 个参考音频" },
    ...[["first_frame", "首帧"], ["last_frame", "尾帧"]].map(([role, label]) => ({
      assert: lte(len(minimaxMedia("image", [role])), 1), message: `百炼 MiniMax 最多只能有一个${label}`
    })),
    { assert: { $or: [eq(len(minimaxKeyframes), 0), eq(len(minimaxKeyframes), len(minimaxInputs))] }, message: "百炼 MiniMax 首尾帧不能与参考图片、视频或音频混用" },
    { assert: { $or: [gt(len(minimaxKeyframes), 0), { $in: [coalesce(minimaxRatio, "adaptive"), ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]] }] }, message: "百炼 MiniMax ratio 不受支持" },
    { assert: { $or: [gt(len(minimaxInputs), 0), { $in: [minimaxRatio, ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]] }] }, message: "百炼 MiniMax 文生视频必须指定具体画幅比例，不能使用 adaptive" }
  ],
  create: jsonCreate("/api/v1/services/aigc/video-generation/video-synthesis", {
    model: ref("request.model"),
    input: {
      prompt: ref("request.prompt"),
      media: omit(map(sorted(minimaxInputs), "media", {
        type: conditional(eq(ref("media.kind"), "image"),
          conditional({ $in: [ref("media.role"), ["first_frame", "last_frame"]] }, ref("media.role"), "image_url"),
          conditional(eq(ref("media.kind"), "video"), "feature", "driving_audio")),
        url: ref("media.value")
      }))
    },
    parameters: {
      resolution: { $upper: ref("request.output.resolution") },
      ratio: conditional(gt(len(minimaxKeyframes), 0), "adaptive", coalesce(minimaxRatio, "adaptive")),
      duration: ref("request.output.duration"),
      watermark: coalesce(ref("request.output.watermark"), false)
    }
  }, { headers: { "X-DashScope-Async": "enable" }, originPath: true }),
  poll: { method: "GET", path: "/api/v1/tasks/{{taskId}}", originPath: true },
  response: {
    taskId: coalesce(ref("response.output.task_id"), ref("taskId")),
    status: conditional(eq(ref("response.output.task_status"), "UNKNOWN"), "failed", ref("response.output.task_status")),
    message: coalesce(ref("response.output.message"), ref("response.message"), conditional(eq(ref("response.output.task_status"), "UNKNOWN"), "百炼 MiniMax 任务不存在或已超过 24 小时查询有效期")),
    videos: ref("response.output.video_url"), usage: ref("response.usage"),
    errorPaths: ["code", "output.code"], resultEphemeral: true
  },
  notes: `适配阿里云百炼 MiniMax/MiniMax-H3，渠道 Base URL 使用百炼业务空间 Endpoint。\n\n首帧、尾帧各最多 1 张，支持仅尾帧；首尾帧与多模态参考互斥。参考图最多 9 张、每张 30 MB，JPG/JPEG/PNG/WEBP/HEIC/HEIF，宽高 256-5760、宽高比 0.4-2.5。参考视频最多 3 个、每个 50 MB、2-15 秒且总时长不超过 15 秒，MP4/MOV、23.976-60 fps，宽高和比例限制同图片。音频最多 3 个、每个 15 MB、2-15 秒且总时长不超过 15 秒，WAV/MP3。插件校验已提供的角色、数量、URL、提示词和生成规格；媒体编码、尺寸、帧率及参考总时长仍需满足上游限制，不在协议模板内执行媒体探测。\n\n不发送原生 content[]、generate_audio、seed 或 prompt_optimizer，也不开放绕过统一媒体校验的 raw media 扩展。创建任务后仅轮询原 task_id，UNKNOWN 终止为失败；任务查询有效期 24 小时，结果 URL 有效期 30 天，宿主持久化临时结果。usage 保留输入视频、输出视频和图片计数，不把供应商统计直接改写为本地计费规则。\n\n官方接口：[MiniMax 视频生成 API](https://docs.bailian.console.aliyun.com/zh/model-studio/minimax-video-generation-api-reference)。`
});

const wan3MediaType = coalesce(
  ref("media.role"),
  conditional(eq(ref("media.kind"), "image"), "reference_image", conditional(
    eq(ref("media.kind"), "video"), "reference_video", conditional(
      eq(ref("media.kind"), "audio"), "reference_audio", ref("media.kind")
    )
  ))
);

add({
  id: "dashscope-wan3-video", providerId: "dashscope-wan3-video", name: "DashScope Wan 3.0 Video", vendor: "Alibaba Cloud", capability: "video",
  baseUrl: "https://dashscope.aliyuncs.com", auth: bearer, params: videoParams, requiresPublicMediaUrls: true,
  validations: [
    { assert: { $in: [lower(ref("request.model")), ["wan3.0-video-prime", "wan3.0-video"]] }, message: "Wan 3.0 Video 仅支持 wan3.0-video-prime 或 wan3.0-video" },
    { assert: { $lte: [len(mediaWithRoles("request.images", ["first_frame"])), 1] }, message: "Wan 3.0 Video 最多只能有一个 first_frame" },
    { assert: { $lte: [len(mediaWithRoles("request.images", ["last_frame"])), 1] }, message: "Wan 3.0 Video 最多只能有一个 last_frame" }
  ],
  create: jsonCreate("/api/v1/services/aigc/video-generation/video-synthesis", {
    model: ref("request.model"),
    input: {
      prompt: omit(ref("request.prompt")),
      media: omit(coalesce(
        ref("request.providerOptions.dashscope-wan3-video.media"),
        map(sorted(ref("request.inputs")), "media", { type: wan3MediaType, url: ref("media.value") })
      ))
    },
    parameters: {
      resolution: omit(ref("request.resolution")),
      ratio: omit(ref("request.aspectRatio")),
      duration: omit(ref("request.duration")),
      audio: coalesce(ref("request.providerOptions.dashscope-wan3-video.audio"), ref("request.generateAudio")),
      seed: omit(ref("request.providerOptions.dashscope-wan3-video.seed")),
      prompt_extend: coalesce(ref("request.providerOptions.dashscope-wan3-video.prompt_extend"), true),
      watermark: ref("request.watermark")
    }
  }, { headers: { "X-DashScope-Async": "enable" }, originPath: true }),
  poll: { method: "GET", path: "/api/v1/tasks/{{taskId}}", originPath: true },
  response: asyncResponse("video", {
    taskId: coalesce(ref("response.output.task_id"), ref("response.task_id"), ref("taskId")),
    status: conditional(eq(lower(ref("response.output.task_status")), "unknown"), "failed", coalesce(ref("response.output.task_status"), ref("response.status"), "pending")),
    videos: ref("response.output.video_url"),
    usage: ref("response.usage"), errorPaths: ["code", "output.code"], messagePaths: ["message", "output.message"]
  })
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

// Qwen-Image 3.0 / Wan 2.7 图像属于百炼多模态模型，必须走多模态端点：
// 用 OpenAI 的 /v1/images/generations 或 /v1/images/edits 会被网关判为“模型与端点不匹配”，
// 官方错误码把它表现为 url error；参考图只能放在 input.messages[].content[].image。
// size 使用 DashScope 的 “宽*高”（星号），未登记的档位直接省略，由模型按提示词自动推荐分辨率。
const dashscopeMultimodalImageSizes = [
  ["1:1", "1024*1024"], ["3:4", "960*1280"], ["4:3", "1280*960"], ["2:3", "1024*1536"], ["3:2", "1536*1024"],
  ["9:16", "864*1536"], ["16:9", "1536*864"],
  ["1024x1024", "1024*1024"], ["1024x1536", "1024*1536"], ["1536x1024", "1536*1024"],
  ["1024x1280", "1024*1280"], ["1280x1024", "1280*1024"], ["960x1280", "960*1280"], ["1280x960", "1280*960"]
];

add({
  id: "dashscope-qwen-image", providerId: "dashscope-qwen-image", name: "DashScope Qwen / Wan Image", vendor: "Alibaba Cloud", capability: "image",
  baseUrl: "https://dashscope.aliyuncs.com", auth: bearer, params: imageParams, requiresPublicMediaUrls: false,
  notes: "百炼多模态图像端点（image-generation 异步任务）。文生图与图生图共用同一入口：不传 image 为文生图，传 1-3 张 image 为图生图。参考图通过 input.messages[].content[].image 传输（优先 Base64 data URL），不使用 OpenAI 的 /v1/images/edits multipart。size 采用“宽*高”，未登记的档位省略并由模型自动推荐；enable_thinking 固定为 false，因为官方要求非流式调用关闭思考模式。",
  create: jsonCreate("/api/v1/services/aigc/image-generation/generation", {
    model: ref("request.model"),
    input: {
      messages: [{
        role: "user",
        content: {
          $concatArrays: [
            map(sorted(ref("request.images")), "media", { image: coalesce(ref("media.dataUrl"), ref("media.url")) }),
            [{ text: ref("request.prompt") }]
          ]
        }
      }]
    },
    parameters: {
      size: omit({ $switch: { cases: dashscopeMultimodalImageSizes.map(([ratio, size]) => ({ when: eq(ref("request.aspectRatio"), ratio), then: size })), default: null } }),
      n: conditional(gt({ $toInt: ref("request.imageCount") }, 0), { $toInt: ref("request.imageCount") }, 1),
      prompt_extend: true,
      enable_thinking: false,
      negative_prompt: omit(ref("request.providerOptions.dashscope-qwen-image.negative_prompt")),
      seed: omit(ref("request.providerOptions.dashscope-qwen-image.seed")),
      watermark: omit(ref("request.watermark"))
    }
  }, { headers: { "X-DashScope-Async": "enable" }, originPath: true }),
  poll: { method: "GET", path: "/api/v1/tasks/{{taskId}}", originPath: true },
  response: asyncResponse("image", {
    taskId: coalesce(ref("response.output.task_id"), ref("response.task_id"), ref("taskId")),
    status: coalesce(ref("response.output.task_status"), ref("response.status"), "pending"),
    message: coalesce(ref("response.output.message"), ref("response.message")),
    images: map(ref("response.output.choices.0.message.content"), "item", { url: omit(ref("item.image")) }),
    errorPaths: ["code", "output.code"], messagePaths: ["message", "output.message"]
  })
});

// 千问 AI 平台（QianWenAI MAAS）是阿里独立的 MaaS 站点，网关域名是
// maas.qianwenaiapi.com，与百炼的 dashscope.aliyuncs.com 不是同一入口，因此单列一个插件。
// 它同样走多模态图像端点 multimodal-generation/generation，报文形状与百炼一致
// （input.messages[].content[].image + text），但不能复用百炼插件：改 Base URL 后仍指向
// dashscope.aliyuncs.com，请求会打到没有开通该模型的站点。
const qianwenaiMaasImageSizes = [
  ["1:1", "1024*1024"], ["3:4", "960*1280"], ["4:3", "1280*960"], ["2:3", "1024*1536"], ["3:2", "1536*1024"],
  ["9:16", "864*1536"], ["16:9", "1536*864"],
  ["1024x1024", "1024*1024"], ["1024x1536", "1024*1536"], ["1536x1024", "1536*1024"],
  ["1024x1280", "1024*1280"], ["1280x1024", "1280*1024"], ["960x1280", "960*1280"], ["1280x960", "1280*960"]
];

add({
  id: "qianwenai-maas-image", providerId: "qianwenai-maas-image", name: "QianWenAI MAAS", vendor: "Alibaba QianWenAI", capability: "image",
  baseUrl: "https://maas.qianwenaiapi.com", auth: bearer, params: imageParams, requiresPublicMediaUrls: false,
  notes: "千问 AI 平台（QianWenAI MAAS）多模态图像端点（multimodal-generation 异步任务）。文生图与图生图共用同一入口：不传 image 为文生图，传参考图为图生图。参考图通过 input.messages[].content[].image 传输（优先 Base64 data URL）。size 采用“宽*高”，未登记的档位省略并由模型自动推荐；enable_thinking 固定为 false，因为官方要求非流式调用关闭思考模式。",
  create: jsonCreate("/api/v1/services/aigc/multimodal-generation/generation", {
    model: ref("request.model"),
    input: {
      messages: [{
        role: "user",
        content: {
          $concatArrays: [
            map(sorted(ref("request.images")), "media", { image: coalesce(ref("media.dataUrl"), ref("media.url")) }),
            [{ text: ref("request.prompt") }]
          ]
        }
      }]
    },
    parameters: {
      size: omit({ $switch: { cases: qianwenaiMaasImageSizes.map(([ratio, size]) => ({ when: eq(ref("request.aspectRatio"), ratio), then: size })), default: null } }),
      n: conditional(gt({ $toInt: ref("request.imageCount") }, 0), { $toInt: ref("request.imageCount") }, 1),
      prompt_extend: true,
      enable_thinking: false,
      negative_prompt: omit(ref("request.providerOptions.qianwenai-maas-image.negative_prompt")),
      seed: omit(ref("request.providerOptions.qianwenai-maas-image.seed")),
      watermark: omit(ref("request.watermark"))
    }
  }, { headers: { "X-DashScope-Async": "enable" }, originPath: true }),
  poll: { method: "GET", path: "/api/v1/tasks/{{taskId}}", originPath: true },
  response: asyncResponse("image", {
    taskId: coalesce(ref("response.output.task_id"), ref("response.task_id"), ref("taskId")),
    status: coalesce(ref("response.output.task_status"), ref("response.status"), "pending"),
    message: coalesce(ref("response.output.message"), ref("response.message")),
    images: map(ref("response.output.choices.0.message.content"), "item", { url: omit(ref("item.image")) }),
    errorPaths: ["code", "output.code"], messagePaths: ["message", "output.message"]
  })
});

for (const [id, name, vendor, capability, baseUrl, createPath, pollPath, requestShape] of [
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
  const params = capability === "image" ? imageParams : videoParams;
  const optionPath = `request.providerOptions.${id}`;
  const standardFields = capability === "image"
      ? { model: ref("request.model"), prompt: ref("request.prompt"), images: omit(map(ref("request.images"), "media", ref("media.value"))), parameters: omit(ref(`${optionPath}.parameters`)) }
      : { model: ref("request.model"), prompt: ref("request.prompt"), images: omit(map(ref("request.images"), "media", ref("media.value"))), videos: omit(map(ref("request.videos"), "media", ref("media.value"))), audios: omit(map(ref("request.audios"), "media", ref("media.value"))), duration: omit(ref("request.duration")), aspect_ratio: omit(ref("request.aspectRatio")), resolution: omit(ref("request.resolution")), parameters: omit(ref(`${optionPath}.parameters`)) };
  const standard = { $merge: [standardFields, coalesce(ref(`${optionPath}.body`), ref(`${optionPath}.extra_body`), {})] };
  let auth = bearer;
  let configuration;
  let operationExtra = id.startsWith("dashscope-") ? { headers: { "X-DashScope-Async": "enable" } } : {};
  if (id.startsWith("tencent-")) {
    auth = { type: "tc3", field: "apiKey", secretField: "secretKey", service: "hunyuan" };
    configuration = { fields: [{ name: "apiKey", type: "secret", label: "SecretId", required: true }, { name: "secretKey", type: "secret", label: "SecretKey", required: true }] };
    operationExtra = { headers: { "X-TC-Action": ref(`${optionPath}.action`), "X-TC-Version": ref(`${optionPath}.version`) } };
  }
  add({
    id, providerId: id, name, vendor, capability, baseUrl, auth, params, configuration,
    notes: `该协议的模型级字段变化快或依赖云资源配置。插件固定线协议入口和统一字段，完整厂商对象通过 providerOptions.${id} 的 parameters/input/extra_body 传入；${requestShape}。云签名型入口在未配置对应鉴权驱动时会明确失败，不会伪装成 Bearer 成功。`,
    create: jsonCreate(createPath, standard, operationExtra),
    poll: pollPath ? { method: "GET", path: pollPath } : undefined,
    response: pollPath ? asyncResponse(capability) : { status: "succeeded", [capability + "s"]: coalesce(ref("response.data"), ref("response.output"), ref("response.url")), errorPaths: ["error.code", "code"], messagePaths: ["error.message", "message"] }
  });
}

for (const [id, name, capability, createPath, pollPath, resultPath] of [
  ["fal-queue-image", "fal.ai Queue Image", "image", "/{{model}}", "/{{request.providerOptions.fal-queue-image.statusPath}}", "response.images"],
  ["fal-queue-video", "fal.ai Queue Video", "video", "/{{model}}", "/{{request.providerOptions.fal-queue-video.statusPath}}", "response.video"],
  ["replicate-prediction-image", "Replicate Predictions Image", "image", "/v1/predictions", "/v1/predictions/{{taskId}}", "response.output"],
  ["replicate-prediction-video", "Replicate Predictions Video", "video", "/v1/predictions", "/v1/predictions/{{taskId}}", "response.output"],
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
        ...(spec.imageParameters ? { imageParameters: spec.imageParameters } : {}),
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
  const rows = [];
  collectTemplateFields(operation, label, rows);
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

// Manifests own text policies; do not keep a second
// catalog of vendor templates that can silently revert protocol repairs.
for (const id of await packageDirectories(root)) {
  const manifest = JSON.parse(await readFile(join(root, id, "manifest.json"), "utf8"));
  const providers = manifest.contributes?.providers || [];
  if (!providers.some((provider) => provider.capabilities?.includes("text"))) continue;
  if (manifest.id !== id) {
    throw new Error(`text package ${id} must use its canonical directory`);
  }
  const provider = providers.find((provider) => provider.capabilities?.includes("text"));
  add({
    ...provider,
    id,
    providerId: provider.id,
    name: manifest.name,
    capability: provider.capabilities.join(", "),
    configuration: manifest.configuration,
    params: (provider.parameters || []).map(({ name, type, required, mapping, description }) => [name, type, required, mapping, description]),
    sourceManifest: manifest
  });
}

function refreshTextDocumentation(source, spec) {
  const generated = docsFor(spec);
  // Only inventories are generated. Keep custom sections and surrounding prose.
  for (const heading of ["协议身份", "配置字段", "统一字段映射", "上游请求模板逐字段清单", "Provider 扩展键", "响应映射逐字段清单"]) {
    const section = new RegExp(`(^## ${heading}\\n)([\\s\\S]*?)(?=^## |^<!-- YINGCE_MANIFEST_CONTRACT_START -->|(?![\\s\\S]))`, "m");
    const fresh = generated.match(section);
    if (!fresh) throw new Error(`missing generated section ${heading}`);
    const block = heading === "协议身份" || heading === "Provider 扩展键" ? /(?:^- .*\n)+/m : /(?:^\|.*\n)+/m;
    const inventory = fresh[2].match(block)?.[0];
    if (!inventory) throw new Error(`missing generated inventory ${heading}`);
    if (section.test(source)) {
      source = source.replace(section, (_, title, body) => title + (block.test(body) ? body.replace(block, () => inventory) : `\n${inventory}\n${body}`));
    } else {
      const inventorySection = `\n## ${heading}\n\n${inventory}\n`;
      const contractStart = source.indexOf("<!-- YINGCE_MANIFEST_CONTRACT_START -->");
      source = contractStart < 0 ? source + inventorySection : source.slice(0, contractStart) + inventorySection + source.slice(contractStart);
    }
  }
  return source;
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
  if (spec.sourceManifest) {
    const interfacePath = join(dir, "docs", "interface.md");
    const source = (await readFile(interfacePath, "utf8")).replace(/\r\n?/g, "\n");
    await writeFile(interfacePath, refreshTextDocumentation(source, spec));
    continue;
  }
  await mkdir(join(dir, "docs"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifestFor(spec), null, 2) + "\n");
  await writeFile(join(dir, "README.md"), `# ${spec.name}\n\n该目录是独立官方协议插件源码。后端从生成的 \`${spec.id}.yingce-plugin\` 包加载，不依赖系统内置 \`host:\` 适配器。\n\n完整接口见 [docs/interface.md](docs/interface.md)。\n`);
  await writeFile(join(dir, "docs", "interface.md"), docsFor(spec));
}

console.log(`generated ${selectedSpecs.length} protocol packages`);
await import("./embed-documentation.mjs");
