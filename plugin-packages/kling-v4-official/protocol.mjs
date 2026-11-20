import { readFileSync } from "node:fs";

const videoModes = JSON.parse(readFileSync(new URL("./video-modes.json", import.meta.url), "utf8"));

export function klingV4Spec({ ref, omit, coalesce, addNumbers, multiply, map, filter, eq, ne, gt, gte, lte, and, len, trim, at, conditional, first, sorted }) {
  const id = "kling-v4-official";
  const models = ["kling-4.0", "kling-4.0-flash"];
  const videoOutputs = {
    "kling-4.0": { resolutions: ["720p", "1080p"], minSeconds: 3, maxSeconds: 30, generateAudio: false },
    "kling-4.0-flash": { resolutions: ["720p"], minSeconds: 3, maxSeconds: 20, generateAudio: false },
  };
  const imageRoles = ["first_frame", "middle_frame", "last_frame", "refer_image"];
  const videoRoles = ["feature_video", "base_video"];
  const options = ["imageRoles", "videoRoles", "imageIds", "videoIds", "elements", "voices", "audio"];
  const request = (path) => ref(`request.${path}`);
  const option = (name) => request(`providerOptions.${id}.${name}`);
  const bound = (name) => ref(`bindings.${name}`);
  const or = (...items) => ({ $or: items });
  const not = (value) => ({ $not: value });
  const oneOf = (value, choices) => ({ $in: [value, choices] });
  const concat = (...values) => ({ $concat: values });
  const join = (...values) => ({ $concatArrays: values });
  const matches = (value, pattern) => ({ $countMatches: [value, pattern] });
  const inside = (value, low, high) => and(gte(value, low), lte(value, high));
  const all = (values, alias, test) => eq(len(filter(values, alias, not(test))), 0);
  const byType = (items, type) => filter(items, "part", eq(ref("part.type"), type));
  const stringId = (value) => and(eq(value, { $toString: value }), gt(len(trim(value)), 0));
  const checked = (assert, message) => ({ assert, message: `可灵 4.0 · ${message}` });
  const model = request("model");
  const flash = eq(model, models[1]);
  const maxSeconds = conditional(flash, videoOutputs[models[1]].maxSeconds, videoOutputs[models[0]].maxSeconds);
  const operation = request("operation");
  const textMode = "text_to_video", frameMode = "image_to_video", omniMode = "reference_to_video";
  const text = eq(bound("operation"), textMode), frames = eq(bound("operation"), frameMode), omni = eq(bound("operation"), omniMode);
  const duration = request("output.duration"), ratio = request("output.aspectRatio"), resolution = request("output.resolution");
  const elements = option("elements"), voices = option("voices"), audio = option("audio");
  const total = (items, alias, field) => ({ $sum: map(items, alias, ref(`${alias}.${field}`)) });
  const wireImages = bound("imageParts"), wireVideos = bound("videoParts");
  const images = sorted(request("images")), videos = sorted(request("videos"));
  const index = ref("mediaIndex"), role = ref("media.role");
  const firstDefault = and(eq(len(images), 1), ne(operation, omniMode));
  const inferredImageRole = conditional(oneOf(role, ["reference_image", "refer_image"]), "refer_image",
    conditional(oneOf(role, ["", "reference"]), conditional(firstDefault, "first_frame", "refer_image"), role));
  const mediaPart = (kind) => {
    const isImage = kind === "image";
    return map(isImage ? images : videos, "media", {
      type: coalesce(at(option(`${kind}Roles`), index), isImage ? inferredImageRole : conditional(oneOf(role, ["", "reference", "reference_video"]), "feature_video", role)),
      url: ref("media.url"),
      id: coalesce(at(option(`${kind}Ids`), index), concat(isImage ? "Image" : "Video", addNumbers(index, 1))),
    });
  };
  const imageParts = join(byType(wireImages, "first_frame"), filter(wireImages, "part", oneOf(ref("part.type"), ["middle_frame", "refer_image"])), byType(wireImages, "last_frame"));
  const elementsOnWire = map(elements, "element", { type: "element", element_id: ref("element.element_id"), id: ref("element.id") });
  const voicesOnWire = map(voices, "voice", { type: "voice", voice_id: ref("voice.voice_id"), id: ref("voice.id") });
  const requestBindings = Object.entries({
    imageParts: mediaPart("image"), videoParts: mediaPart("video"),
    videoElements: filter(elements, "element", eq(ref("element.elementType"), "video_character_elements")),
    parts: join(imageParts, wireVideos, elementsOnWire, voicesOnWire),
    operation: coalesce(operation, conditional(or(len(byType(wireImages, "refer_image")), len(wireVideos), len(elements), len(voices)), omniMode, conditional(len(wireImages), frameMode, textMode))),
  }).map(([name, value]) => ({ name, value }));

  const firstFrames = byType(wireImages, "first_frame"), lastFrames = byType(wireImages, "last_frame");
  const nonAscii = matches(request("prompt"), "[^\\x00-\\x7f]");
  const inputArray = (value) => eq(value, map(value, "entry", ref("entry")));
  const optionValidations = options.filter((name) => name !== "audio").map((name) => checked(or(eq(option(name), null), inputArray(option(name))), `${name} 须为数组。`));
  for (const [kind, values, roles] of [["image", images, imageRoles], ["video", videos, videoRoles]]) {
    for (const suffix of ["Roles", "Ids"]) {
      const valuesOption = option(`${kind}${suffix}`);
      optionValidations.push(checked(or(eq(valuesOption, null), and(eq(len(valuesOption), len(values)), all(valuesOption, "entry", suffix === "Roles" ? oneOf(ref("entry"), roles) : stringId(ref("entry"))))), `${kind}${suffix} 须与素材逐项对应，角色或引用 ID 无效。`));
    }
  }
  const mediaValidations = (items, isImage) => {
    const value = (field) => ref(`media.metadata.${field}`);
    const width = value("width"), height = value("height"), seconds = value("durationMs");
    return [
      checked(all(items, "media", { $publicHttpsUrl: ref("media.url") }), "请提供交付给上游的 HTTPS 素材地址。"),
      checked(all(items, "media", oneOf(ref("media.mimeType"), isImage ? ["image/png", "image/jpeg"] : ["video/mp4", "video/quicktime"])), isImage ? "图片支持 JPEG、PNG。" : "视频支持 MP4、MOV。"),
      checked(all(items, "media", inside(value("bytes"), 1, isImage ? 30000000 : 300000000)), isImage ? "图片须有大小信息且不超过 30 MB。" : "视频须有大小信息且不超过 300 MB。"),
      checked(all(items, "media", and(gte(width, isImage ? 300 : 700), gte(height, isImage ? 300 : 700), lte(multiply(2, width), multiply(5, height)), lte(multiply(2, height), multiply(5, width)))), "素材宽高或宽高比超出限制。"),
      ...isImage ? [] : [
        checked(all(items, "media", and(lte(width, 4553), lte(height, 4553), lte(multiply(width, height), 8294400))), "视频尺寸或像素面积超出限制。"),
        checked(all(items, "media", inside(seconds, 3000, multiply(1000, maxSeconds))), "每段视频须提供有效时长，标准版 3–30 秒，Flash 3–20 秒。"),
        checked(all(items, "media", or(eq(value("fps"), null), inside(value("fps"), 24, 60))), "参考视频帧率须为 24–60 fps。"),
      ],
    ];
  };
  const videoElements = bound("videoElements"), parts = bound("parts");
  const expectedOptions = Object.fromEntries(options.map((name) => [name, option(name)]));
  const allowedOptions = or(eq(request(`providerOptions.${id}`), null), eq(request(`providerOptions.${id}`), expectedOptions));
  const mediaIdentity = (items) => map(items, "media", { kind: ref("media.kind"), id: ref("media.id"), role, url: ref("media.url"), dataUrl: ref("media.dataUrl") });
  const validations = [
    checked(oneOf(model, models), "请选择 kling-4.0 或 kling-4.0-flash。"),
    checked(and(gt(len(trim(request("prompt"))), 0), lte(addNumbers(multiply(11, len(request("prompt"))), multiply(15, nonAscii)), 286000)), "请填写提示词，英文最多 26000 字符，非英文最多 11000 字符，混合输入按比例折算。"),
    checked(or(eq(duration, null), inside(duration, videoOutputs[models[0]].minSeconds, maxSeconds)), "标准版支持 3–30 秒，Flash 支持 3–20 秒。"),
    checked(or(eq(resolution, null), conditional(flash, oneOf(resolution, videoOutputs[models[1]].resolutions), oneOf(resolution, videoOutputs[models[0]].resolutions))), "标准版支持 720p / 1080p，Flash 支持 720p。"),
    checked(or(eq(request("extra.videoSeconds"), null), eq(request("extra.videoSeconds"), ""), eq(request("extra.videoSeconds"), { $toString: duration })), "输出秒数格式无效。"),
    checked(allowedOptions, "扩展参数包含未知键或空值。"), ...optionValidations,
    checked(eq(len(request("audios")), 0), "原始音频不能作为素材上传。标准版可按 voice_id 引用音色。"),
    checked(eq(mediaIdentity(request("inputs")), mediaIdentity(join(request("images"), request("videos"), request("audios")))), "输入素材须与按类型提供的素材一致。"),
    checked(or(eq(request("output.count"), null), eq(request("output.count"), 1)), "每个任务生成一个视频。"),
    checked(or(not(text), eq(len(parts), 0)), "文生视频只接受提示词。请移除素材或选择全能参考。"),
    checked(or(not(frames), and(gt(len(wireImages), 0), eq(len(parts), len(wireImages)), eq(len(byType(wireImages, "refer_image")), 0))), "图生视频需要关键帧，参考素材请选择全能参考。"),
    checked(or(not(omni), gt(len(parts), 0)), "全能参考至少需要一份参考素材。"),
    checked(and(all(images, "media", oneOf(role, ["", "reference", "reference_image", ...imageRoles])), all(wireImages, "part", oneOf(ref("part.type"), imageRoles))), "图片角色无效。"),
    checked(and(all(videos, "media", oneOf(role, ["", "reference", "reference_video", ...videoRoles])), all(wireVideos, "part", oneOf(ref("part.type"), videoRoles))), "视频角色无效。"),
    checked(and(lte(len(parts), 15), lte(len(wireImages), 10), lte(len(firstFrames), 1), lte(len(lastFrames), 1)), "总素材最多 15 份、图片最多 10 张，首尾帧各限一张。"),
    checked(or(not(flash), and(eq(len(lastFrames), 0), eq(len(byType(wireImages, "middle_frame")), 0), eq(len(voices), 0))), "Flash 仅支持首帧和参考图，不能使用中间帧、尾帧或音色。"),
    checked(or(not(and(flash, frames)), eq(option("imageIds"), null)), "Flash 图生的首帧不接受引用 ID。"),
    checked(and(lte(len(elements), 7), lte(len(videoElements), 3), lte(addNumbers(len(videoElements), len(wireVideos)), 5), lte(len(byType(wireVideos, "base_video")), 1), lte(len(voices), 3)), "超出视频、主体或音色数量限制，待编辑视频最多一段。"),
    checked(all(elements, "element", and(stringId(ref("element.element_id")), stringId(ref("element.id")), oneOf(ref("element.elementType"), ["multi_image_elements", "video_character_elements"]))), "主体需要 element_id、引用 id 和 elementType。"),
    checked(all(videoElements, "element", inside(ref("element.durationSeconds"), 3, 8)), "视频角色主体须提供 3–8 秒的源视频时长。"),
    checked(all(voices, "voice", and(stringId(ref("voice.voice_id")), stringId(ref("voice.id")))), "音色需要 voice_id 和引用 id。"),
    checked(all(parts, "part", eq(len(filter(parts, "other", eq(ref("other.id"), ref("part.id")))), 1)), "同一任务内的素材引用 ID 必须唯一。"),
    checked(or(eq(audio, null), and(omni, or(eq(audio, "native"), and(eq(audio, "original"), gt(len(wireVideos), 0), eq(len(voices), 0))))), "音频模式仅用于全能参考，original 需要输入视频且不能同时引用音色。"),
    ...mediaValidations(images, true), ...mediaValidations(videos, false),
    checked(lte(addNumbers(total(videos, "video", "metadata.durationMs"), multiply(1000, total(videoElements, "element", "durationSeconds"))), multiply(1000, maxSeconds)), "输入视频和视频主体总时长超出型号限制。"),
  ];

  const contents = join([{ type: "prompt", text: request("prompt") }], conditional(and(flash, frames), map(firstFrames, "frame", { type: "first_frame", url: ref("frame.url") }), parts));
  const task = conditional(ref("taskId"), first(filter(ref("response.data"), "entry", eq(ref("entry.id"), ref("taskId")))), ref("response.data"));
  const onTask = (value) => first(map([coalesce(task, { missing: true })], "task", value));
  const resultUrl = conditional(request("output.watermark"), ref("output.watermark_url"), ref("output.url"));
  const outputs = filter(ref("task.outputs"), "output", and(eq(ref("output.type"), "video"), { $publicHttpsUrl: resultUrl }));
  const status = ref("task.status"), codeOk = eq(ref("response.code"), 0);
  const validTask = and(codeOk, stringId(ref("task.id")), oneOf(status, ["submitted", "processing", "succeeded", "failed"]), or(ne(status, "succeeded"), gt(len(outputs), 0)));
  return {
    id, providerId: id, name: "Kling 4.0 Official API", vendor: "Open AI Canvas contributors", capability: "video", version: "1.2.0", baseUrl: "",
    requiresPublicMediaUrls: true, detachedPolling: true, auth: { type: "bearer", field: "apiKey" }, requestBindings, validations, videoModes, videoOutputs,
    params: [
      ["model", "string", true, "URL path", "kling-4.0 或 kling-4.0-flash。"], ["operation", "string", false, "endpoint", "文生、图生、全能参考可显式选择。"],
      ["prompt", "string", true, "prompt / contents[].text", "英文与非英文按官方混合配额校验。"], ["images", "media[]", false, "contents", "首帧、中间帧、尾帧、参考图。"],
      ["videos", "media[]", false, "contents", "特征参考或待编辑视频。"], ["duration", "integer", false, "settings.duration", "省略时上游从提示词或待编辑视频推断。"],
      ["aspectRatio", "string", false, "settings.aspect_ratio", "图生省略，文生六种固定比例，全能参考另支持 adaptive。"], ["resolution", "string", false, "settings.resolution", "标准版支持 720p 与 1080p，Flash 仅支持 720p。"],
      ["watermark", "boolean", false, "options.watermark_info.enabled", "请求并保存水印版本。"], ["providerOptions", "object", false, "contents / settings.audio", "仅接受本插件声明的素材角色、ID、主体、音色与音频处理选项。"],
    ],
    create: { method: "POST", path: "/text-to-video/{{model}}", originPath: true, contentType: "application/json",
      pathTemplate: concat("/", conditional(text, "text-to-video", conditional(frames, "image-to-video", "omni-video")), "/", model),
      body: { prompt: conditional(text, request("prompt")), contents: conditional(not(text), contents),
        settings: omit({ duration, resolution, aspect_ratio: conditional(not(frames), ratio), audio: conditional(omni, audio) }),
        options: { watermark_info: { enabled: request("watermark") } } } },
    poll: { method: "GET", path: "/tasks", originPath: true, query: { task_ids: ref("taskId") } },
    response: {
      taskId: onTask(ref("task.id")), status: onTask(conditional(validTask, conditional(eq(status, "submitted"), "pending", status), "failed")),
      message: onTask(concat(coalesce(ref("task.message"), ref("response.message"), "可灵任务回执"), " [code=", ref("response.code"), ", request_id=", ref("response.request_id"), "]", conditional(not(validTask), " 任务 ID、状态或视频结果无效。", ""))),
      videos: onTask(conditional(and(validTask, eq(status, "succeeded")), map(outputs, "output", { url: resultUrl, id: ref("output.id") }))),
      usage: onTask(ref("task.usage")), errorPaths: ["code"], resultEphemeral: true,
    },
    notes: "按上游模型与生成方式解析端点。单次创建后按 data.id 在原渠道回查 /tasks。标准版和 Flash 的关键帧、音色、清晰度与总时长限制不同。具体 API 与渠道定价见影策的《官方视频模型与插件版本》。",
    readmeIntro: "使用对应区域的新版 Bearer API Key。中国区地址为 https://api-beijing.klingai.com，国际区为 https://api-singapore.klingai.com。两种型号都可在 Omni 中引用视频。单独提供的北京渠道示例只对无输入视频的组合报价。模型设置从绑定版本读取模式、分辨率和时长范围。",
  };
}
