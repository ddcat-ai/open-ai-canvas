/**
 * 首页素材 → MiniMax-H3 content[] 媒体项。
 *
 * 契约来源：《客户API说明(1)(1).md》
 *   L21-30   content[] 自动识别生成方式：文本=文生；文本+首帧=关键帧；文本+参考素材=参考素材生成
 *   L112-137 媒体类型 / role / 体积 / 数量 / 时长限制
 *   L141-145 首帧和尾帧支持「仅首帧 / 仅尾帧 / 首尾帧」；不得与 reference_* 混用
 *   L195-268 多参考用 <Picture N> / <Video N> / <Audio N> 在提示词里引用
 *
 * 2026-11-18 用户拍板：网关已支持 Base64 / data URI（图片），覆盖旧文档 L114 / L482
 * 「不支持 Base64、data URI」的 DMC.CC 时期口径；图片读成 data:... 后可直接放进 image_url.url。
 * 2026-11-19 真网关实测：视频 / 音频**不支持** data URI，必须是公网 HTTPS URL，
 * 否则创建直接 400（content[n].video_url.url must be a public HTTPS URL）。
 *
 * 两条素材来源（用户 17:26 口径）：
 *   拖进输入框：只收 1 张图片，给小白「让这张图动起来」
 *   @ 引用资产库：多张图片做首尾帧 / 多参考；视频 / 音频必须是公网 HTTPS URL，本机文件传不上去
 * 合并后仍只有一条生成链路，由网关按 content[] 判断。
 */

export type LL2MediaKind = "image" | "video" | "audio";
export type LL2MediaMode = "text" | "image" | "frames" | "images" | "video" | "videos" | "mixed";

export type LL2MediaInput = {
    id: string;
    kind: LL2MediaKind;
    name: string;
    mimeType: string;
    /** 原始文件字节数。 */
    bytes: number;
    /** 编码后的 data URI 字节数（Base64 会膨胀约 1/3，按这个数卡上限更稳）。 */
    encodedBytes: number;
    /**
     * 内联资源。
     * 图片：`data:image/...;base64,...`，网关 2026-11-18 起可直接接收，已实测出片。
     * 视频 / 音频：**必须是公网 HTTPS URL**，本机文件转 Base64 会被网关 400 拒绝
     * （2026-11-19 实测：`content[n].video_url.url must be a public HTTPS URL`）。
     */
    dataUrl: string;
    /** 参考视频 / 音频时长，读不出来时为 0（交给网关判定，不冒充已校验）。 */
    durationSeconds: number;
};

/** content[] 里的一个媒体项，形状由 H3 协议决定，不在前端编造额外字段。 */
export type LL2MediaContent = {
    type: "image_url" | "video_url" | "audio_url";
    image_url?: { url: string };
    video_url?: { url: string };
    audio_url?: { url: string };
    role: string;
};

const LIMITS: Record<LL2MediaKind, { type: string; role: string; label: string; bytes: number; max: number; tag: string }> = {
    image: { type: "image_url", role: "reference_image", label: "图片", bytes: 30_000_000, max: 9, tag: "Picture" },
    video: { type: "video_url", role: "reference_video", label: "视频", bytes: 50_000_000, max: 3, tag: "Video" },
    audio: { type: "audio_url", role: "reference_audio", label: "音频", bytes: 15_000_000, max: 3, tag: "Audio" },
};

/** 全部参考文件合计最多 12 个（文档 L129）。 */
const TOTAL_MAX = 12;
/**
 * 一次提交的编码后素材总量上限。网关单文件上限 30/50MB，但 Base64 会膨胀约 1/3，
 * 全塞进一个 JSON 请求对低配机太重。这是客户端保守保护，不是网关限制。
 */
export const HOME_MEDIA_TOTAL_ENCODED_BYTES = 24_000_000;

/** 首页拖进去的图片上限（用户 17:26 明确：拖图只给小白用，只能一张）。 */
export const HOME_DROP_IMAGE_MAX = 1;

const IMAGE_MIME = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i;
const VIDEO_MIME = /^video\/(mp4|quicktime)$/i;
const AUDIO_MIME = /^audio\/(wav|mpeg|mp3|mp4|aac|x-wav)$/i;

/** @ 引用的可读标记，例如「@[海边照片]」；上传时保证标题唯一，所以按名字就能反查资产。 */
const MENTION_SOURCE = "@\\[([^\\]\\n]+)\\]";

export function ll2MediaKindOf(file: Pick<File, "name" | "type">): LL2MediaKind | null {
    const mime = String(file.type || "").toLowerCase();
    if (IMAGE_MIME.test(mime) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "")) return "image";
    if (VIDEO_MIME.test(mime) || /\.(mp4|mov)$/i.test(file.name || "")) return "video";
    if (AUDIO_MIME.test(mime) || /\.(wav|mp3|m4a|aac)$/i.test(file.name || "")) return "audio";
    return null;
}

