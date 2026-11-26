export function sensenovaImageSpec({ ref, omit, coalesce, map, filter, eq, gt, gte, lte, and, len, lower, trim, toFloat, split, at, conditional, sorted }) {
  const id = "sensenova-image";
  const model = "sensenova-u1.6-lite";
  const request = (name) => ref(`request.${name}`);
  const option = (name) => request(`providerOptions.${id}.${name}`);
  const bound = (name) => ref(`bindings.${name}`);
  // Template arrays omit nil values; keep nullable enums literal so a missing $ref stays valid.
  const oneOf = (value, values) => ({ $in: [value, { $literal: values }] });
  const or = (...values) => ({ $or: values });
  const multiply = (...values) => ({ $multiply: values });
  const matches = (value, pattern) => ({ $countMatches: [value, pattern] });
  const checked = (assert, message) => ({ assert, message: `SenseNova U1.6 Lite · ${message}` });
  const inside = (value, minimum, maximum) => and(gte(value, minimum), lte(value, maximum));
  const size = bound("size"), width = bound("width"), height = bound("height");
  const images = sorted(request("images"));
  const validMedia = and(
    eq(ref("media.value"), { $toString: ref("media.value") }),
    eq(matches(trim(ref("media.value")), "^(?:https?://[^\\s]+|data:image/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2})$"), 1),
  );
  const validSize = and(
    eq(len(split(size, "x")), 2),
    eq(matches(size, "^[0-9]+x[0-9]+$"), 1),
    inside(width, 512, 4096), inside(height, 512, 4096),
    eq(width, { $ceilStep: [width, 32] }), eq(height, { $ceilStep: [height, 32] }),
    lte(width, multiply(height, 3)), lte(height, multiply(width, 3)),
  );
  const supportedOptions = ["output_format", "watermark", "prompt_extend", "self_correction"];
  const expectedOptions = Object.fromEntries(supportedOptions.map((name) => [name, option(name)]));
  const usable = (name) => gt(len(trim(ref(`item.${name}`))), 0);
  // URL is the documented production response; b64_json is only a host-compatible fallback.
  const successItems = filter(ref("response.data"), "item", or(usable("url"), usable("b64_json")));
  const imageCount = len(successItems);
  const hasError = { $ne: [ref("response.error"), null] };
  const succeeded = and({ $not: hasError }, eq(imageCount, 1));
  const imageResults = map(successItems, "item", {
    url: omit(ref("item.url")), dataUrl: omit(ref("item.b64_json")),
    size: omit(coalesce(ref("item.size"), ref("response.size"))),
    output_format: omit(coalesce(ref("response.output_format"), "png")),
  });
  // Preserve native usage; only the documented count fields gain host billing aliases.
  const usage = { $merge: [ref("response.usage"), {
    input_images: omit(ref("response.usage.input_image_count")),
    generated_images: omit(ref("response.usage.output_image_count")),
  }] };
  const recommendedSizes = ["2048x2048", "2720x1536", "1536x2720", "1664x2496", "2496x1664", "4096x4096"];
  return {
    id, providerId: id, name: "SenseNova U1.6 Lite Image", vendor: "SenseNova", version: "2.0.0", capability: "image",
    baseUrl: "https://token.sensenova.cn", auth: { type: "bearer", field: "apiKey" }, requiresPublicMediaUrls: false,
    description: "SenseNova U1.6 Lite 同步 JSON 图片生成与编辑协议。",
    readmeIntro: "SenseNova U1.6 Lite 官方文档对应的独立图片协议，采用同步 JSON 请求。配置 API Key 与模型 sensenova-u1.6-lite 后使用；不包含文本、视频或音频能力。",
    imageParameters: [
      { name: "size", label: "画幅 / 尺寸", type: "string", binding: "aspectRatio", encoding: "pixels", values: ["auto", ...recommendedSizes], default: "auto", pricing: true },
      { name: "imageResolution", label: "分辨率", type: "string", binding: "resolution", enabled: false },
      { name: "quality", label: "图片质量", type: "string", binding: "quality", enabled: false },
      { name: "count", label: "生成数量", type: "integer", binding: "imageCount", min: 1, max: 1, step: 1, default: 1 },
      { name: "transparentBackground", label: "透明背景", type: "boolean", binding: "transparentBackground", default: false, enabled: false },
      { name: "outputFormat", label: "输出格式", type: "string", binding: `providerOptions.${id}.output_format`, values: ["png", "jpeg", "webp"], default: "png" },
      { name: "watermark", label: "官方水印", type: "boolean", binding: `providerOptions.${id}.watermark`, default: true, description: "禁用此参数时固定发送 false；启用后按默认值或本次选择发送。" },
      { name: "promptExtend", label: "提示词扩写", type: "boolean", binding: `providerOptions.${id}.prompt_extend`, default: true },
      { name: "selfCorrection", label: "文字 / 画质自修正", type: "boolean", binding: `providerOptions.${id}.self_correction`, default: true },
    ],
    params: [
      ["model", "string", true, "model", "仅支持 sensenova-u1.6-lite。"],
      ["prompt", "string", true, "prompt", "非空图片提示词；编辑时描述期望最终画面，官方未说明最大长度。"],
      ["images", "media[]", false, "images[].image_url", "无参考图走 generations，有参考图走 edits；编辑总计 1–5 张，按 order 保持顺序，首张是主编辑图，支持公网 HTTP/HTTPS URL 或完整图片 Data URL，不支持 mask。"],
      ["imageCount", "integer", false, "n", "仅支持 1，未设置时同样发送 1。"],
      ["aspectRatio", "string", false, "size", "auto 或宽x高：各边 512–4096 且为 32 倍数，比例 1:3–3:1；界面提供官方六个推荐尺寸，不把比例、2K、4K 字面量发送上游。"],
      ["providerOptions", "object", false, "output_format / watermark / prompt_extend / self_correction", "仅允许 sensenova-image 命名空间内四个文档化扩展字段；输出 png/jpeg/webp。watermark 缺失时发送 false；参数启用时按默认值或本次选择发送。prompt_extend/self_correction 默认 true；显式 false 保留。"],
    ],
    requestBindings: [
      { name: "size", value: coalesce(lower(trim(request("aspectRatio"))), "auto") },
      { name: "width", value: toFloat(at(split(size, "x"), 0)) },
      { name: "height", value: toFloat(at(split(size, "x"), 1)) },
    ],
    validations: [
      checked(eq(request("model"), model), "仅支持 sensenova-u1.6-lite。"),
      checked(gt(len(trim(request("prompt"))), 0), "提示词不能为空。"),
      checked(and(eq(len(request("videos")), 0), eq(len(request("audios")), 0)), "图片协议不接受视频或音频输入。"),
      checked(lte(len(images), 5), "编辑最多接受 5 张图片（含首张主图）。"),
      checked(eq(len(filter(images, "media", eq(ref("media.role"), "mask"))), 0), "不支持蒙版（mask），请使用提示词描述修改区域。"),
      checked(eq(len(filter(images, "media", { $not: validMedia })), 0), "图片须使用公网 HTTP/HTTPS URL 或带完整 MIME 前缀的 Base64 Data URL。"),
      checked(oneOf(request("imageCount"), [null, 0, 1]), "生成数量仅支持 1。"),
      checked(or(eq(size, "auto"), validSize), "size 须为 auto 或宽x高：各边 512–4096、32 的倍数，比例 1:3 到 3:1。"),
      checked(oneOf(lower(trim(request("quality"))), ["", "auto"]), "未声明 quality 质量档位，请移除该参数。"),
      checked(oneOf(request("extra.transparentBackground"), [null, "", false, "false"]), "不支持透明背景，请关闭该参数。"),
      checked(or(eq(request(`providerOptions.${id}`), null), eq(request(`providerOptions.${id}`), expectedOptions)), "扩展参数包含未知键或空值。"),
      checked(oneOf(coalesce(lower(trim(option("output_format"))), "png"), ["png", "jpeg", "webp"]), "输出格式仅支持 png、jpeg、webp。"),
      ...supportedOptions.filter((name) => name !== "output_format").map((name) => checked(oneOf(option(name), [null, true, false]), `${name} 必须为布尔值。`)),
    ],
    create: {
      method: "POST", path: "/v1/images/generations", contentType: "application/json",
      pathTemplate: conditional(gt(len(images), 0), "/v1/images/edits", "/v1/images/generations"),
      body: {
        model: request("model"), prompt: trim(request("prompt")), size, n: 1,
        images: conditional(gt(len(images), 0), map(images, "media", { image_url: trim(ref("media.value")) })),
        response_format: "url", output_format: coalesce(lower(trim(option("output_format"))), "png"),
        // Disabled model parameters have no value; do not restore the vendor's true default.
        watermark: coalesce(option("watermark"), false), prompt_extend: coalesce(option("prompt_extend"), true), self_correction: coalesce(option("self_correction"), true),
        // Explicit null declarations suppress the host's OpenAI endpoint supplementation.
        quality: null, background: null,
      },
    },
    response: {
      status: conditional(succeeded, "succeeded", "failed"),
      message: coalesce(ref("response.error.message"), conditional(hasError, "SenseNova U1.6 Lite 返回错误对象", conditional(eq(imageCount, 0), "SenseNova U1.6 Lite 没有返回可用图片", conditional(gt(imageCount, 1), "SenseNova U1.6 Lite 返回图片数量违反 n=1 合同")))),
      images: conditional(succeeded, imageResults, []), usage, resultEphemeral: true,
      errorPaths: ["error"], messagePaths: ["error.message"],
    },
    notes: "官方平台 https://platform.sensenova.cn/docs#model-u1-6-lite；Base URL 为 https://token.sensenova.cn，Bearer API Key，模型 sensenova-u1.6-lite。无参考图 POST /v1/images/generations，有参考图 POST /v1/images/edits；两者 Content-Type 均为 application/json，不使用 multipart。编辑输入总计 1–5 张，按 order 顺序发送，首张为主图；公网 HTTP/HTTPS 图片 URL 或完整 data:image/{format};base64,...，不接受裸 Base64，不支持 mask。\n\nsize 为 auto 或宽x高：每边 512–4096、32 的倍数，宽高比 1:3–3:1。官方六个推荐尺寸是 2048x2048、2720x1536、1536x2720、1664x2496、2496x1664、4096x4096，界面默认提供这些尺寸与 auto；推荐值不是上游全部枚举，底层协议校验支持规则范围内的其他明确像素尺寸。auto 编辑适配主图，但文档没有保证保留原像素或裁切方式。n 仅 1。不发送 aspect_ratio、area、resolution、quality、background、mask、output_compression 或 stream。\n\n固定 response_format=url，output_format 默认 png（支持 png/jpeg/webp）；图片协议 2.0.0 在官方水印参数禁用或取值缺失时明确发送 watermark=false，不回退为供应商默认 true；启用时按模型默认值（初始 true）或本次选择发送。prompt_extend/self_correction 默认 true；三个开关显式 false 均保留。已锁版模型需显式绑定新发行版，旧任务快照保持不变。无水印功能处于公测权益，不能据此保证整个模型免费。扩展字段只通过 providerOptions.sensenova-image 命名空间绑定。\n\n同步响应，data[].url 为官方示例格式，根 size、output_format 和 usage 保留；只将已存在的 input_image_count/output_image_count 白名单映射为宿主 input_images/generated_images 供计费强校验使用，不填造缺失值，0 保留。24 小时临时 URL 声明为 ephemeral，由宿主立即下载持久化。宿主兼容 data[].b64_json，但本地此分支使用 synthetic fixture，仅证明宿主解析，不是供应商真实响应 schema 或实测。错误对象、空 data、未知响应或不符合 n=1 的有效图片数量保持失败；不定义轮询、异步任务或自动重发。同步 POST 超时/取消后结果和扣费可能未知，文档没有幂等保证，重发可能产生重复费用。\n\n本实现只依据公开文档及本地 fixture，未调用真实供应商 API。未编造最大 prompt 长度、输入 MB/像素限制、输入完整格式枚举、费用、并发、延迟或 SLA；真实 Base64 schema、auto 编辑、多图质量、费用和下载时延仍需账户授权后验收。",
  };
}
