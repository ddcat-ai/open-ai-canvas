/**
 * H3 / wan3 的协议适配表。
 *
 * 2026-11-17 21:24：21 个模型已全量接入渠道，但**只有这两个做协议适配**。
 * 其余模型走影策通用 openai-video / chat 协议，本文件不为它们写任何分支。
 * 把端点、payload 字段、查询字段、usage 字段、参数合法范围集中在这里，
 * 是为了让「适配」有明确边界：新增适配 = 新增一条描述符，不再改客户端主流程。
 *
 * 协议取证（2026-11-17，无 Key 均返回 401 而非 404，端点存在）：
 *   POST /v2/video_generation                  GET /v2/query/video_generation/{task_id}
 *   POST /v1/video/generations                  GET /v1/video/generations/{id}
 *   OPTIONS /v1/video/generations -> 204，Access-Control-Allow-Origin: *
 */

import { LL2_VIDEO_DURATION, ll2TierFor, type LL2ConnectedVideoModel } from "@/lib/ll2-models";
import type { LL2MediaContent } from "@/services/ll2/ll2-media";

export type LL2VideoProtocol = "h3-v2" | "openai-video-v1";

type Json = Record<string, any>;

export type LL2AdapterArgs = {
    model: LL2ConnectedVideoModel;
    prompt: string;
    seconds: number;
    resolution: string;
    ratio: string;
    /** H3 content[] 里的参考素材项；由 ll2-media.ts 按官方契约构造，本层不改写。 */
    media?: LL2MediaContent[];
    /** 仅 H3：让网关先把提示词按 MiniMax 官方格式整理一遍（prompt_optimizer）。 */
    promptOptimizer?: boolean;
};

export type LL2QueriedTask = {
    status: string;
    url: string;
    chargedSeconds: number;
    errorCode: string;
    errorMessage: string;
};

export type LL2VideoAdapter = {
    model: LL2ConnectedVideoModel;
    protocol: LL2VideoProtocol;
    label: string;
    createPath: string;
    /** 个别协议要额外请求头（如 DashScope 的 X-DashScope-Async）。 */
    headers?: Record<string, string>;
    /** 把 UI 参数收敛到该模型真实支持的范围，避免把非法档位发给网关。 */
    normalize: (args: LL2AdapterArgs) => LL2AdapterArgs;
    buildCreatePayload: (args: LL2AdapterArgs) => Json;
    taskIdOf: (payload: Json) => string;
    queryPath: (taskId: string) => string;
    parseQuery: (payload: Json) => LL2QueriedTask;
};

