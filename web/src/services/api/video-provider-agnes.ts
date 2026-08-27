import { getResourceOSSUrl } from "@/services/api/resources";
import { buildApiUrl, isSystemProxyBaseUrl, modelOptionName } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import type { ApiEnvelope, RequestOptions, ResolvedAiConfig, VideoGenerationTask, VideoGenerationTaskState } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";

type AgnesTaskResponse = {
    id?: string;
    task_id?: string;
    video_id?: string;
    status?: string;
    metadata?: { url?: string } | null;
    error?: { message?: string; detail?: string; code?: string } | null;
    message?: string;
    detail?: string;
};

const AGNES_V25_MODELS = new Set(["agnes-video-2.5", "agnes-video-2.5-flash"]);
const AGNES_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

export function isAgnesConfig(config: ResolvedAiConfig) {
    return config.interfaceType === "agnes-video";
}

export async function createAgnesVideoTask(
    deps: VideoProviderDeps,
    config: ResolvedAiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model).trim();
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) throw new Error("请输入 Agnes 视频提示词");

    const [imageUrls, videoUrls, audioUrls] = await Promise.all([
        Promise.all(references.map((item) => resolveAgnesMediaUrl(item.url || item.dataUrl, item.storageKey))),
        Promise.all(videoReferences.map((item) => resolveAgnesMediaUrl(item.url, item.storageKey))),
        Promise.all(audioReferences.map((item) => resolveAgnesMediaUrl(item.url, item.storageKey))),
    ]);
    const payload = modelName === "agnes-video-v2.0"
        ? buildAgnesV20Payload(config, modelName, normalizedPrompt, imageUrls, videoUrls, audioUrls)
        : buildAgnesV25Payload(config, modelName, normalizedPrompt, imageUrls, videoUrls, audioUrls);

    try {
        const raw = await deps.transport.post<ApiEnvelope<AgnesTaskResponse>>(deps.transport.apiUrl("/videos"), payload, options);
        const created = deps.response.unwrapEnvelope(raw, "Agnes 接口没有返回视频任务");
        const id = String(created.video_id || created.task_id || created.id || "").trim();
        if (!id) throw new Error("Agnes 创建响应没有 video_id");
        return { id, provider: "agnes", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "Agnes 视频任务创建失败"));
    }
}

export async function pollAgnesVideoTask(deps: VideoProviderDeps, config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const raw = await deps.transport.get<ApiEnvelope<AgnesTaskResponse>>(agnesPollUrl(config, task.id, modelOptionName(task.model)), options);
        const state = deps.response.unwrapEnvelope(raw, "Agnes 接口没有返回任务状态");
        const status = String(state.status || "").trim().toLowerCase();
        if (status === "completed" || status === "succeeded" || status === "success" || status === "done") {
            const url = String(state.metadata?.url || "").trim();
            if (!url) return { status: "failed", error: "Agnes 任务已完成但没有返回 metadata.url" };
            return { status: "completed", result: await deps.response.videoResultFromUrl(url, options) };
        }
        if (status === "failed" || status === "cancelled" || status === "canceled") return { status: "failed", error: agnesFailureMessage(state) };
        return { status: "pending" };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "Agnes 视频任务查询失败"));
    }
}

export function agnesPollUrl(config: ResolvedAiConfig, videoId: string, modelName: string) {
    const query = new URLSearchParams({ video_id: videoId, model_name: modelName }).toString();
    const path = `/agnesapi?${query}`;
    if (isSystemProxyBaseUrl(config.baseUrl)) return buildApiUrl(config.baseUrl, path);
    let base: URL;
    try {
        base = new URL(config.baseUrl);
    } catch {
        throw new Error("Agnes Base URL 无效，请填写完整的 HTTP(S) 地址");
    }
    base.pathname = "/agnesapi";
    base.search = query;
    base.hash = "";
    return base.toString();
}

