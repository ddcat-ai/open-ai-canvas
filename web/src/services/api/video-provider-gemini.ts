import { imageToDataUrl } from "@/services/image-storage";
import { modelOptionName } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import { normalizeVideoResolution, normalizeVideoSeconds, normalizeVideoSize } from "./video-validation";
import type { RequestOptions, ResolvedAiConfig, VideoGenerationTask, VideoGenerationTaskState } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";

type GeminiVeoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: Record<string, unknown>;
};

export async function createGeminiVeoTask(deps: VideoProviderDeps, config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
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
        const response = await deps.transport.post<GeminiVeoOperation>(geminiVeoCreateUrl(config, modelOptionName(model)), payload, options);
        if (!response.name) throw new Error("Gemini Veo 没有返回 operation name");
        return { id: response.name, provider: "gemini-veo", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "Gemini Veo 任务创建失败"));
    }
}

export async function pollGeminiVeoTask(deps: VideoProviderDeps, config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const operation = await deps.transport.get<GeminiVeoOperation>(geminiVeoOperationUrl(config, task.id), options);
        if (operation.error?.message) return { status: "failed", error: operation.error.message };
        if (!operation.done) return { status: "pending" };
        const url = findGeminiVideoURL(operation.response);
        if (!url) return { status: "failed", error: "Gemini Veo 任务已完成但没有返回视频地址" };
        const blob = await deps.transport.getExternalBlob(url, geminiVeoHeaders(config), options);
        await deps.response.assertVideoBlob(blob);
        return { status: "completed", result: { blob } };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "Gemini Veo 任务查询失败"));
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

function geminiVeoHeaders(config: ResolvedAiConfig) {
    return { "x-goog-api-key": config.apiKey };
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