/** 资产库只收图片和视频；音频类型预留给画布，不在 C 端开放入口。 */
export function ll2HomeMediaKindOf(file: Pick<File, "name" | "type">): LL2MediaKind | null {
    const kind = ll2MediaKindOf(file);
    return kind === "audio" ? null : kind;
}

/** 按顺序取出提示词里所有 @[名称]（不去重：同一个素材引用两次仍算两次）。 */
export function ll2ParseMentionTitles(prompt: string): string[] {
    return Array.from(String(prompt || "").matchAll(new RegExp(MENTION_SOURCE, "g")), (match) => match[1].trim()).filter(Boolean);
}

/** 生成插入用的引用标记。 */
export function ll2MentionToken(title: string): string {
    return `@[${title.replace(/[\[\]\n]/g, "").trim()}]`;
}

export type LL2MediaCheck = { ok: boolean; message: string };

/** 提交前把不合规素材挡住，避免发出注定失败的请求、白扣一次费用。 */
export function ll2ValidateMedia(list: readonly LL2MediaInput[]): LL2MediaCheck {
    if (!list.length) return { ok: true, message: "" };
    if (list.length > TOTAL_MAX) return { ok: false, message: `一次最多用 ${TOTAL_MAX} 个素材，先少引用几个再生成` };
    const totalEncoded = list.reduce((sum, item) => sum + item.encodedBytes, 0);
    if (totalEncoded > HOME_MEDIA_TOTAL_ENCODED_BYTES) {
        return { ok: false, message: `素材加起来约 ${Math.ceil(totalEncoded / 1_000_000)}MB，太大了；请换小一点的文件，或一次少引用几个` };
    }
    for (const kind of ["image", "video", "audio"] as LL2MediaKind[]) {
        const items = list.filter((item) => item.kind === kind);
        const limit = LIMITS[kind];
        if (items.length > limit.max) return { ok: false, message: `${limit.label}最多 ${limit.max} 个，现在有 ${items.length} 个` };
        for (const item of items) {
            // 2026-11-19 真网关实测：图片的 data URI 直接收；视频 / 音频只认「网关自己能下载的公网 HTTPS 地址」，
            // 本机文件转 Base64 会被 400 打回（content[n].video_url.url must be a public HTTPS URL）。
            // 在这里提前挡住，用户不用等一次注定失败的请求。
            if (kind !== "image" && item.dataUrl.startsWith("data:")) {
                return {
                    ok: false,
                    message: `「${item.name}」是参考${limit.label}：网关只接受公网 HTTPS 地址，本机文件传不上去。想用本机素材的话，换成图片做首帧 / 首尾帧可以直接出片；${limit.label}参考需要先把文件放到能公开访问的地方，再用链接引用。`,
                };
            }
            if (item.encodedBytes > limit.bytes) {
                return { ok: false, message: `「${item.name}」太大了（编码后约 ${Math.ceil(item.encodedBytes / 1_000_000)}MB），${limit.label}上限 ${Math.round(limit.bytes / 1_000_000)}MB` };
            }
            // 文档 L130：短于 2 秒的参考视频 / 音频会被网关判 failed。读不出时长时不拦，交给网关。
            if (kind !== "image" && item.durationSeconds > 0 && item.durationSeconds < 2) {
                return { ok: false, message: `「${item.name}」只有 ${item.durationSeconds.toFixed(1)} 秒，参考${limit.label}至少要 2 秒` };
            }
        }
    }
    return { ok: true, message: "" };
}

export type LL2MediaBuild = {
    /** 追加到 content[] 文本项之后的媒体项。 */
    items: LL2MediaContent[];
    /** 与 items 一一对应的网关标签；首帧 / 尾帧为 null，reference_* 为 "<Picture 1>" 等。 */
    tags: (string | null)[];
    mode: LL2MediaMode;
};

/**
 * 构造规则（严格避开 L143「first_frame/last_frame 不得与 reference_* 混用」）：
 *   没有素材                  → 只有文本
 *   只有 1 张图片             → first_frame                      （小白拖一张）
 *   只有 2 张图片             → first_frame + last_frame         （用户要的首尾帧）
 *   其余（≥3 图 / 含视频 / 含音频）→ 全部 reference_* + 标签       （多参考）
 */
export function ll2BuildMediaContent(list: readonly LL2MediaInput[]): LL2MediaBuild {
    if (!list.length) return { items: [], tags: [], mode: "text" };

    const kinds = new Set(list.map((item) => item.kind));
    const onlyImages = kinds.size === 1 && kinds.has("image");
    const onlyVideos = kinds.size === 1 && kinds.has("video");
    const mode: LL2MediaMode = onlyImages
        ? list.length === 1 ? "image" : list.length === 2 ? "frames" : "images"
        : onlyVideos
            ? list.length === 1 ? "video" : "videos"
            : "mixed";

    if (onlyImages && list.length <= 2) {
        return {
            items: list.map((item, index) => ({
                type: "image_url",
                image_url: { url: item.dataUrl },
                role: index === 0 ? "first_frame" : "last_frame",
            })),
            tags: list.map(() => null),
            mode,
        };
    }

    const counters: Record<LL2MediaKind, number> = { image: 0, video: 0, audio: 0 };
    const items: LL2MediaContent[] = [];
    const tags: string[] = [];
    for (const item of list) {
        const limit = LIMITS[item.kind];
        counters[item.kind] += 1;
        tags.push(`<${limit.tag} ${counters[item.kind]}>`);
        const urlKey = `${item.kind}_url` as "image_url" | "video_url" | "audio_url";
        items.push({ type: limit.type as LL2MediaContent["type"], [urlKey]: { url: item.dataUrl }, role: limit.role } as LL2MediaContent);
    }
    return { items, tags, mode };
}