function buildAgnesV25Payload(config: ResolvedAiConfig, model: string, prompt: string, images: string[], videos: string[], audios: string[]) {
    if (!AGNES_V25_MODELS.has(model)) throw new Error(`Agnes 视频协议不支持模型 ${model}`);
    const seconds = agnesSeconds(config.videoSeconds);
    const size = agnesResolution(config.vquality);
    if (model === "agnes-video-2.5-flash") {
        if (size !== "720P") throw new Error("Agnes Video 2.5 Flash 仅支持 720P");
        if (images.length > 5) throw new Error("Agnes Video 2.5 Flash 最多支持 5 张参考图");
        if (videos.length) throw new Error("Agnes Video 2.5 Flash 不支持参考视频");
    }
    const mode = videos.length || audios.length || images.length > 2 ? "reference" : images.length ? "keyframe" : "text";
    const payload: Record<string, unknown> = {
        model,
        prompt,
        mode,
        seconds,
        size,
        aspect_ratio: agnesAspectRatio(config.size),
        n: 1,
    };
    if (mode === "keyframe") {
        payload.first_frame = images[0];
        if (images[1]) payload.last_frame = images[1];
    } else if (mode === "reference") {
        if (images.length) payload.images = images;
        if (audios.length) payload.audios = audios;
        if (videos.length) payload.videos = videos.map((url) => ({ url }));
    }
    return payload;
}

function buildAgnesV20Payload(config: ResolvedAiConfig, model: string, prompt: string, images: string[], videos: string[], audios: string[]) {
    if (videos.length || audios.length) throw new Error("Agnes Video V2.0 不支持参考视频或音频");
    const seconds = Math.max(1, Math.floor(Number(config.videoSeconds) || 5));
    const frameRate = 24;
    const targetFrames = seconds * frameRate;
    const payload: Record<string, unknown> = {
        model,
        prompt,
        frame_rate: frameRate,
        num_frames: Math.min(441, Math.floor((targetFrames - 1 + 4) / 8) * 8 + 1),
    };
    if (images.length === 1) payload.image = images[0];
    if (images.length > 1) payload.extra_body = { image: images, mode: "keyframes" };
    return payload;
}

function agnesSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 5);
    if (seconds < 4 || seconds > 12) throw new Error("Agnes Video 2.5 时长必须在 4–12 秒之间");
    return String(seconds);
}

function agnesResolution(value: string) {
    const normalized = String(value || "720").trim().toLowerCase();
    if (normalized === "auto" || normalized === "720" || normalized === "720p") return "720P";
    if (normalized === "960" || normalized === "960p") return "960P";
    if (normalized === "2k" || normalized === "1440" || normalized === "1440p") return "2K";
    throw new Error("Agnes Video 2.5 分辨率必须是 720P、960P 或 2K");
}

function agnesAspectRatio(value: string) {
    const normalized = String(value || "16:9").trim().toLowerCase().replace("×", "x");
    if (normalized === "auto" || !normalized) return "16:9";
    const direct = AGNES_ASPECT_RATIOS.find((ratio) => ratio === normalized);
    if (direct) return direct;
    const dimensions = normalized.match(/^(\d+)x(\d+)$/);
    if (dimensions) {
        const aspect = Number(dimensions[1]) / Number(dimensions[2]);
        const matched = AGNES_ASPECT_RATIOS.find((ratio) => {
            const [width, height] = ratio.split(":").map(Number);
            return Math.abs(width / height - aspect) < 0.01;
        });
        if (matched) return matched;
    }
    throw new Error("Agnes Video 2.5 画幅必须是 21:9、16:9、4:3、1:1、3:4 或 9:16");
}

async function resolveAgnesMediaUrl(value: string | undefined, storageKey?: string) {
    if (storageKey?.startsWith("resource:")) return getResourceOSSUrl(storageKey);
    if (/^https?:\/\//i.test(value || "")) return String(value);
    throw new Error("Agnes 参考素材需要公网 URL；请先把素材保存到对象存储");
}

function agnesFailureMessage(state: AgnesTaskResponse) {
    return String(state.error?.message || state.error?.detail || state.error?.code || state.message || state.detail || "Agnes 视频生成失败");
}