export function ll2TextOf(payload: unknown, ...keys: string[]): string {
    if (!payload || typeof payload !== "object") return "";
    for (const key of keys) {
        const value = (payload as Json)[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function clamp(value: number, min: number, max: number, fallback: number) {
    const rounded = Math.round(Number(value) || fallback);
    return Math.min(max, Math.max(min, rounded));
}

function normalizeBase(args: LL2AdapterArgs): LL2AdapterArgs {
    const range = LL2_VIDEO_DURATION[args.model];
    return {
        ...args,
        prompt: String(args.prompt || "").trim(),
        seconds: clamp(args.seconds, range.min, range.max, range.default),
        ratio: String(args.ratio || "16:9").trim() || "16:9",
    };
}

const h3Adapter: LL2VideoAdapter = {
    model: "MiniMax-H3",
    protocol: "h3-v2",
    label: "H3",
    createPath: "/v2/video_generation",
    normalize: (args) => {
        // H3 固定 768P / 4–15 秒，不提供 2K 或质量档位；2K/4K 属 auto-hd 后处理。
        const base = normalizeBase(args);
        return { ...base, resolution: "768P" };
    },
    buildCreatePayload: (args) => ({
        model: "MiniMax-H3",
        // 2026-11-18 网关已支持 Base64 / data URI，参考素材可以直接进 content[]。
        // 生成方式由网关按 content[] 自动识别：纯文本=文生、+首帧=关键帧、+reference_*=参考素材。
        // 媒体项形状见 ll2-media.ts；这里只负责拼接，不编造 role 或额外字段。
        content: [{ type: "text", text: args.prompt }, ...(args.media || [])],
        resolution: "768P",
        duration: args.seconds,
        ratio: args.ratio,
        // 网关缺省 false；只在用户勾选时显式传 true。
        ...(args.promptOptimizer ? { prompt_optimizer: true } : {}),
    }),
    taskIdOf: (payload) =>
        ll2TextOf(payload, "task_id", "id", "request_id") ||
        ll2TextOf(payload.task, "id", "task_id") ||
        ll2TextOf(payload.data, "task_id", "id"),
    queryPath: (taskId) => `/v2/query/video_generation/${encodeURIComponent(taskId)}`,
    parseQuery: (payload) => {
        const task = (payload.task || payload.data?.task || payload) as Json;
        const usage = (task.usage || {}) as Json;
        return {
            status: String(task.status || "").toLowerCase(),
            url: ll2TextOf(task.content, "url") || ll2TextOf(task, "video_url", "result_url", "url"),
            chargedSeconds: Number(usage.total_seconds ?? usage.output_seconds ?? task.duration ?? 0) || 0,
            errorCode: ll2TextOf(task.error, "code") || ll2TextOf(task, "error_code"),
            errorMessage: ll2TextOf(task.error, "message") || ll2TextOf(task, "fail_reason", "error_message"),
        };
    },
};

/**
 * wan3 / wan3-prime：网关透传阿里百炼 DashScope 异步协议。
 *   POST /ali/api/v1/services/aigc/video-generation/video-synthesis
 *   GET  /ali/api/v1/tasks/{task_id}
 * 有参考图时进 input.img_url（首帧），没有走纯文字。
 */
function makeWan3Adapter(model: "wan3.0-video" | "wan3.0-video-prime"): LL2VideoAdapter {
    return {
        model,
        protocol: "openai-video-v1",
        label: OPENAI_VIDEO_LABELS[model],
        createPath: "/ali/api/v1/services/aigc/video-generation/video-synthesis",
        headers: { "X-DashScope-Async": "enable" },
        normalize: (args) => {
            const base = normalizeBase(args);
            const tier = ll2TierFor(model, base.resolution);
            return { ...base, resolution: tier?.resolution || base.resolution };
        },
        buildCreatePayload: (args) => {
            const image = args.media?.find((item) => item.image_url?.url)?.image_url?.url || "";
            return {
                model,
                input: {
                    prompt: args.prompt,
                    ...(image ? { img_url: image } : {}),
                },
                parameters: {
                    resolution: String(args.resolution).toUpperCase(),
                    ratio: args.ratio,
                    duration: args.seconds,
                },
            };
        },
        taskIdOf: (payload) => {
            const output = (payload.output || {}) as Json;
            return ll2TextOf(output, "task_id") || ll2TextOf(payload, "task_id", "id");
        },
        queryPath: (taskId) => `/ali/api/v1/tasks/${encodeURIComponent(taskId)}`,
        parseQuery: (payload) => {
            const output = (payload.output || {}) as Json;
            const rawStatus = String(output.task_status || output.status || "").toLowerCase();
            const status = rawStatus === "succeeded" ? "succeeded" : rawStatus === "failed" || rawStatus === "canceled" ? "failed" : rawStatus;
            const usage = (payload.usage || {}) as Json;
            return {
                status,
                url: ll2TextOf(output, "video_url", "url"),
                chargedSeconds: Number(usage.duration ?? usage.output_seconds ?? 0) || 0,
                errorCode: ll2TextOf(output, "code", "error_code"),
                errorMessage: ll2TextOf(output, "message", "error_message"),
            };
        },
    };
}

/** 走 /v1/video/generations 的模型及其中文名（H3 单独走 /v2，不在这里）。 */
const OPENAI_VIDEO_LABELS = {
    "wan3.0-video": "万相 3.0",
    "wan3.0-video-prime": "万相 3.0 Pro",
    "doubao-seedance-2-0": "Seedance 2.0",
    "doubao-seedance-2-0-fast": "Seedance 2.0 Fast",
    "doubao-seedance-2-0-mini": "Seedance 2.0 Mini",
    "doubao-seedance-2-5": "Seedance 2.5",
    "viduq3-pro": "Vidu Q3 Pro",
    "viduq3-turbo": "Vidu Q3 Turbo",
    "Super Vega 1.0-lite": "Super Vega 1.0 Lite",
    "Super Vega 1.0-pro": "Super Vega 1.0 Pro",
    "Super Vega 1.0-pro-fast": "Super Vega 1.0 Pro Fast",
    "Super Vega 1.0-pro-mini": "Super Vega 1.0 Pro Mini",
    "Super Vega 1.5-pro": "Super Vega 1.5 Pro",
} as const;

type OpenAIVideoModel = keyof typeof OPENAI_VIDEO_LABELS;

/**
 * 通用视频适配器。
 * 字段与上游 services/api/video-provider-newapi.ts 完全一致：
 *   POST /v1/video/generations  { model, prompt, seconds, aspect_ratio, resolution }
 *   GET  /v1/video/generations/{id}   → data.status / result_url / usage
 * 2026-11-19 用户要求「所有模型都能适配」后，13 个非 H3 模型都走这一条。
 */
function makeOpenAIVideoAdapter(model: OpenAIVideoModel): LL2VideoAdapter {
    return {
        model,
        protocol: "openai-video-v1",
        label: OPENAI_VIDEO_LABELS[model],
        createPath: "/v1/video/generations",
        normalize: (args) => {
            const base = normalizeBase(args);
            // 清晰度必须落在该模型官网档位内，否则回落到第一档；单价按档位换算才准。
            const tier = ll2TierFor(model, base.resolution);
            return { ...base, resolution: tier?.resolution || base.resolution };
        },
        buildCreatePayload: (args) => {
            const items = args.media || [];
            // 统一网关的素材字段与影策上游 video-provider-newapi.ts 一致：
            // 图片 image_urls（data URI 可用）、视频 video_urls、音频 audio_urls，顺序即参考顺序。
            const images = items.filter((item) => item.image_url?.url).map((item) => item.image_url!.url);
            const videos = items.filter((item) => item.video_url?.url).map((item) => item.video_url!.url);
            const audios = items.filter((item) => item.audio_url?.url).map((item) => item.audio_url!.url);
            return {
                model,
                prompt: args.prompt,
                // 2026-11-19 实测：网关 JSON 解析要求 seconds 是字符串，
                // 传数字会 400（cannot unmarshal number into ... seconds of type string）。
                seconds: String(args.seconds),
                aspect_ratio: args.ratio,
                resolution: args.resolution,
                ...(images.length ? { image_urls: images } : {}),
                ...(videos.length ? { video_urls: videos } : {}),
                ...(audios.length ? { audio_urls: audios } : {}),
            };
        },
        taskIdOf: (payload) => {
            const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Json;
            return ll2TextOf(data, "id", "task_id", "request_id") || ll2TextOf(payload, "id", "task_id", "request_id");
        },
        queryPath: (taskId) => `/v1/video/generations/${encodeURIComponent(taskId)}`,
        parseQuery: (payload) => {
            const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Json;
            const usage = (data.usage || {}) as Json;
            return {
                status: String(data.status || "").toLowerCase(),
                url: ll2TextOf(data, "result_url", "video_url", "url") ||
                    ll2TextOf(data.output, "video_url", "url") ||
                    ll2TextOf(data.result, "url"),
                chargedSeconds: Number(usage.output_seconds ?? usage.total_seconds ?? data.seconds ?? 0) || 0,
                errorCode: ll2TextOf(data, "error_code", "code"),
                errorMessage: ll2TextOf(data, "fail_reason", "message", "error") || ll2TextOf(data.error, "message"),
            };
        },
    };
}

/** H3 走 /v2，其余 13 个走 /v1；合计覆盖 LL2_CONNECTED_VIDEO_MODELS 全部 14 个。 */
export const LL2_VIDEO_ADAPTERS = {
    "MiniMax-H3": h3Adapter,
    "wan3.0-video": makeWan3Adapter("wan3.0-video"),
    "wan3.0-video-prime": makeWan3Adapter("wan3.0-video-prime"),
    ...Object.fromEntries(
        (Object.keys(OPENAI_VIDEO_LABELS) as OpenAIVideoModel[]).filter((model) => !model.startsWith("wan3.0-")).map((model) => [model, makeOpenAIVideoAdapter(model)]),
    ),
} as Record<LL2ConnectedVideoModel, LL2VideoAdapter>;

export function ll2VideoAdapter(model: LL2ConnectedVideoModel): LL2VideoAdapter {
    const adapter = LL2_VIDEO_ADAPTERS[model];
    if (!adapter) throw new Error(`${model} 还没有协议适配，请换一个模型`);
    return adapter;
}