/**
 * 把提示词里的 @[名称] 就地换成网关标签 <Picture N> / <Video N>。
 * dropCount = 拖进去的素材数（排在最前，没有对应的 @ 标记），它们的标签前置。
 * 首帧 / 尾帧模式下没有标签，@ 标记会被去掉，避免把 @[xxx] 原文发给网关。
 */
export function ll2ApplyMentionTags(prompt: string, build: LL2MediaBuild, dropCount: number): string {
    const source = String(prompt || "").trim();
    let index = dropCount;
    const replaced = source.replace(new RegExp(MENTION_SOURCE, "g"), () => {
        const tag = build.tags[index] ?? null;
        index += 1;
        return tag || "";
    });
    const leading = build.tags.slice(0, dropCount).filter((tag): tag is string => Boolean(tag)).join(" ");
    return `${leading} ${replaced.replace(/[ \t]+/g, " ").trim()}`.trim();
}

/** 白话模式名：界面不出现「文生视频 / 图生视频 / 视频生视频 / 首尾帧」这些专业词。 */
export function ll2MediaModeLabel(mode: LL2MediaMode): string {
    switch (mode) {
        case "image": return "照这张图的样子，出一支片子";
        case "frames": return "从第一张图，慢慢变到最后一张";
        case "images": return "照这几张图的样子，出一支片子";
        case "video": return "照这段片的动作，出一支片子";
        case "videos": return "照这几段片的动作，出一支片子";
        case "mixed": return "图和片一起参考，出一支片子";
        default: return "写一句话，出一支片子";
    }
}

/** 素材条上的一行摘要，例如「2 张图 · 1 段视频」。 */
export function ll2MediaSummary(list: readonly LL2MediaInput[]): string {
    const parts: string[] = [];
    for (const kind of ["image", "video", "audio"] as LL2MediaKind[]) {
        const count = list.filter((item) => item.kind === kind).length;
        if (count) parts.push(`${count} ${kind === "image" ? "张图" : kind === "video" ? "段视频" : "段音频"}`);
    }
    return parts.join(" · ");
}

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(`读不了「${file.name}」，换一个文件试试`));
        reader.readAsDataURL(file);
    });
}

/** 尽力读取参考视频 / 音频时长；浏览器读不出编码时返回 0，不冒充已校验。 */
function readMediaDuration(file: File, kind: LL2MediaKind): Promise<number> {
    if (kind === "image" || typeof document === "undefined") return Promise.resolve(0);
    const url = URL.createObjectURL(file);
    const element = document.createElement(kind === "video" ? "video" : "audio") as HTMLVideoElement | HTMLAudioElement;
    return new Promise((resolve) => {
        const finish = (value: number) => {
            URL.revokeObjectURL(url);
            resolve(Number.isFinite(value) && value > 0 ? value : 0);
        };
        const timer = window.setTimeout(() => finish(0), 5000);
        element.preload = "metadata";
        element.onloadedmetadata = () => {
            window.clearTimeout(timer);
            finish(element.duration);
        };
        element.onerror = () => {
            window.clearTimeout(timer);
            finish(0);
        };
        element.src = url;
    });
}

/** 本地文件 → 可提交的素材。data URI 直接作为网关可接收的媒体地址。 */
export async function ll2ReadMediaFile(file: File): Promise<LL2MediaInput> {
    const kind = ll2HomeMediaKindOf(file);
    if (!kind) throw new Error(`「${file.name}」不是图片或视频；可以用 JPG / PNG / WebP / HEIC 图片，或 MP4 / MOV 视频`);
    const [dataUrl, durationSeconds] = await Promise.all([readAsDataUrl(file), readMediaDuration(file, kind)]);
    if (!dataUrl.startsWith("data:")) throw new Error(`「${file.name}」读取失败，换一个文件试试`);
    return {
        id: `media-${crypto.randomUUID()}`,
        kind,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        encodedBytes: dataUrl.length,
        dataUrl,
        durationSeconds,
    };
}

/** 首页拖放区只收一张图片；拖视频请走资产库 @ 引用。 */
export async function ll2ReadDroppedImage(file: File): Promise<LL2MediaInput> {
    const kind = ll2MediaKindOf(file);
    if (kind !== "image") throw new Error("这里只能拖一张图片；想用多张图，点「素材库 @」引用");
    return ll2ReadMediaFile(file);
}
