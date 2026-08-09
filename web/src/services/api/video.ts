import axios from "axios";

import { createClientId } from "@/lib/client-id";
import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { getResourceOSSUrl } from "@/services/api/resources";
import { channelRequest } from "@/services/api/custom-channel-relay";
import { imageToDataUrl } from "@/services/image-storage";
import { modelCapabilityConfigFor, videoDurationAllowed } from "@/lib/model-capabilities";
import { boolConfig, buildSeedancePromptText, isArkPlanBaseUrl, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { buildApiUrl, isSystemProxyBaseUrl, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id?: string; request_id?: string; task_id?: string; status?: string; error?: { message?: string }; video?: { url?: string }; video_url?: string; result_url?: string };
type ApiVideoResponse = VideoResponse | { code?: number; data?: VideoResponse | null; msg?: string };
type ResolvedAiConfig = ReturnType<typeof resolveModelRequestConfig>;
type SeedanceTask = {
    id: string;
    task_id?: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    error_code?: string | null;
    video_url?: string | null;
    content?: { video_url?: string; last_frame_url?: string } | null;
};
type ApiEnvelope<T> = T | { code?: number; data?: T | null; msg?: string };
type RequestOptions = { signal?: AbortSignal };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "video-generations" | "gemini-veo"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(isSystemProxyBaseUrl(config.baseUrl) ? { "X-Canvas-Scene": "video", "X-Idempotency-Key": createClientId() } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    const delayMs = task.provider === "openai" ? 2500 : 5000;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error(`${task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`);
        await delay(delayMs, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    assertVideoConfig(requestConfig, requestConfig.model);
    assertVideoCapability(modelCapabilityConfigFor(config, selectedModel).video!, references, videoReferences, audioReferences, config.videoSeconds);
    if (requestConfig.interfaceType === "newapi-channel-2") {
        return createVideoGenerationsTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (requestConfig.interfaceType === "gemini-veo") {
        return createGeminiVeoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (requestConfig.interfaceType === "volcengine-ark-video") {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考素材");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

function assertVideoCapability(profile: NonNullable<ReturnType<typeof modelCapabilityConfigFor>["video"]>, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], seconds: string) {
    if (references.length > profile.references.maxImages || videoReferences.length > profile.references.maxVideos || audioReferences.length > profile.references.maxAudios) throw new Error("参考素材数量超过当前模型限制");
    if (!videoDurationAllowed(profile, Number(seconds))) throw new Error("视频时长不在当前模型支持范围内");
    if (profile.references.maxImageBytes > 0 && references.some((image) => (image.bytes || 0) > profile.references.maxImageBytes)) throw new Error("参考图片文件超过当前模型大小限制");
    for (const video of videoReferences) {
        if (profile.references.maxVideoBytes > 0 && (video.bytes || 0) > profile.references.maxVideoBytes) throw new Error("参考视频文件超过当前模型大小限制");
        if (profile.references.maxVideoDurationSeconds > 0 && (video.durationMs || 0) > profile.references.maxVideoDurationSeconds * 1000) throw new Error("参考视频时长超过当前模型限制");
    }
    for (const audio of audioReferences) {
        if (profile.references.maxAudioBytes > 0 && (audio.bytes || 0) > profile.references.maxAudioBytes) throw new Error("参考音频文件超过当前模型大小限制");
        if (profile.references.maxAudioDurationSeconds > 0 && (audio.durationMs || 0) > profile.references.maxAudioDurationSeconds * 1000) throw new Error("参考音频时长超过当前模型限制");
    }
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "seedance") return pollSeedanceTask(requestConfig, task, options);
    if (task.provider === "video-generations") return pollVideoGenerationsTask(requestConfig, task, options);
    if (task.provider === "gemini-veo") return pollGeminiVeoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createVideoGenerationsTask(config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (references.length > 9 || videoReferences.length > 3 || audioReferences.length > 3) throw new Error("NewAPI Video Generations 最多支持 9 张参考图、3 个参考视频和 3 个参考音频");
    const [imageUrls, videoUrls, audioUrls] = await Promise.all([
        Promise.all(references.map((item) => resolveVideoGenerationsUrl(item.url || item.dataUrl, item.storageKey))),
        Promise.all(videoReferences.map((item) => resolveVideoGenerationsUrl(item.url, item.storageKey))),
        Promise.all(audioReferences.map((item) => resolveVideoGenerationsUrl(item.url, item.storageKey))),
    ]);
    const profile = modelCapabilityConfigFor(config, model).video!;
    const payload = {
        model: modelOptionName(model),
        prompt: prompt.trim(),
        seconds: normalizeVideoSeconds(config.videoSeconds),
        aspect_ratio: normalizeVideoSize(config.size) || "16:9",
        resolution: normalizeVideoResolution(config.vquality),
        ...(profile.generateAudio.supported ? { generate_audio: boolConfig(config.videoGenerateAudio, profile.generateAudio.default) } : {}),
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
        ...(videoUrls.length ? { video_urls: videoUrls } : {}),
        ...(audioUrls.length ? { audio_urls: audioUrls } : {}),
    };
    try {
        const created = unwrapVideoResponse(await channelPost<ApiVideoResponse>(config, aiApiUrl(config, "/video/generations"), payload, options));
        const id = videoTaskId(created);
        if (!id) throw new Error("NewAPI Video Generations 没有返回任务 ID");
        return { id, provider: "video-generations", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "NewAPI Video Generations 任务创建失败"));
    }
}

async function pollVideoGenerationsTask(config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const raw = await channelGet<ApiEnvelope<Record<string, unknown>>>(config, aiApiUrl(config, `/video/generations/${encodeURIComponent(task.id)}`), options);
        const state = unwrapEnvelopeRecord(raw);
        const status = String(state.status || "").toUpperCase();
        if (status === "SUCCESS" || status === "SUCCEEDED" || status === "COMPLETED") {
            const url = String(state.result_url || state.video_url || state.url || "");
            if (!url) return { status: "failed", error: "视频任务已完成但没有返回视频地址" };
            return { status: "completed", result: await videoResultFromUrl(url, options) };
        }
        if (status === "FAILURE" || status === "FAILED" || status === "CANCELLED") return { status: "failed", error: String(state.fail_reason || state.error || "视频生成失败") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "NewAPI Video Generations 任务查询失败"));
    }
}

async function resolveVideoGenerationsUrl(value: string | undefined, storageKey?: string) {
    if (storageKey?.startsWith("resource:")) return getResourceOSSUrl(storageKey);
    if (isPublicMediaUrl(value || "")) return String(value);
    throw new Error("NewAPI Video Generations 的参考素材需要公网 URL；请先把素材保存到 OSS");
}

type GeminiVeoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: Record<string, unknown>;
};

async function createGeminiVeoTask(config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (references.length > 1 || videoReferences.length || audioReferences.length) throw new Error("Gemini Veo 当前只支持 1 张起始图，不支持参考视频或音频");
    const instance: Record<string, unknown> = { prompt: prompt.trim() };
    if (references[0]) {
        const dataUrl = await imageToDataUrl(references[0]);
        const matched = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
        if (!matched) throw new Error("Gemini Veo 起始图读取失败");
        instance.image = { bytesBase64Encoded: matched[2], mimeType: matched[1] };
    }
    const payload = {
        instances: [instance],
        parameters: {
            aspectRatio: normalizeVideoSize(config.size) || "16:9",
            durationSeconds: Number.parseInt(normalizeVideoSeconds(config.videoSeconds), 10) || 6,
            resolution: normalizeVideoResolution(config.vquality),
            sampleCount: 1,
        },
    };
    try {
        const response = await channelPost<GeminiVeoOperation>(config, geminiVeoCreateUrl(config, modelOptionName(model)), payload, options);
        if (!response.name) throw new Error("Gemini Veo 没有返回 operation name");
        return { id: response.name, provider: "gemini-veo", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Gemini Veo 任务创建失败"));
    }
}

async function pollGeminiVeoTask(config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const operation = await channelGet<GeminiVeoOperation>(config, geminiVeoOperationUrl(config, task.id), options);
        if (operation.error?.message) return { status: "failed", error: operation.error.message };
        if (!operation.done) return { status: "pending" };
        const url = findGeminiVideoURL(operation.response);
        if (!url) return { status: "failed", error: "Gemini Veo 任务已完成但没有返回视频地址" };
        const blob = (await axios.get<Blob>(url, { headers: geminiVeoHeaders(config), responseType: "blob", signal: options?.signal })).data;
        await assertVideoBlob(blob);
        return { status: "completed", result: { blob } };
    } catch (error) {
        throw new Error(readAxiosError(error, "Gemini Veo 任务查询失败"));
    }
}

function geminiVeoCreateUrl(config: ResolvedAiConfig, model: string) {
    return `${geminiVeoBaseUrl(config)}/models/${encodeURIComponent(model)}:predictLongRunning`;
}

function geminiVeoOperationUrl(config: ResolvedAiConfig, operationName: string) {
    return `${geminiVeoBaseUrl(config)}/${operationName.replace(/^\/+/, "")}`;
}

function geminiVeoBaseUrl(config: ResolvedAiConfig) {
    const base = config.baseUrl.replace(/\/+$/, "");
    return /\/v1beta$/i.test(base) ? base : `${base}/v1beta`;
}

function geminiVeoHeaders(config: ResolvedAiConfig, contentType?: string) {
    return { "x-goog-api-key": config.apiKey, ...(contentType ? { "Content-Type": contentType } : {}) };
}

async function channelPost<T>(config: ResolvedAiConfig, upstreamUrl: string, body: unknown, options?: RequestOptions) {
    const request = channelRequest(config, upstreamUrl, aiHeaders(config, "application/json"));
    return (await axios.post<T>(request.url, body, { headers: request.headers, withCredentials: request.credentials === "include", signal: options?.signal })).data;
}

async function channelPostForm<T>(config: ResolvedAiConfig, upstreamUrl: string, body: FormData, options?: RequestOptions) {
    const request = channelRequest(config, upstreamUrl, aiHeaders(config));
    return (await axios.post<T>(request.url, body, { headers: request.headers, withCredentials: request.credentials === "include", signal: options?.signal })).data;
}

async function channelGet<T>(config: ResolvedAiConfig, upstreamUrl: string, options?: RequestOptions) {
    const request = channelRequest(config, upstreamUrl);
    return (await axios.get<T>(request.url, { headers: request.headers, withCredentials: request.credentials === "include", signal: options?.signal })).data;
}

async function channelGetBlob(config: ResolvedAiConfig, upstreamUrl: string, options?: RequestOptions) {
    const request = channelRequest(config, upstreamUrl);
    return (await axios.get<Blob>(request.url, { headers: request.headers, withCredentials: request.credentials === "include", responseType: "blob", signal: options?.signal })).data;
}

function findGeminiVideoURL(value: unknown): string {
    if (!value || typeof value !== "object") return "";
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findGeminiVideoURL(item);
            if (found) return found;
        }
        return "";
    }
    const record = value as Record<string, unknown>;
    for (const key of ["uri", "url", "videoUri", "video_url"]) {
        if (typeof record[key] === "string" && /^https?:\/\//i.test(record[key])) return record[key];
    }
    for (const child of Object.values(record)) {
        const found = findGeminiVideoURL(child);
        if (found) return found;
    }
    return "";
}

