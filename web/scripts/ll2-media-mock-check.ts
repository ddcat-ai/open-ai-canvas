/**
 * 首页拖图 + 资产库 @ 引用 → H3 content[] 的本机自检，不连真实网关、不产生费用。
 * 运行：cd web && bun run scripts/ll2-media-mock-check.ts
 *
 * 覆盖：文生 / 单图首帧 / 两张图首尾帧 / 多图与视频多参考 / @ 就地替换 /
 * 角色不混用 / 校验上限 / 视频必须是公网 HTTPS / wan3 防御性拦截。
 */
import {
    HOME_DROP_IMAGE_MAX,
    ll2ApplyMentionTags,
    ll2BuildMediaContent,
    ll2HomeMediaKindOf,
    ll2MediaKindOf,
    ll2MediaModeLabel,
    ll2MediaSummary,
    ll2MentionToken,
    ll2ParseMentionTitles,
    ll2ValidateMedia,
    type LL2MediaInput,
    type LL2MediaKind,
} from "../src/services/ll2/ll2-media";
import { LL2_VIDEO_ADAPTERS } from "../src/services/ll2/ll2-video-adapters";
import { ll2GenerateVideo } from "../src/services/ll2/ll2-video";

let passed = 0;
let failed = 0;

function check(label: string, got: unknown, want: unknown) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) passed += 1;
    else failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
}

function item(kind: LL2MediaKind, n: number, patch: Partial<LL2MediaInput> = {}): LL2MediaInput {
    return {
        id: `${kind}-${n}`,
        kind,
        name: `${kind}-${n}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`,
        mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/wav",
        bytes: 1000,
        encodedBytes: 1400,
        dataUrl: `data:${kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/wav"};base64,QUJDRA==`,
        durationSeconds: 5,
        ...patch,
    };
}

console.log("① 生成方式：拖 1 张=首帧，2 张=首尾帧，3 张以上或含视频=多参考");

check("拖图区上限就是 1 张", HOME_DROP_IMAGE_MAX, 1);

const empty = ll2BuildMediaContent([]);
check("无素材 → 文生", [empty.mode, empty.items.length, empty.tags], ["text", 0, []]);

const oneImage = ll2BuildMediaContent([item("image", 1)]);
check("1 张图 → 首帧", [oneImage.mode, oneImage.items.map((x) => x.role), oneImage.tags], ["image", ["first_frame"], [null]]);
check("首帧 URL 是 data URI", oneImage.items[0].image_url?.url.startsWith("data:image/png;base64,"), true);

const twoImages = ll2BuildMediaContent([item("image", 1), item("image", 2)]);
check("2 张图 → 首尾帧（用户要的做首尾帧）", [twoImages.mode, twoImages.items.map((x) => x.role), twoImages.tags], ["frames", ["first_frame", "last_frame"], [null, null]]);
check("首尾帧白话文案不出现专业词", ll2MediaModeLabel(twoImages.mode), "从第一张图，慢慢变到最后一张");

const threeImages = ll2BuildMediaContent([item("image", 1), item("image", 2), item("image", 3)]);
check("3 张图 → 全部 reference_image", [threeImages.mode, threeImages.items.map((x) => x.role)], ["images", ["reference_image", "reference_image", "reference_image"]]);
check("3 张图标签按序编号", threeImages.tags, ["<Picture 1>", "<Picture 2>", "<Picture 3>"]);
check("3 张图不出现 first_frame（角色不混用）", threeImages.items.some((x) => x.role === "first_frame"), false);

const oneVideo = ll2BuildMediaContent([item("video", 1)]);
check("1 段视频 → 视频生", [oneVideo.mode, oneVideo.items.map((x) => x.role), oneVideo.tags], ["video", ["reference_video"], ["<Video 1>"]]);
check("视频项 URL 在 video_url.url", oneVideo.items[0].video_url?.url.startsWith("data:video/mp4;base64,"), true);

const mixed = ll2BuildMediaContent([item("image", 1), item("video", 1), item("audio", 1)]);
check("图 + 片 + 音 → mixed", mixed.mode, "mixed");
check("混合时不出现 first_frame", mixed.items.some((x) => x.role === "first_frame"), false);
check("混合标签按类型独立编号", mixed.tags, ["<Picture 1>", "<Video 1>", "<Audio 1>"]);
check("音频项 type = audio_url", mixed.items[2].type, "audio_url");
check("素材摘要", ll2MediaSummary([item("image", 1), item("image", 2), item("video", 1)]), "2 张图 · 1 段视频");

console.log("\n② H3 payload：媒体项真的进了 content[]");

const h3 = LL2_VIDEO_ADAPTERS["MiniMax-H3"];
const frameArgs = h3.normalize({ model: "MiniMax-H3", prompt: "从这张变到那张", seconds: 5, resolution: "1080P", ratio: "16:9", media: twoImages.items });
const framePayload = h3.buildCreatePayload(frameArgs);
check("H3 参数仍校准为 768P", framePayload.resolution, "768P");
check("首尾帧 content[] = 1 文本 + 2 图片", framePayload.content.length, 3);
check("首尾帧角色顺序", framePayload.content.slice(1).map((x: { role: string }) => x.role), ["first_frame", "last_frame"]);
check("没有编造额外媒体字段", Object.keys(framePayload).sort(), ["content", "duration", "model", "ratio", "resolution"]);
check("万相 3.0 纯文本 payload 未受影响", LL2_VIDEO_ADAPTERS["wan3.0-video"].buildCreatePayload(
    LL2_VIDEO_ADAPTERS["wan3.0-video"].normalize({ model: "wan3.0-video", prompt: "一只猫", seconds: 5, resolution: "480P", ratio: "16:9" }),
).prompt, "一只猫");

