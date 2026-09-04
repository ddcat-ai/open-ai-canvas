import { isHailuoH3ViaRelay, modelCapabilityConfigFor, videoResolutionRequest } from "@/lib/model-capabilities";
import { boolConfig } from "@/lib/seedance-video";
import { getResourceOSSUrl } from "@/services/api/resources";
import { modelOptionName } from "@/stores/use-config-store";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { ReferenceImage } from "@/types/image";

import type { ApiEnvelope, ApiVideoResponse, RequestOptions, ResolvedAiConfig, VideoGenerationTask, VideoGenerationTaskState } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";
import { normalizeVideoSeconds, normalizeVideoSize } from "./video-validation";

export async function createVideoGenerationsTask(deps: VideoProviderDeps, config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (references.length > 9 || videoReferences.length > 3 || audioReferences.length > 3) throw new Error("NewAPI Video Generations 最多支持 9 张参考图、3 个参考视频和 3 个参考音频");
    if (audioReferences.length > 0 && videoReferences.length === 0) throw new Error("NewAPI Video Generations 的参考音频必须同时提供至少 1 个参考视频；纯音频生视频请切换到支持该模式的渠道");
    const [imageUrls, videoUrls, audioUrls] = await Promise.all([
        Promise.all(references.map((item) => resolveVideoGenerationsUrl(item.url || item.dataUrl, item.storageKey))),
        Promise.all(videoReferences.map((item) => resolveVideoGenerationsUrl(item.url, item.storageKey))),
        Promise.all(audioReferences.map((item) => resolveVideoGenerationsUrl(item.url, item.storageKey))),
    ]);
    const profile = modelCapabilityConfigFor(config, model).video!;
    const resolvedModel = modelOptionName(model);
    const resolution = newAPIVideoResolutionRequest(profile, config.vquality, resolvedModel);
    // 本 payload 经 /api/ai/custom 中继时后端原样转发，不会改写字段，所以必须在
    // 这里就发对：MiniMax Hailuo H3 经 NewAPI 中转只认整型 duration（官方 4~15s），
    // 不认识 seconds 字符串，也没有 generate_audio 参数；继续发这两个字段会被上游
    // 以 unsupported_duration / task_not_exist 拒收。
    const hailuoH3 = isHailuoH3ViaRelay(config.interfaceType, resolvedModel);
    const payload = {
        model: resolvedModel,
        prompt: prompt.trim(),
        ...(hailuoH3
            ? { duration: clampHailuoH3Duration(Number(normalizeVideoSeconds(config.videoSeconds)), resolution) }
            : { seconds: normalizeVideoSeconds(config.videoSeconds) }),
        aspect_ratio: normalizeVideoSize(config.size) || "16:9",
        ...(resolution ? { resolution } : {}),
        ...(!hailuoH3 && profile.generateAudio.supported ? { generate_audio: boolConfig(config.videoGenerateAudio, profile.generateAudio.default) } : {}),
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
        ...(videoUrls.length ? { video_urls: videoUrls } : {}),
        ...(audioUrls.length ? { audio_urls: audioUrls } : {}),
    };
    try {
        const created = deps.response.unwrapVideoResponse(await deps.transport.post<ApiVideoResponse>(deps.transport.apiUrl("/video/generations"), payload, options));
        const id = deps.response.videoTaskId(created);
        if (!id) throw new Error("NewAPI Video Generations 没有返回任务 ID");
        return { id, provider: "video-generations", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "NewAPI Video Generations 任务创建失败"));
    }
}

export async function pollVideoGenerationsTask(deps: VideoProviderDeps, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const raw = await deps.transport.get<ApiEnvelope<Record<string, unknown>>>(deps.transport.apiUrl(`/video/generations/${encodeURIComponent(task.id)}`), options);
        const state = deps.response.unwrapEnvelopeRecord(raw);
        const status = String(state.status || "").toUpperCase();
        if (status === "SUCCESS" || status === "SUCCEEDED" || status === "COMPLETED") {
            const url = String(state.result_url || state.video_url || state.url || "");
            if (!url) return { status: "failed", error: "视频任务已完成但没有返回视频地址" };
            return { status: "completed", result: await deps.response.videoResultFromUrl(url, options) };
        }
        if (status === "FAILURE" || status === "FAILED" || status === "CANCELLED") return { status: "failed", error: String(state.fail_reason || state.error || "视频生成失败") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "NewAPI Video Generations 任务查询失败"));
    }
}

function newAPIVideoResolutionRequest(profile: NonNullable<ReturnType<typeof modelCapabilityConfigFor>["video"]>, value: string, model: string) {
    if (model.trim().toLowerCase() === "grok-video-1.5-1080p") return "1080p";
    return videoResolutionRequest(profile, value);
}

// Hailuo H3 官方时长下限是 4s，分镜镜头可能只有 3s，直接发会被上游拒收；
// 上限按档位区分：768p 档 15s，1080p/2K 档 8s。
function clampHailuoH3Duration(seconds: number, resolution: string | undefined) {
    const value = Math.floor(Number(seconds) || 6);
    const limit = ["1080p", "2k", "1440p"].includes((resolution ?? "").trim().toLowerCase()) ? 8 : 15;
    return Math.min(Math.max(value, 4), limit);
}

async function resolveVideoGenerationsUrl(value: string | undefined, storageKey?: string) {
    if (storageKey?.startsWith("resource:")) return getResourceOSSUrl(storageKey);
    if (isPublicMediaUrl(value || "")) return String(value);
    throw new Error("NewAPI Video Generations 的参考素材需要公网 URL；请先把素材保存到对象存储");
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}