function unwrapEnvelopeRecord(value: ApiEnvelope<Record<string, unknown>>): Record<string, unknown> {
    if (value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object") return value.data as Record<string, unknown>;
    return value as Record<string, unknown>;
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
    throw new Error("视频接口没有返回可播放的视频");
}

async function createOpenAIVideoTask(config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    if (config.interfaceType === "xai-video" || modelName.toLowerCase().includes("grok")) {
        const images = await Promise.all(references.slice(0, 7).map((image) => imageToDataUrl(image)));
        const seconds = normalizeVideoSeconds(config.videoSeconds);
        const payload = {
            model: modelName,
            prompt,
            duration: Number.parseInt(seconds, 10) || 6,
            seconds,
            ...(normalizeVideoSize(config.size) ? { size: normalizeVideoSize(config.size) } : {}),
            ...(images.length ? { image: images[0], images } : {}),
        };
        try {
            const createPath = config.interfaceType === "xai-video" ? "/videos/generations" : "/videos";
            const created = unwrapVideoResponse(await channelPost<ApiVideoResponse>(config, aiApiUrl(config, createPath), payload, options));
            const id = videoTaskId(created);
            if (!id) throw new Error("视频接口没有返回任务 ID");
            return { id, provider: "openai", model };
        } catch (error) {
            throw new Error(readAxiosError(error, "视频任务创建失败"));
        }
    }
    const body = new FormData();
    body.append("model", modelName);
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse(await channelPostForm<ApiVideoResponse>(config, aiApiUrl(config, "/videos"), body, options));
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

async function pollOpenAIVideoTask(config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse(await channelGet<ApiVideoResponse>(config, aiApiUrl(config, `/videos/${task.id}`), options));
        if (video.status === "completed" || video.status === "succeeded" || video.status === "success" || video.status === "done") {
            const resultUrl = video.video?.url || video.video_url || video.result_url;
            if (resultUrl) return { status: "completed", result: await videoResultFromUrl(resultUrl, options) };
            const content = await channelGetBlob(config, aiApiUrl(config, `/videos/${task.id}/content`), options);
            await assertVideoBlob(content);
            return { status: "completed", result: { blob: content } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: video.error?.message || "视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createSeedanceTask(config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const isVolcengineArk = config.interfaceType === "volcengine-ark-video";
    const payload =
        isVolcengineArk || isArkPlanBaseUrl(config.baseUrl)
            ? await buildSeedanceAgentPlanPayload(config, model, prompt, references, videoReferences, audioReferences)
            : await buildSeedanceVideosPayload(config, model, prompt, references, videoReferences, audioReferences);

    try {
        const raw = await channelPost<ApiEnvelope<SeedanceTask>>(config, seedanceApiUrl(config), payload, options);
        const created = unwrapSeedanceTask(raw);
        const id = created.id || created.task_id;
        if (!id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id, provider: "seedance", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const raw = await channelGet<ApiEnvelope<SeedanceTask>>(config, seedanceApiUrl(config, task.id), options);
        const state = unwrapSeedanceTask(raw);
        if (state.status === "succeeded" || state.status === "completed") {
            const url = state.video_url || state.content?.video_url;
            if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
            if (isArkPlanBaseUrl(config.baseUrl)) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
            const content = await channelGetBlob(config, aiApiUrl(config, `/videos/${task.id}/content`), options);
            await assertVideoBlob(content);
            return { status: "completed", result: { blob: content } };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: seedanceErrorMessage(state) || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
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

async function buildSeedanceAgentPlanPayload(config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    if (config.interfaceType !== "volcengine-ark-video" && audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    const content = config.interfaceType === "volcengine-ark-video" ? await buildVolcengineArkContent(prompt, references, videoReferences, audioReferences) : await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
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
    throw new Error("火山方舟视频参考素材需要公网 URL 或 asset:// 素材 ID；请先将本地素材保存到 OSS");
}

async function buildSeedanceVideosPayload(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    if ((videoReferences.length || audioReferences.length) && !references.length) {
        throw new Error("Seedance 参考视频或参考音频需要同时连接至少 1 张主参考图");
    }
    const imageUrls = await Promise.all(references.slice(0, SEEDANCE_REFERENCE_LIMITS.images).map(resolveSeedanceVideosImageUrl));
    const videoUrls = await Promise.all(videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos).map(resolveSeedanceVideosMediaUrl));
    const audioUrls = await Promise.all(audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios).map(resolveSeedanceVideosMediaUrl));
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const profile = modelCapabilityConfigFor(config, model).video!;
    return {
        model: modelOptionName(model),
        prompt: buildSeedanceVideosPromptText(prompt, imageUrls.length, videoUrls.length, audioUrls.length),
        aspect_ratio: ratio === "adaptive" ? "16:9" : ratio,
        duration,
        ...(profile.generateAudio.supported ? { generate_audio: boolConfig(config.videoGenerateAudio, profile.generateAudio.default) } : {}),
        ...(imageUrls[0] ? { image_url: imageUrls[0] } : {}),
        ...(imageUrls.length > 1 ? { reference_image_urls: imageUrls.slice(1) } : {}),
        ...(videoUrls.length ? { reference_videos: videoUrls } : {}),
        ...(audioUrls.length ? { reference_audios: audioUrls } : {}),
    };
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

function buildSeedanceVideosPromptText(prompt: string, _imageCount: number, _videoCount: number, _audioCount: number) {
    return prompt.trim();
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
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

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、素材 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、素材 ID，或本地已保存的音频");
    return blobToDataUrl(blob);
}

async function resolveSeedanceVideosMediaUrl(media: ReferenceVideo | ReferenceAudio) {
    if (isPublicMediaUrl(media.url) || media.url?.startsWith("data:")) return media.url;
    let blob: Blob | null = null;
    if (media.storageKey) blob = await getMediaBlob(media.storageKey);
    if (!blob && media.url?.startsWith("blob:")) blob = await (await fetch(media.url)).blob();
    if (!blob) throw new Error("Seedance /videos 参考素材必须是公网 URL、data URL，或本地已保存素材");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

function seedanceErrorMessage(state: SeedanceTask) {
    if (state.error?.message && state.error.code) return `${state.error.code}：${state.error.message}`;
    return state.error?.message || state.error_code || "";
}

function assertVideoConfig(config: ResolvedAiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini" && config.interfaceType !== "gemini-veo") throw new Error("当前 Gemini 文本协议不支持视频生成，请为该模型选择 Gemini Veo 协议");
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, seconds));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = (value || "1280x720").trim().toLowerCase().replace("×", "x");
    if (/^\d+x\d+$/.test(size)) return size;
    const ratio = size.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!ratio) return "1280x720";
    const widthRatio = Number(ratio[1]);
    const heightRatio = Number(ratio[2]);
    if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) return "1280x720";
    const aspect = widthRatio / heightRatio;
    const width = aspect >= 1 ? 1280 : Math.max(256, Math.round((720 * aspect) / 2) * 2);
    const height = aspect >= 1 ? Math.max(256, Math.round((1280 / aspect) / 2) * 2) : 720;
    return `${width}x${height}`;
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    if (value.toLowerCase() === "4k") return "2160p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function videoTaskId(payload: VideoResponse) {
    return payload.id || payload.request_id || payload.task_id || "";
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && typeof payload.code === "number") {
        if (payload.code !== 0) throw new Error(payload.msg || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地素材失败"));
        reader.readAsDataURL(blob);
    });
}