console.log("\n③ @ 引用：从资产库选多个，提示词就地换成网关标签");

check("生成引用标记", ll2MentionToken("海边照片"), "@[海边照片]");
check("按顺序解析多个 @", ll2ParseMentionTitles("@[海边照片] 和 @[小猫] 走在雨里"), ["海边照片", "小猫"]);
check("同一个素材引用两次仍算两次", ll2ParseMentionTitles("@[A] 与 @[A] 对视"), ["A", "A"]);

// 场景：拖 1 张图 + @ 两张图 = 3 张 → 多参考，拖图的标签前置，两个 @ 就地替换。
const dropAndMentions = ll2BuildMediaContent([item("image", 1), item("image", 2), item("image", 3)]);
const inPlace = ll2ApplyMentionTags("@[图二] 和 @[图三] 走在雨里", dropAndMentions, 1);
check("拖图标签前置 + @ 就地替换", inPlace, "<Picture 1> <Picture 2> 和 <Picture 3> 走在雨里");

// 场景：拖 1 张 + @ 1 张 = 2 张 → 首尾帧，没有标签，@ 标记被去掉。
const frameInPlace = ll2ApplyMentionTags("让 @[图二] 慢慢出现", ll2BuildMediaContent([item("image", 1), item("image", 2)]), 1);
check("首尾帧模式不把 @ 发给网关", frameInPlace, "让 慢慢出现");

// 场景：只拖一张、没有 @ → 提示词原样保留。
const onlyDrop = ll2ApplyMentionTags("一只猫跑过雨夜的街", oneImage, 1);
check("纯拖图不改用户原句", onlyDrop, "一只猫跑过雨夜的街");

// 场景：@ 了图片和视频，标签按类型分别编号。
const imageVideo = ll2BuildMediaContent([item("image", 1), item("video", 1), item("video", 2)]);
const imageVideoPrompt = ll2ApplyMentionTags("@[人像] 照着 @[片段一] 和 @[片段二] 动", imageVideo, 0);
check("图 + 视频标签按类型独立编号", imageVideoPrompt, "<Picture 1> 照着 <Video 1> 和 <Video 2> 动");

console.log("\n④ 提交前校验：不让注定失败的请求白扣钱");

check("没有素材直接通过", ll2ValidateMedia([]).ok, true);
check("图片超过 9 张被挡", ll2ValidateMedia(Array.from({ length: 10 }, (_, i) => item("image", i))).ok, false);
check("合计超过 12 个被挡", ll2ValidateMedia(Array.from({ length: 13 }, (_, i) => item("image", i))).ok, false);
const PUBLIC_CLIP = "https://cdn.example.com/clip.mp4";
check("视频短于 2 秒被挡", ll2ValidateMedia([item("video", 1, { durationSeconds: 1.5, dataUrl: PUBLIC_CLIP })]).ok, false);
check("编码后超 30MB 被挡", ll2ValidateMedia([item("image", 1, { encodedBytes: 31_000_000 })]).ok, false);
check("合计超 24MB 被挡（低配机保护）", ll2ValidateMedia([item("image", 1, { encodedBytes: 13_000_000 }), item("video", 1, { encodedBytes: 13_000_000, dataUrl: PUBLIC_CLIP })]).ok, false);
check("读不出时长不误拦", ll2ValidateMedia([item("video", 1, { durationSeconds: 0, dataUrl: PUBLIC_CLIP })]).ok, true);
// 2026-11-19 真网关实测：content[n].video_url.url 只认公网 HTTPS，本机文件转 Base64 会被 400 打回。
check("本机视频 data URI 被挡（网关只收公网 HTTPS）", ll2ValidateMedia([item("video", 1)]).ok, false);
check("公网 HTTPS 视频通过", ll2ValidateMedia([item("video", 1, { dataUrl: PUBLIC_CLIP })]).ok, true);
check("本机图片 data URI 照常通过", ll2ValidateMedia([item("image", 1)]).ok, true);

console.log("\n⑤ 文件类型：资产库收图片和视频，拖图区只收图片");

check("PNG 识别为图片", ll2MediaKindOf({ name: "a.png", type: "image/png" }), "image");
check("MOV 识别为视频", ll2MediaKindOf({ name: "a.mov", type: "video/quicktime" }), "video");
check("首页不开放音频入口", ll2HomeMediaKindOf({ name: "a.mp3", type: "audio/mpeg" }), null);
check("未知类型不收", ll2MediaKindOf({ name: "a.exe", type: "application/octet-stream" }), null);

console.log("\n⑥ 非 H3 模型没有素材契约时明确拦住，不发请求");

let wan3Error = "";
try {
    await ll2GenerateVideo({ apiKey: "mock-key", model: "wan3.0-video", prompt: "一只猫", seconds: 5, resolution: "480P", media: oneImage.items });
} catch (error) {
    wan3Error = error instanceof Error ? error.message : String(error);
}
check("带素材 + wan3 返回中文提示", wan3Error.includes("带图片或视频参考时请选 MiniMax-H3"), true);
check("没有真的发起网络请求", wan3Error.includes("连不上"), false);

console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}：${passed} pass / ${failed} fail`);
if (failed) process.exit(1);
