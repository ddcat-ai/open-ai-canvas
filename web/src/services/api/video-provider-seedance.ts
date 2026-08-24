import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { boolConfig, buildSeedancePromptText, isArkPlanBaseUrl, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { getResourceOSSUrl } from "@/services/api/resources";
import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { buildApiUrl, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import { isPublicMediaUrl } from "./video-validation";
import type { ApiEnvelope, RequestOptions, ResolvedAiConfig, SeedanceTask, VideoGenerationTask, VideoGenerationTaskState } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";

export function isSeedanceConfig(config: ResolvedAiConfig) {
    return config.interfaceType === "volcengine-ark-video" || isSeedanceVideoConfig(config);
}

export async function createSeedanceTask(deps: VideoProviderDeps, config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const isVolcengineArk = config.interfaceType === "volcengine-ark-video";
    const payload = isVolcengineArk || isArkPlanBaseUrl(config.baseUrl)
        ? await buildSeedanceAgentPlanPayload(config, model, prompt, references, videoReferences, audioReferences, deps)
        : await buildSeedanceVideosPayload(config, model, prompt, references, videoReferences, audioReferences, deps);

    try {
        const raw = await deps.transport.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, options);
        const created = deps.response.unwrapSeedanceTask(raw);
        const id = created.id || created.task_id;
        if (!id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id, provider: "seedance", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "Seedance 任务创建失败"));
    }
}

export async function pollSeedanceTask(deps: VideoProviderDeps, config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const raw = await deps.transport.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), options);
        const state = deps.response.unwrapSeedanceTask(raw);
        if (state.status === "succeeded" || state.status === "completed") {
            const url = state.video_url || state.content?.video_url;
            if (url) return { status: "completed", result: await deps.response.videoResultFromUrl(url, options) };
            if (isArkPlanBaseUrl(config.baseUrl)) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
            const content = await deps.transport.getBlob(deps.transport.apiUrl(`/videos/${task.id}/content`), options);
            await deps.response.assertVideoBlob(content);
            return { status: "completed", result: { blob: content } };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: seedanceErrorMessage(state) || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "Seedance 任务查询失败"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: ResolvedAiConfig, taskId?: string) {
    if (config.interfaceType === "volcengine-ark-video" || isArkPlanBaseUrl(config.baseUrl)) return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
    return buildApiUrl(config.baseUrl, `/videos${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceAgentPlanPayload(config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], deps: VideoProviderDeps) {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error(config.interfaceType === "volcengine-ark-video" ? "火山方舟全模态参考不支持纯音频或文本+音频，请同时添加参考图片或参考视频" : "Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    const content = config.interfaceType === "volcengine-ark-video"
        ? await buildVolcengineArkContent(prompt, references, videoReferences, audioReferences)
        : await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences, deps);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const profile = modelCapabilityConfigFor(config, model).video!;
    return {
        model: modelOptionName(model),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality, modelOptionName(model)),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        ...(profile.generateAudio.supported ? { generate_audio: boolConfig(config.videoGenerateAudio, profile.generateAudio.default) } : {}),
        ...(profile.watermark.supported ? { watermark: boolConfig(config.videoWatermark, profile.watermark.default) } : {}),
    };
}

async function buildVolcengineArkContent(prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    if (prompt.trim()) content.push({ type: "text", text: prompt.trim() });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveVolcengineArkReferenceUrl(image.url || image.dataUrl, image.storageKey) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveVolcengineArkReferenceUrl(video.url, video.storageKey) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveVolcengineArkReferenceUrl(audio.url, audio.storageKey) }, role: "reference_audio" });
    }
    return content;
}

async function resolveVolcengineArkReferenceUrl(value: string | undefined, storageKey?: string) {
    if (storageKey?.startsWith("resource:")) return getResourceOSSUrl(storageKey);
    if (isPublicMediaUrl(value || "") || String(value || "").startsWith("asset://")) return String(value);
    throw new Error("火山方舟视频参考素材需要公网 URL 或 asset:// 素材 ID；请先将本地素材保存到对象存储");
}

async function buildSeedanceVideosPayload(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], deps: VideoProviderDeps) {
    if ((videoReferences.length || audioReferences.length) && !references.length) {
        throw new Error("Seedance 参考视频或参考音频需要同时连接至少 1 张主参考图");
    }
    const imageUrls = await Promise.all(references.slice(0, SEEDANCE_REFERENCE_LIMITS.images).map(resolveSeedanceVideosImageUrl));
    const videoUrls = await Promise.all(videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos).map((media) => resolveSeedanceVideosMediaUrl(media, deps)));
    const audioUrls = await Promise.all(audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios).map((media) => resolveSeedanceVideosMediaUrl(media, deps)));
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const profile = modelCapabilityConfigFor(config, model).video!;
    return {
        model: modelOptionName(model),
        prompt: prompt.trim(),
        aspect_ratio: ratio === "adaptive" ? "16:9" : ratio,
        duration,
        ...(profile.generateAudio.supported ? { generate_audio: boolConfig(config.videoGenerateAudio, profile.generateAudio.default) } : {}),
        ...(imageUrls[0] ? { image_url: imageUrls[0] } : {}),
        ...(imageUrls.length > 1 ? { reference_image_urls: imageUrls.slice(1) } : {}),
        ...(videoUrls.length ? { reference_videos: videoUrls } : {}),
        ...(audioUrls.length ? { reference_audios: audioUrls } : {}),
    };
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], deps: VideoProviderDeps) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceMediaUrl(video, deps, "参考视频") }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceMediaUrl(audio, deps, "参考音频") }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveSeedanceVideosImageUrl(image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("data:")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveSeedanceMediaUrl(media: ReferenceVideo | ReferenceAudio, deps: VideoProviderDeps, label: string) {
    if (isPublicMediaUrl(media.url) || media.url.startsWith("asset://")) return media.url;
    let blob: Blob | null = null;
    if (media.storageKey) blob = await getMediaBlob(media.storageKey);
    if (!blob && media.url?.startsWith("blob:")) blob = await (await fetch(media.url)).blob();
    if (!blob) throw new Error(`${label}必须是公网 URL、素材 ID，或本地已保存素材`);
    return deps.response.blobToDataUrl(blob);
}

async function resolveSeedanceVideosMediaUrl(media: ReferenceVideo | ReferenceAudio, deps: VideoProviderDeps) {
    if (isPublicMediaUrl(media.url) || media.url?.startsWith("data:")) return media.url;
    let blob: Blob | null = null;
    if (media.storageKey) blob = await getMediaBlob(media.storageKey);
    if (!blob && media.url?.startsWith("blob:")) blob = await (await fetch(media.url)).blob();
    if (!blob) throw new Error("Seedance /videos 参考素材必须是公网 URL、data URL，或本地已保存素材");
    return deps.response.blobToDataUrl(blob);
}

function seedanceErrorMessage(state: SeedanceTask) {
    if (state.error?.message && state.error.code) return `${state.error.code}：${state.error.message}`;
    return state.error?.message || state.error_code || "";
}
