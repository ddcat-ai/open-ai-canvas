/**
 * LL2 视频直连生成客户端 —— 协议细节集中在 ll2-video-adapters.ts。
 *
 * 2026-11-17 21:24 分工：
 *   渠道已接入官网全部 21 个模型；
 *   但**只有 MiniMax-H3 与 wan3.0-video 完成协议适配**，能走这条
 *   「创建 → 轮询 → 按 usage 精确计费 → 出片」链路。
 *   其余 19 个模型只是接上渠道，走影策通用协议，客户端不替它们编造端点与计费。
 *
 * Key 只从调用方传入（浏览器 localStorage），不写业务库、不经影策后端中转。
 * 端点取证见 ll2-video-adapters.ts 头部注释。
 */

import {
    ll2ActualCNY,
    ll2PreciseCNY,
    type LL2ConnectedVideoModel,
} from "@/lib/ll2-models";
import {
    ll2TextOf,
    ll2VideoAdapter,
    type LL2QueriedTask,
    type LL2VideoProtocol,
} from "@/services/ll2/ll2-video-adapters";
import type { LL2MediaContent } from "@/services/ll2/ll2-media";

export type { LL2VideoProtocol } from "@/services/ll2/ll2-video-adapters";

export const LL2_GATEWAY_ORIGIN = "https://api.ll2.cn";

export type LL2VideoRequest = {
    apiKey: string;
    model: LL2ConnectedVideoModel;
    prompt: string;
    seconds: number;
    resolution: string;
    ratio?: string;
    /** 仅 H3：提示词优化（prompt_optimizer）。 */
    promptOptimizer?: boolean;
    signal?: AbortSignal;
    /** 参考素材媒体项（图片 / 视频）。只有 MiniMax-H3 的 content[] 契约已核准。 */
    media?: LL2MediaContent[];
    /** 仅用于本地自测 / 将来切换环境，默认 LL2 官方网关。 */
    baseUrl?: string;
    idempotencyKey?: string;
    pollIntervalMs?: number;
    maxPolls?: number;
};

export type LL2VideoProgress = {
    stage: "created" | "polling";
    status: string;
    elapsedMs: number;
    pollCount: number;
    taskId: string;
};

export type LL2VideoResult = {
    taskId: string;
    protocol: LL2VideoProtocol;
    url: string;
    /** 成片地址要带 Bearer 才能下载（seedance / vega 的 artifact 相对路径）。 */
    requiresAuth?: boolean;
    /** 需要鉴权时，客户端已经带 Key 取回的 blob URL，可直接给 <video>。 */
    previewUrl?: string;
    model: LL2ConnectedVideoModel;
    prompt: string;
    seconds: number;
    chargedSeconds: number;
    resolution: string;
    ratio: string;
    estimateCNY: number;
    actualCNY: number;
    actualLabel: string;
    actualBasis: string;
    createdAt: number;
};

type Json = Record<string, any>;

function originOf(req: LL2VideoRequest) {
    return String(req.baseUrl || LL2_GATEWAY_ORIGIN).replace(/\/+$/, "");
}

function httpErrorMessage(status: number, payload: unknown, label: string) {
    const detail = ll2TextOf(payload, "message", "msg") || ll2TextOf((payload as Json)?.error, "message", "msg") || "";
    if (status === 401) return "LL2 Key 无效或已过期，请在「连接 LL2」里重新填入";
    if (status === 403) return "这个 Key 没有调用该模型的权限，请到 LL2 控制台确认";
    if (status === 429) return "LL2 账户触发限流，请稍后再试";
    // new-api 网关刚创建完任务时，查询可能短暂返回 task_not_exist，属于同步延迟而非失败。
    if (/task_not_exist/i.test(detail)) return "任务还在同步中";
    // 2026-11-19 实测：503 也可能是「这个 Key 的分组没挂该模型渠道」，
    // 不是 LL2 挂了。必须说清楚，否则用户会一直以为平台故障。
    if (/model_not_found|无可用渠道|no available channel/i.test(detail)) {
        return "这个模型在你的 LL2 Key 所在分组里没有可用渠道：到 LL2 控制台给该分组开通这个模型，或者换一个已开通的模型";
    }
    if (status === 400) return detail ? `请求参数不被接受：${detail}` : "请求参数不被接受，请检查时长、清晰度与比例";
    if (status >= 500) return `LL2 服务暂时不可用（HTTP ${status}），请稍后重试`;
    return `${label}失败（HTTP ${status}）${detail ? `：${detail}` : ""}`;
}

