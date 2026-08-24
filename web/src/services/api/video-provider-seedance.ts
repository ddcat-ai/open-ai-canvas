import { t } from "@/i18n";
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

export async function createSeedanceTask(
    deps: VideoProviderDeps,
    config: ResolvedAiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const isVolcengineArk = config.interfaceType === "volcengine-ark-video";
    const payload =
        isVolcengineArk || isArkPlanBaseUrl(config.baseUrl)
            ? await buildSeedanceAgentPlanPayload(config, model, prompt, references, videoReferences, audioReferences, deps)
            : await buildSeedanceVideosPayload(config, model, prompt, references, videoReferences, audioReferences, deps);

    try {
        const raw = await deps.transport.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, options);
        const created = deps.response.unwrapSeedanceTask(raw);
        const id = created.id || created.task_id;
        if (!id) throw new Error(t("domain:the-seedance-api-did-not-return-a-task-id"));
        return { id, provider: "seedance", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, t("domain:seedance-task-creation-failed")));
    }
}

export async function pollSeedanceTask(deps: VideoProviderDeps, config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const raw = await deps.transport.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), options);
        const state = deps.response.unwrapSeedanceTask(raw);
        if (state.status === "succeeded" || state.status === "completed") {
            const url = state.video_url || state.content?.video_url;
            if (url) return { status: "completed", result: await deps.response.videoResultFromUrl(url, options) };
            if (isArkPlanBaseUrl(config.baseUrl)) return { status: "failed", error: t("domain:the-seedance-task-succeeded-but-returned-no-video-url") };
            const content = await deps.transport.getBlob(deps.transport.apiUrl(`/videos/${task.id}/content`), options);
            await deps.response.assertVideoBlob(content);
            return { status: "completed", result: { blob: content } };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired")
            return { status: "failed", error: seedanceErrorMessage(state) || `Seedance 视频生成${state.status === "expired" ? t("domain:timed-out") : t("domain:failed")}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, t("domain:seedance-task-query-failed")));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error(t("domain:each-seedance-reference-video-must-be-between-2-and-15-seconds"));
        total += video.durationMs;
    }
    if (total > 15000) throw new Error(t("domain:total-seedance-reference-video-duration-cannot-exceed-15-seconds"));
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error(t("domain:each-seedance-reference-audio-must-be-between-2-and-15-seconds"));
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error(t("domain:seedance-reference-audio-must-total-no-more-than-15-seconds"));
}

function seedanceApiUrl(config: ResolvedAiConfig, taskId?: string) {
    if (config.interfaceType === "volcengine-ark-video" || isArkPlanBaseUrl(config.baseUrl)) return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
    return buildApiUrl(config.baseUrl, `/videos${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceAgentPlanPayload(config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], deps: VideoProviderDeps) {
    if (config.interfaceType !== "volcengine-ark-video" && audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error(t("domain:seedance-reference-audio-cannot-be-used-alone-add-reference-images-or-vi"));
    }
    const content = config.interfaceType === "volcengine-ark-video" ? await buildVolcengineArkContent(prompt, references, videoReferences, audioReferences) : await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences, deps);
    if (!content.length) throw new Error(t("domain:enter-a-video-prompt-or-connect-reference-images-videos-audio"));
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
    throw new Error(t("domain:volcengine-ark-video-references-require-a-public-url-or-an-asset-media-i"));
}

async function buildSeedanceVideosPayload(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], deps: VideoProviderDeps) {
    if ((videoReferences.length || audioReferences.length) && !references.length) {
        throw new Error(t("domain:seedance-reference-video-or-audio-requires-at-least-one-main-reference-i"));
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
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceMediaUrl(video, deps, t("domain:reference-videos")) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceMediaUrl(audio, deps, t("domain:reference-audio")) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error(t("domain:failed-to-read-the-reference-image-try-another-image-or-re-upload-2"));
    return dataUrl;
}

async function resolveSeedanceVideosImageUrl(image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("data:")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error(t("domain:failed-to-read-the-reference-image-try-another-image-or-re-upload-2"));
    return dataUrl;
}

async function resolveSeedanceMediaUrl(media: ReferenceVideo | ReferenceAudio, deps: VideoProviderDeps, label: string) {
    if (isPublicMediaUrl(media.url) || media.url.startsWith("asset://")) return media.url;
    let blob: Blob | null = null;
    if (media.storageKey) blob = await getMediaBlob(media.storageKey);
    if (!blob && media.url?.startsWith("blob:")) blob = await (await fetch(media.url)).blob();
    if (!blob) throw new Error(t("domain:param-must-be-a-public-url-an-asset-id-or-a-locally-saved-asset", { label: label }));
    return deps.response.blobToDataUrl(blob);
}

async function resolveSeedanceVideosMediaUrl(media: ReferenceVideo | ReferenceAudio, deps: VideoProviderDeps) {
    if (isPublicMediaUrl(media.url) || media.url?.startsWith("data:")) return media.url;
    let blob: Blob | null = null;
    if (media.storageKey) blob = await getMediaBlob(media.storageKey);
    if (!blob && media.url?.startsWith("blob:")) blob = await (await fetch(media.url)).blob();
    if (!blob) throw new Error(t("domain:seedance-videos-reference-media-must-be-a-public-url-data-url-or-locally"));
    return deps.response.blobToDataUrl(blob);
}

function seedanceErrorMessage(state: SeedanceTask) {
    if (state.error?.message && state.error.code) return `${state.error.code}：${state.error.message}`;
    return state.error?.message || state.error_code || "";
}