async function ll2Fetch(url: string, init: RequestInit, req: LL2VideoRequest, label: string): Promise<Json> {
    let response: Response;
    try {
        response = await fetch(url, { ...init, signal: req.signal });
    } catch (error) {
        if (req.signal?.aborted) throw error;
        throw new Error("连不上 LL2，请检查网络或稍后重试");
    }
    const raw = await response.text().catch(() => "");
    let payload: Json = {};
    try {
        payload = raw ? (JSON.parse(raw) as Json) : {};
    } catch {
        payload = {};
    }
    if (!response.ok) throw new Error(httpErrorMessage(response.status, payload, label));
    return payload;
}

function authHeaders(req: LL2VideoRequest, extra: Record<string, string> = {}) {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${String(req.apiKey || "").trim()}`,
        ...extra,
    };
}

function newIdempotencyKey() {
    try {
        return `ll2-${crypto.randomUUID()}`;
    } catch {
        return `ll2-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

// ── 通用状态与错误 ────────────────────────────────────────────────────────

function statusKind(status: string): "pending" | "succeeded" | "failed" {
    const value = status.trim().toLowerCase();
    if (["succeeded", "success", "completed", "complete", "done"].includes(value)) return "succeeded";
    if (["failed", "failure", "fail", "cancelled", "canceled", "error"].includes(value)) return "failed";
    return "pending";
}

const TASK_ERROR_LABELS: Record<string, string> = {
    input_download_failed: "参考素材下载失败",
    input_security_violation: "参考素材地址不符合安全策略",
    input_too_large: "参考素材超过大小限制",
    input_probe_failed: "参考素材无法识别",
    input_format_unsupported: "参考素材格式不支持",
    input_duration_out_of_range: "参考视频或音频时长超出范围",
    input_dimensions_out_of_range: "画面尺寸超出范围",
    input_aspect_ratio_mismatch: "首尾帧比例不一致",
    input_transcode_failed: "素材标准化失败",
    content_policy_violation: "内容审核未通过（已扣费用会全额退回）",
    content_review_required: "内容需要人工复核，任务已终止（已扣费用会全额退回）",
    content_moderation_failed: "审核服务未返回结果（已扣费用会全额退回）",
    fail_to_fetch_task: "服务繁忙，任务未能开始（已预扣会全额退回）",
    task_not_exist: "任务还在同步中",
};

function taskErrorMessage(code: string, message: string) {
    if (code === "task_not_exist") return "任务还在同步中，请稍后重试";
    const label = TASK_ERROR_LABELS[code];
    if (label) return message ? `${label}：${message}` : label;
    return message || (code ? `生成失败（${code}）` : "生成失败，未返回具体原因");
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        if (!signal) return;
        if (signal.aborted) {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}

/**
 * 完整生成：创建 → 轮询 → 出片。返回公开 mp4 直链与按 usage 换算的实付。
 * 结果直链上游只保证 ≥24h，调用方应提示用户尽快下载保存。
 */
export async function ll2GenerateVideo(req: LL2VideoRequest, onProgress?: (progress: LL2VideoProgress) => void): Promise<LL2VideoResult> {
    const key = String(req.apiKey || "").trim();
    if (!key) throw new Error("还没填 LL2 Key，填一次就能用，不用注册账号");
    const prompt = String(req.prompt || "").trim();
    if (!prompt) throw new Error("先写一句话，说清你想要的画面");
    const media = req.media || [];
    // 2026-11-19 真机反馈：非 H3 模型把 image_urls 发到 /v1 后，网关没有真的按首帧出片
    // （用户引用了图，成片却是按文字生成的，还扣了钱）。其它模型的素材协议还没逐个接通前，
    // 先明确挡住，避免再花冤枉钱。H3 的 content[] 是已实测的契约。
    // 2026-11-19 真机验证结果：H3 / wan3 / seedance / vidu 的首帧图能真的用上；
    // Super Vega 按文档接了 FileInfos，但真机任务返回 FAIL（还在排查图片 URL 约束），暂不放开。
    const mediaProtocolReady = req.model === "MiniMax-H3" || req.model.startsWith("wan3.0-") || req.model.startsWith("doubao-seedance-2-") || req.model.startsWith("viduq3-");
    if (media.length > 0 && !mediaProtocolReady) {
        throw new Error("这个模型带图/视频出片的协议还没验证通过：现在 H3 / wan3 / seedance / vidu 会真的按参考图出片，Super Vega 还在验证。先换一个，或把参考素材去掉再生成。");
    }
    // 万相 3.0 是全能参考模型：支持首帧/尾帧、最多 10 张参考图、5 段参考视频、5 段参考音频，
    // 但「首尾帧」和「参考素材」不能混用（官方素材组合规则）。
    if (req.model.startsWith("wan3.0-")) {
        const images = media.filter((item) => item.image_url?.url);
        const videos = media.filter((item) => item.video_url?.url);
        const audios = media.filter((item) => item.audio_url?.url);
        const frames = images.filter((item) => item.role === "first_frame" || item.role === "last_frame");
        if (images.length > 10) throw new Error("万相 3.0 最多 10 张参考图（首帧/尾帧各 1 张）");
        if (videos.length > 5) throw new Error("万相 3.0 最多 5 段参考视频，且总时长不超过 15 秒");
        if (audios.length > 5) throw new Error("万相 3.0 最多 5 段参考音频，且总时长不超过 15 秒");
        if (frames.length && (videos.length > 0 || audios.length > 0 || images.length > frames.length)) {
            throw new Error("首帧/尾帧不能和参考视频、参考音频或多张参考图混用：要么首尾帧，要么全能参考");
        }
    }
    // Vidu Q3 只支持图片参考：0 张文生、1 张首帧、2 张首尾帧；视频/音频和 3 张以上图都没开通。
    if (req.model.startsWith("viduq3-") && media.length > 0) {
        const images = media.filter((item) => item.image_url?.url);
        if (images.length !== media.length) throw new Error("Vidu 只支持图片参考；视频/音频参考还没接通，换图片或去掉再生成");
        if (images.length > 2) throw new Error("Vidu Q3 最多两张图（首帧 + 尾帧）；想用多张参考图请换 MiniMax-H3");
    }
    // 2026-11-19 真网关实测：图片的 data URI 能出片；视频 / 音频必须是自己能下载的公网 HTTPS 地址，
    // 本机文件转 Base64 会被 400 打回（content[n].video_url.url must be a public HTTPS URL）。
    // 这里做最后一道防御，避免界面漏检时又把注定失败的请求发出去。
    for (const item of media) {
        const url = item.video_url?.url || item.audio_url?.url || "";
        if (url && !/^https:\/\//i.test(url)) {
            throw new Error("参考视频 / 音频要用公网 HTTPS 地址；本机文件传不上去，换成图片做首帧或首尾帧可以直接出片");
        }
    }

    // 适配表决定端点、payload、查询解析与参数合法范围；客户端主流程不含模型特判。
    const adapter = ll2VideoAdapter(req.model);
    const args = adapter.normalize({
        model: req.model,
        prompt,
        seconds: req.seconds,
        resolution: req.resolution || (req.model === "MiniMax-H3" ? "768P" : "480P"),
        ratio: req.ratio || "16:9",
        media,
        promptOptimizer: req.promptOptimizer === true,
    });
    const { seconds, resolution, ratio } = args;
    const protocol = adapter.protocol;
    const startedAt = Date.now();
    const interval = Math.max(1000, req.pollIntervalMs ?? 5000);
    // 15/30 秒的长视频排队+生成可能超过 10 分钟；轮询上限按时长放宽，避免 LL2 还在跑、画布先报超时。
    const maxPolls = Math.max(1, req.maxPolls ?? Math.max(120, Math.ceil((seconds * 90) / interval)));
    const estimate = ll2PreciseCNY(req.model, seconds, resolution);

    const createPath = adapter.createPathFor ? adapter.createPathFor(args) : adapter.createPath;
    const created = await ll2Fetch(
        `${originOf(req)}${createPath}`,
        {
            method: "POST",
            headers: authHeaders(req, { ...(adapter.headers || {}), "Idempotency-Key": req.idempotencyKey || newIdempotencyKey() }),
            body: JSON.stringify(adapter.buildCreatePayload(args)),
        },
        req,
        `创建${adapter.label}任务`,
    );
    const taskId = adapter.taskIdOf(created);
    if (!taskId) throw new Error("LL2 已受理请求但没有返回任务号，请稍后重试");

    onProgress?.({ stage: "created", status: "queued", elapsedMs: Date.now() - startedAt, pollCount: 0, taskId });
    return waitForLL2Video({ req, adapter, taskId, startedAt, interval, maxPolls, seconds, resolution, ratio, prompt, estimate, onProgress });
}

/**
 * 刷新后恢复：不再创建任务，直接按已有 taskId 继续查询并收尾。
 * 页面刷新/热更新会打断浏览器轮询，但 LL2 服务端会继续跑；用这个方法把已出片补回节点。
 */
export async function ll2ResumeVideo(req: LL2VideoRequest, taskId: string, onProgress?: (progress: LL2VideoProgress) => void): Promise<LL2VideoResult> {
    const key = String(req.apiKey || "").trim();
    if (!key) throw new Error("先连接 LL2 Key 才能恢复生成");
    const task = String(taskId || "").trim();
    if (!task) throw new Error("缺少 LL2 任务号，无法恢复");
    const adapter = ll2VideoAdapter(req.model);
    const args = adapter.normalize({
        model: req.model,
        prompt: String(req.prompt || ""),
        seconds: req.seconds,
        resolution: req.resolution || (req.model === "MiniMax-H3" ? "768P" : "480P"),
        ratio: req.ratio || "16:9",
        media: req.media || [],
        promptOptimizer: false,
    });
    const interval = Math.max(1000, req.pollIntervalMs ?? 5000);
    const maxPolls = Math.max(1, req.maxPolls ?? Math.max(120, Math.ceil((args.seconds * 90) / interval)));
    return waitForLL2Video({
        req,
        adapter,
        taskId: task,
        startedAt: Date.now(),
        interval,
        maxPolls,
        seconds: args.seconds,
        resolution: args.resolution,
        ratio: args.ratio,
        prompt: String(req.prompt || ""),
        estimate: ll2PreciseCNY(req.model, args.seconds, args.resolution),
        onProgress,
    });
}

async function waitForLL2Video(input: {
    req: LL2VideoRequest;
    adapter: ReturnType<typeof ll2VideoAdapter>;
    taskId: string;
    startedAt: number;
    interval: number;
    maxPolls: number;
    seconds: number;
    resolution: string;
    ratio: string;
    prompt: string;
    estimate: ReturnType<typeof ll2PreciseCNY>;
    onProgress?: (progress: LL2VideoProgress) => void;
}): Promise<LL2VideoResult> {
    const { req, adapter, taskId, startedAt, interval, maxPolls, seconds, resolution, ratio, prompt, estimate, onProgress } = input;
    const key = String(req.apiKey || "").trim();
    const protocol = adapter.protocol;
    for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
        await sleep(interval, req.signal);
        let queried: LL2QueriedTask;
        try {
            const payload = await ll2Fetch(
                `${originOf(req)}${adapter.queryPath(taskId)}`,
                { method: "GET", headers: authHeaders(req) },
                req,
                `查询${adapter.label}任务`,
            );
            queried = adapter.parseQuery(payload);
        } catch (error) {
            // 网关刚创建完偶尔会短暂返回 task_not_exist；这不算失败，继续轮询。
            if (error instanceof Error && error.message.includes("任务还在同步中")) {
                onProgress?.({ stage: "polling", status: "queued", elapsedMs: Date.now() - startedAt, pollCount: attempt, taskId });
                continue;
            }
            throw error;
        }
        const { status, url, chargedSeconds, errorCode, errorMessage } = queried;
        const kind = statusKind(status);
        onProgress?.({ stage: "polling", status, elapsedMs: Date.now() - startedAt, pollCount: attempt, taskId });

        if (kind === "failed") throw new Error(taskErrorMessage(errorCode, errorMessage));
        if (kind === "succeeded") {
            if (!url || !/^https?:\/\//i.test(url)) throw new Error("任务已完成，但 LL2 没有返回可播放的视频地址");
            const billedSeconds = chargedSeconds > 0 ? chargedSeconds : seconds;
            const actual = ll2ActualCNY(req.model, billedSeconds, resolution);
            // seedance / vega 返回的是 /v1/tasks/.../artifacts 相对地址，必须带同一个 Key 取回 blob，
            // 否则 <video> 直连会 401；这里先取回，返回临时 objectURL 给界面播放。
            // 自定义 baseUrl（自测/代理）时，artifact 地址也要跟着换 origin。
            const artifactUrl = queried.requiresAuth ? url.replace(/^https?:\/\/[^/]+/, originOf(req)) : url;
            let previewUrl = "";
            if (queried.requiresAuth) {
                const mediaResponse = await fetch(artifactUrl, { headers: { Authorization: `Bearer ${key}` }, credentials: "omit", signal: req.signal });
                if (mediaResponse.ok) previewUrl = URL.createObjectURL(await mediaResponse.blob());
            }
            return {
                taskId,
                protocol,
                url: artifactUrl,
                requiresAuth: queried.requiresAuth,
                previewUrl,
                model: req.model,
                prompt,
                seconds,
                chargedSeconds: billedSeconds,
                resolution,
                ratio,
                estimateCNY: estimate.amount,
                actualCNY: actual.amount,
                actualLabel: actual.label,
                actualBasis: actual.basis,
                createdAt: Date.now(),
            };
        }
    }
    throw new Error("生成超时，请到 LL2 控制台查看任务状态，或稍后重试");
}

/** 连接自检：只查 /v1/models，不产生费用。 */
export async function ll2CheckConnection(apiKey: string, baseUrl?: string, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
    const req: LL2VideoRequest = { apiKey, baseUrl, model: "MiniMax-H3", prompt: "", seconds: 4, resolution: "768P", signal };
    try {
        await ll2Fetch(`${originOf(req)}/v1/models`, { method: "GET", headers: authHeaders(req) }, req, "校验 Key");
        return { ok: true, message: "Key 有效" };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "校验失败" };
    }
}
